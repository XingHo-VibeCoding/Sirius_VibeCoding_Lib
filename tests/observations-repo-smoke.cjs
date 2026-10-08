/**
 * tests/observations-repo-smoke.cjs —— observations 数据访问层的离线冒烟测试
 * ============================================================
 * 【怎么跑】
 *   node tests/observations-repo-smoke.cjs
 *   期望末尾输出：`结果：PASS 32 ／ FAIL 0`
 *   ⚠️ 全程**不连数据库、不部署、无副作用** —— db 被桩替换掉了，
 *      所以哪怕把被测代码改坏，也不可能真的动到线上数据。
 *
 * 【为什么值得单独测这一层】
 *   `update()` 里方法名写错（`.upd`）、链序写错（先 eq 后 update）、
 *   或返回值形状判断反了，**都不会在部署时报错**，只会在真跑时静默出错。
 *   接口层的回归测试跑不到这里 —— 它测的是 HTTP/事件层。
 *
 * 【手法】
 *   把 `repositories/db.js` 用桩替换掉（写进 require.cache），
 *   让 observationsRepository 拿到一个假的 db，
 *   看它到底拼出了什么调用链、以及各种返回值怎么处理。
 *
 * 【Day 22 入库说明】
 *   这个文件原本住在 `%TEMP%` 下的临时目录里（Day 22 步骤 2 写的）。
 *   它是「仓库层空 id 自查」**唯一的测试** —— 留在临时目录里，
 *   哪天被清理掉，那道防线就再也没人盯着了 ⇒ 2026-10-08 移入仓库。
 *   ⚠️ 移入时只改了一处：仓库路径从写死的绝对路径改成基于 `__dirname` 推算，
 *      其余断言**一字未动**（入库后首跑仍为 PASS 32 / FAIL 0）。
 * ============================================================
 */

const path = require('path');
const REPO_DIR = path.join(__dirname, '..', 'cloudfunctions', 'api', 'repositories');
const DB_PATH = require.resolve(path.join(REPO_DIR, 'db.js'));

/* ---------- 桩：一个"记账"的假 db ---------- */
let calls = [];          /* 记录调用链 */
let eqSeen = [];         /* 记录 eq 的实参 */
let orderSeen = [];      /* 记录 order 的实参 */
let fromCount = 0;       /* 记录 from() 被调用了几次（用来证明"没碰数据库"） */
let nextBlob = { data: null, error: null };  /* 下一次 await 的结果 */

function makeChain(table) {
  const chain = {
    _table: table,
    _method: null,
    _values: null,
    _cols: null,
    _eq: [],

    insert(v) { calls.push('insert'); chain._method = 'insert'; chain._values = v; return chain; },
    update(v) { calls.push('update'); chain._method = 'update'; chain._values = v; return chain; },
    delete() { calls.push('delete'); chain._method = 'delete'; return chain; },
    select(c) { calls.push('select'); chain._cols = c; return chain; },
    eq(k, v) { calls.push('eq'); chain._eq.push([k, v]); eqSeen = chain._eq; return chain; },
    limit(n) { calls.push('limit'); return chain; },
    order(col, opt) { calls.push('order'); orderSeen.push([col, opt]); return chain; },

    /* 让它变成 thenable ⇒ `await chain` 拿到 nextBlob（真实 SDK 就是这么被 await 的） */
    then(resolve, reject) { return Promise.resolve(nextBlob).then(resolve, reject); }
  };
  return chain;
}

const fakeDb = {
  from(table) { fromCount++; calls.push('from:' + table); return makeChain(table); },
  describe(e) { return (e && (e.message || e.code)) || '未知错误'; },
  /* 真 db.js 的 throwIfError 是**真的抛**的 —— 桩也要真的抛，
     否则"读接口报错时会不会抛"这条根本测不出来（假绿的典型来源）。 */
  throwIfError(res, what) {
    if (res && res.error) {
      const e = new Error(what + '失败：' + fakeDb.describe(res.error));
      e.viaThrowIfError = true;   /* 标记：走的是读路径（不是手动抛 + cause） */
      throw e;
    }
  }
};

require.cache[DB_PATH] = {
  id: DB_PATH, filename: DB_PATH, loaded: true,
  /* ⚠️ 形状必须和真 db.js 一致：真文件导出的是 { db, describe, throwIfError }。
     仓库里写的是 `const db = conn.db` —— 桩少给这一层，db 就是 undefined。 */
  exports: { db: fakeDb, describe: fakeDb.describe, throwIfError: fakeDb.throwIfError }
};

const repo = require(path.join(REPO_DIR, 'observationsRepository.js'));

/* ---------- 断言小工具 ---------- */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  → ' + extra : '')); }
}

(async function run() {
  console.log('仓库导出的方法：' + Object.keys(repo).join(', '));
  check('导出面 = insert / update / remove（步骤 5 时点的）',
    Object.keys(repo).sort().join(',') === 'insert,listAll,remove,update',
    Object.keys(repo).join(','));

  /* ---- 用例 1：命中一行 → 返回改完的那行，并核对调用链 ---- */
  calls = [];
  eqSeen = [];
  nextBlob = { data: [{ id: 'X', status: 'missed', note: '改了' }], error: null };
  const r1 = await repo.update('X', { status: 'missed', note: '改了' });
  console.log('\n用例 1 调用链：' + calls.join(' → '));
  check('调用链 = from:observations → update → eq → select',
    calls.join(',') === 'from:observations,update,eq,select', calls.join(','));
  check('id 走的是 eq(id, 值) 参数绑定，没拼字符串',
    JSON.stringify(eqSeen) === '[["id","X"]]', JSON.stringify(eqSeen));
  check('返回那一行本身', r1 && r1.status === 'missed', JSON.stringify(r1));

  /* ---- 用例 2：空数组 → null（= id 不存在） ---- */
  calls = [];
  nextBlob = { data: [], error: null };
  const r2 = await repo.update('NOPE', { status: 'observed' });
  check('空数组 → null（表示库里没有这个 id）', r2 === null, JSON.stringify(r2));

  /* ---- 用例 3：平台直接给对象（非数组）→ 也接住 ---- */
  nextBlob = { data: { id: 'Y', status: 'planned' }, error: null };
  const r3 = await repo.update('Y', { status: 'planned' });
  check('非数组形状兜底成功', r3 && r3.id === 'Y', JSON.stringify(r3));

  /* ---- 用例 4：报错 → 抛异常，且 e.cause 带回原始 error ---- */
  const rawErr = { code: 'DATABASE_42501', message: 'permission denied for table observations' };
  nextBlob = { data: null, error: rawErr };
  let caught = null;
  try { await repo.update('Z', { status: 'observed' }); }
  catch (e) { caught = e; }
  check('报错时抛异常', !!caught);
  check('e.cause === 原始 error（index.js 靠它认 42501）',
    caught && caught.cause === rawErr, caught ? String(caught.cause && caught.cause.code) : 'no error');
  check('异常 message 里有中文前缀 + 原始说明',
    caught && /改 observations 失败：permission denied/.test(caught.message),
    caught && caught.message);

  /* ---- 用例 5：patch 原样传给 SDK（没有偷偷加/删键） ---- */
  calls = [];
  let seen = null;
  const origFrom = fakeDb.from;
  fakeDb.from = function (t) { const c = origFrom(t); const ou = c.update; c.update = function (v) { seen = v; return ou.call(c, v); }; return c; };
  nextBlob = { data: [{ id: 'W' }], error: null };
  await repo.update('W', { status: 'observed' });
  fakeDb.from = origFrom;
  check('patch 原样透传，未增删键',
    seen && JSON.stringify(seen) === '{"status":"observed"}', JSON.stringify(seen));

  /* ================= Day 22 步骤 5：remove() ================= */
  console.log('\n=== 步骤 5 · remove() ===');

  /* ---- 🔴 最重要的一条：空 id 必须**在发请求之前**就被拦住 ---- */
  calls = []; fromCount = 0;
  let guardErr = null;
  try { await repo.remove(''); } catch (e) { guardErr = e; }
  check('remove("") 抛异常', !!guardErr, guardErr ? 'no-throw' : '');
  check('异常说明点明了危险（整张表）', guardErr && /清空整张表/.test(guardErr.message), guardErr && guardErr.message);
  check('🔴 完全没有碰数据库（否则就是不带条件的 DELETE）', fromCount === 0, 'fromCount=' + fromCount);

  fromCount = 0; guardErr = null;
  try { await repo.remove(undefined); } catch (e) { guardErr = e; }
  check('remove(undefined) 同样被拦住且不碰库', !!guardErr && fromCount === 0, 'fromCount=' + fromCount);

  fromCount = 0; guardErr = null;
  try { await repo.remove(null); } catch (e) { guardErr = e; }
  check('remove(null) 同样被拦住且不碰库', !!guardErr && fromCount === 0, 'fromCount=' + fromCount);

  /* ---- 正常：命中一行 ---- */
  calls = []; eqSeen = [];
  nextBlob = { data: [{ id: 'D', body_id: 'jupiter', status: 'observed', note: '被删的' }], error: null };
  const rd = await repo.remove('D');
  console.log('  调用链：' + calls.join(' → '));
  check('调用链 = from:observations → delete → eq → select',
    calls.join(',') === 'from:observations,delete,eq,select', calls.join(','));
  check('eq 的参数是 (id, 值) —— 条件一定挂上了',
    JSON.stringify(eqSeen) === '[["id","D"]]', JSON.stringify(eqSeen));
  check('返回被删掉的那一行', rd && rd.id === 'D' && rd.note === '被删的', JSON.stringify(rd));

  /* ---- 空数组 → null（= 库里本来就没有这个 id） ---- */
  nextBlob = { data: [], error: null };
  const rd2 = await repo.remove('NOPE');
  check('空数组 → null（本来就没有这条记录）', rd2 === null, JSON.stringify(rd2));

  /* ---- 报错 → 抛异常且 cause 保留原始 error ---- */
  const rawDelErr = { code: 'DATABASE_42501', message: 'permission denied for table observations' };
  nextBlob = { data: null, error: rawDelErr };
  let delCaught = null;
  try { await repo.remove('E'); } catch (e) { delCaught = e; }
  check('报错时抛异常', !!delCaught);
  check('e.cause === 原始 error（认 42501 靠它）', delCaught && delCaught.cause === rawDelErr);
  check('异常 message 带中文前缀', delCaught && /删 observations 失败：/.test(delCaught.message), delCaught && delCaught.message);

  /* ---- 导出面 ---- */
  check('导出 insert / update / remove / listAll，没多没少',
    Object.keys(repo).sort().join(',') === 'insert,listAll,remove,update', Object.keys(repo).join(','));

  /* ================= Day 22 板块③ 步骤 1：listAll() ================= */
  console.log('\n=== 板块③ 步骤 1 · listAll() ===');

  check('导出面 = listAll / insert / update / remove（没偷偷多写死代码）',
    Object.keys(repo).sort().join(',') === 'insert,listAll,remove,update',
    Object.keys(repo).join(','));

  calls = []; orderSeen = []; nextBlob = { data: [], error: null };
  const rl = await repo.listAll();
  console.log('  调用链：' + calls.join(' → '));
  check('调用链 = from:observations → select → order → order（两次排序）',
    calls.join(',') === 'from:observations,select,order,order', calls.join(','));
  check('第一次排序 created_at 倒序（最近录入的在前）',
    JSON.stringify(orderSeen[0]) === '["created_at",{"ascending":false}]', JSON.stringify(orderSeen[0]));
  check('第二次排序 id 升序 —— 唯一键决胜，保证顺序确定',
    JSON.stringify(orderSeen[1]) === '["id",{"ascending":true}]', JSON.stringify(orderSeen[1]));
  check('空表 → 空数组（不是 null、更不抛错）', Array.isArray(rl) && rl.length === 0, JSON.stringify(rl));

  nextBlob = { data: [{ id: 'A' }, { id: 'B' }], error: null };
  const rl2 = await repo.listAll();
  check('有数据 → 原样返回数组', Array.isArray(rl2) && rl2.length === 2, JSON.stringify(rl2));

  /* 读路径报错：必须抛，而且走的是 throwIfError（不是写操作那套手动抛 + cause） */
  nextBlob = { data: null, error: { code: 'DATABASE_42P01', message: 'relation "observations" does not exist' } };
  let readCaught = null;
  try { await repo.listAll(); } catch (e) { readCaught = e; }
  check('读失败 → 抛异常', !!readCaught);
  check('走的是 throwIfError（读不需要认 code ⇒ 不带 cause）',
    readCaught && readCaught.viaThrowIfError === true && !readCaught.cause,
    readCaught ? 'cause=' + readCaught.cause : 'no error');
  check('异常 message 前缀 = "读 observations失败："',
    readCaught && readCaught.message.indexOf('读 observations失败：') === 0, readCaught && readCaught.message);
  console.log('  📌 发现（已有的小不一致，非本次引入）：');
  console.log('     真 db.js 的 throwIfError 拼的是 `what + "失败："` —— what 后面**没有空格**');
  console.log('     ⇒ 读路径日志是「读 observations失败：…」');
  console.log('     而今天新写的写路径是「写 observations 失败：…」（有空格）。');
  console.log('     ⚠️ db.js 是 Day 19 的代码，按 AGENTS.md 一.2 不顺手改 ⇒ 记为待办，请用户定夺。');

  console.log('\n结果：PASS ' + pass + ' ／ FAIL ' + fail);
  process.exit(fail ? 1 : 0);
})();
