/**
 * repositories/observationsRepository.js —— `observations` 表（观测记录）的数据访问
 * ============================================================
 * 全项目**所有**对 `observations` 表的写入都在这个文件里。
 *
 * 【Day 19 重构：这个文件承接了 index.js 里的 1 处查库】
 *   createObservation() 里的 insert → insert()
 *
 * 【Day 22：从 1 个方法长到 4 个（读 / 增 / 改 / 删配齐）】
 *   GET    /api/observations            →  listAll()
 *   POST   /api/observations            →  insert()
 *   PATCH  /api/observations?id=<uuid>  →  update()
 *   DELETE /api/observations?id=<uuid>  →  remove()
 *
 * ⚠️ 「用不着的方法不写」这条纪律照旧（Day 18 教训 25）：
 *    · `findById()` **仍然故意不写** —— update() / remove() 返回 null 就等于
 *      "这个 id 不存在"，再写一个查询去问同一件事，就是白读一次库的死代码。
 *      读接口给的是**列表**，也用不到单条查询。
 *    · 读接口**不加筛选 / 分页参数**：现在整张表就那么几行，
 *      加 `?limit=` 之类只会多一堆要校验、要写契约的东西。
 *      真需要了（行数涨起来）再加，那时它才有存在的理由。
 * ============================================================
 */

const conn = require('./db');
const db = conn.db;

/* 回吐给接口层的列 —— 契约 3.4.2 / 3.5 都明列这 6 个字段。
 * ⚠️ 提成常量、不在两处各写一遍：这 6 个列名必须和契约的 6 个字段一一对上，
 *    抄串一个（比如把 note 写漏）**不会报任何错**，只会让响应里默默少一个键 ——
 *    调用方还以为"这条记录就是没有备注"。
 *    （理由同 index.js 里的 BODY_NOT_OBJECT：两处要用就提出来，免得抄串。） */
const OBS_COLUMNS = 'id,body_id,observed_on,status,note,created_at';

/**
 * 取**全部**观测记录，按 `created_at` 倒序（最近录入的排最前）。
 *
 * @returns {Array} 记录数组；表是空的就返回**空数组**（不是 null、更不抛错）
 *
 * 【⭐ 为什么必须有 `.order()`】
 *   PostgreSQL **不保证**没有 ORDER BY 时的返回顺序 —— 不加排序的话，
 *   同一个查询跑两次可能给出不同顺序，"刚写的那条在第几个"每次刷新都在变。
 *   Day 16 在 bodies 上已经踩过一次（图鉴卡片顺序随机），这里不再犯。
 *
 * 【⭐ 为什么排**两次**（created_at 倒序 + id 升序）】
 *   `created_at` 精度到微秒，正常情况下不会撞；但**同一次批量插入**里的几行
 *   完全可能拿到同一个时间戳 ⇒ 这时"谁在前"就没有定义了，顺序依然会飘。
 *   ⇒ 追加一个**唯一**的次要排序键（`id` 是主键，不可能重复）当决胜：
 *      **排序结果唯一确定**。
 *   📌 这正是"排序看起来对"和"排序能证明"的区别 —— 后者要保证任何两次结果一致。
 *
 * 【⚠️ 为什么这里用 throwIfError，而 insert / update / remove 手动抛】
 *   throwIfError 会把 SDK 的错误对象压成一句 message、**丢掉 `code`**。
 *   写操作需要那个 code（认 23505 重复、认 42501 权限不足）；
 *   读操作**不需要认任何 code** —— 读挂了就是挂了，一句可读的话就够。
 *   ⇒ 读走 throwIfError（与 bodiesRepository.listAll 一致），写走手动抛。
 *     这个差别是**有理由的**，不是风格不统一。
 */
async function listAll() {
  const res = await db
    .from('observations')
    .select(OBS_COLUMNS)
    /* ⚠️ 两次 .order() 是**追加**关系（PostgREST 会拼成 `order=created_at.desc,id.asc`），
       不是覆盖 —— 这一点读过 SDK 源码确认过，不是猜的。 */
    .order('created_at', { ascending: false })
    .order('id', { ascending: true });

  conn.throwIfError(res, '读 observations');
  return res.data || [];
}

/**
 * 插入一条观测记录，返回**真正落库的那一行**（含数据库生成的 `created_at`）。
 *
 * @param {object} row 已经是 snake_case 的行对象（由 index.js 组装，见契约 4.7 的映射表）
 * @returns {object|null} 落库后的那一行；拿不到就返回 null
 *
 * 【为什么 row 的组装在 index.js、不在这里（Day 19 分层判据）】
 *   因为组装过程要做 camelCase → snake_case 的翻译（`bodyId` → `body_id`），
 *   而"接口字段叫什么"是**接口层的知识**，不是数据库的知识。
 *   repository 只管"把这行塞进去"。
 *   ⇒ 这也是为什么 uuidv4() 留在 index.js：表上 `id` 没有 DEFAULT、
 *      "id 由本函数生成"是**业务约定**（契约 3.4.2），不是数据库行为。
 *
 * 【⚠️ 两条来自 Day 18 的实测约束，搬动时原样保留】
 *   1. 全部走 `.insert(对象)`：值由平台做参数绑定，**不拼 SQL 字符串**
 *      （清单明确要求"SQL 参数化"）。
 *   2. `.select(...)` 会带上 `Prefer: return=representation` —— 让数据库把
 *      **真正落库的那一行**回给我们，而不是由前端自己猜。
 *
 * 【⚠️ 这里**不判断**是不是重复（23505）】
 *   重复冲突由表上的唯一约束 `uq_observations_body_date` 兜底，
 *   这里只把 `res.error` **原样抛出去**，让 index.js 去认 code 并翻译成中文。
 *   为什么：那句「该天体在 X 已有观测记录」是**给人看的接口文案**，
 *   属于"返响应"，不属于数据访问。（判据见 index.js 里的 isDuplicateError 注释）
 */
async function insert(row) {
  const res = await db
    .from('observations')
    .insert(row)
    .select(OBS_COLUMNS);

  /* ⚠️ 这里**不用 throwIfError**：那个工具会抛一句"写 observations 失败：…"，
     而 index.js 需要拿到**原始 error 对象**才有办法认 23505（重复）。
     抛新 Error 会把 code 埋进 message 里，判据就取不到了。
     ⇒ 手动抛，把原始错误对象带在 `cause` 上（Node 16+ 原生支持）。 */
  if (res.error) {
    const e = new Error('写 observations 失败：' + conn.describe(res.error));
    e.cause = res.error;
    throw e;
  }

  /* insert + return=representation 回来的是**数组**（PostgREST 的形状），取第一条。
     兜一层"万一直接给了对象"，免得因为形状差异整条接口挂掉。 */
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  return saved || null;
}

/**
 * 按 id 改一条观测记录，返回**改完之后的那一行**；id 不存在就返回 `null`。
 *
 * @param {string} id    观测记录的 uuid
 * @param {object} patch 要改的列（snake_case）。⚠️ 只允许 status / note ——
 *                       白名单在接口层（index.js 的 applyPatch），这里不重复判断。
 * @returns {object|null} 改完的那一行；**null 表示库里没有这个 id**
 *
 * 【为什么"返回 null"就足以回答"id 存在吗"】
 *   `.select()` 会让数据库带上 `Prefer: return=representation`，
 *   回来的数组里**只装真正被改到的行**。
 *   条件 `.eq('id', id)` 一行都没匹配上 → 数组为空 → 这里返回 null。
 *   ⇒ 不需要先查一次"在不在"，一次请求把"改"和"判存在"一起办了。
 *
 *   ⚠️ 值没变（比如 status 本来就是 observed）**不算"没匹配上"**：
 *      PostgreSQL 的 UPDATE 只要 WHERE 命中了行就计入影响行数，照样回吐那一行。
 *      所以"改了但值相同"和"id 不存在"在响应里**分得清清楚楚** ——
 *      这一点正是 PATCH 敢用"返回 null"当判据的前提。
 *
 * 【⚠️ 为什么不用 throwIfError（和 insert 同一个理由）】
 *   throwIfError 会把 SDK 的错误对象压成一句 message，`code` 就丢了。
 *   而 index.js 要靠 `code` 认出 42501（权限不足 = 云函数没配 CLOUDBASE_APIKEY）
 *   并给出排查提示 —— 少了它，云上只会回一句"服务暂时不可用"，看不出是权限问题。
 *   ⇒ 手动抛，把原始 error 挂在 `cause` 上（同 insert）。
 *
 *   📌 已知的小重复：**insert / update / remove 各有一段一模一样的三行**
 *      （`if (res.error) { new Error(...) ; e.cause = res.error ; throw }`）。
 *      到这里已经**第 3 处**了，确实到了该抽公共函数的时候 —— 但今天**仍然不抽**：
 *      AGENTS.md 一.2 不许"顺手优化已有代码"，而且抽它会同时动到 insert
 *      （那段正被 39 条回归测试盯着）⇒ 属计划外改动。
 *      ⇒ **已明确提出，建议单开一步做**（等用户点头），不塞在今天这条线里。
 */
async function update(id, patch) {
  const res = await db
    .from('observations')
    .update(patch)
    .eq('id', id)
    .select(OBS_COLUMNS);

  if (res.error) {
    const e = new Error('改 observations 失败：' + conn.describe(res.error));
    e.cause = res.error;
    throw e;
  }

  /* 形状兜底（同 insert）：正常是数组、取第一条；空数组 = 没匹配到 = id 不存在。
     万一平台直接给了对象，也接住。 */
  const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  return rows.length ? rows[0] : null;
}

/**
 * 按 id 删一条观测记录，返回**被删掉的那一行**；id 不存在就返回 `null`。
 *
 * @param {string} id 观测记录的 uuid
 * @returns {object|null} 被删掉的那一行（删**之前**的样子）；null 表示库里没有这个 id
 *
 * 【为什么返回"被删的那一行"、而不是"删了几行"】
 *   1. 与 update() **对称** —— 两个方法都是"按 id 动一行，成功回吐那一行，没有就 null",
 *      接口层的判断逻辑就能完全一样，不用记两套。
 *   2. 硬删了**就回不来了**（Day 22 拍板 Q4：主任务做硬删，软删留作余力加练）
 *      ⇒ 把"删之前长什么样"带回给接口层，前端才能给出**能核对的**反馈
 *        （"已删除：木星 2026-11-20"）。只回一个数字的话，用户永远不知道
 *        删掉的是不是他以为的那一条 —— 而这件事已经没法撤销了。
 *
 * ==================================================================
 * 🔴🔴 这个函数比 insert / update **更容易出事**，因为它的"默认行为"是危险的
 *
 *   新增写错了 = 多一行垃圾，删掉重来就行；
 *   删除写错了 = **数据没了，而且硬删撤不回来**。
 *
 *   而 DELETE 最可怕的写法不是"删错一条"，是**漏掉 `.eq()` —— 那会把整张表清空**。
 *   ⇒ 所以本函数做了 insert / update 都没有的一件事：**入口自查 id**（下面第 ① 步）。
 *
 *   ⚠️ 是不是"重复校验"（接口层已经查过 uuid 格式了）？不是。两层管的是两件事：
 *      · 接口层的校验服务**用户输入** —— 他说错了要给他一句中文；
 *      · 这里的检查服务**调用方**（也就是我们自己写错的代码）—— 这是最后一道闸。
 *      代价 2 行；收益是"这个函数**不可能**发出不带条件的删除"。
 *      删除类操作的值守成本远低于新增，因为两侧出错的后果差着量级
 *      —— 这正是"删除为什么比新增更容易出事"的答案。
 * ==================================================================
 *
 * 【⚠️ 为什么不判 23505 / 23503（和 update 一样）】
 *   `observations` 是**叶子表** —— 没有任何表靠外键引用它
 *   （关系是单向的：`observations.body_id → bodies.id`，反过来没人指 observations）。
 *   所以删它不会撞外键约束，没有可判的冲突码。
 *   📌 记一笔：**哪天有别的表引用 observations，这里就必须补错误翻译**，
 *      否则"删不掉"会被说成"服务暂时不可用"。
 *
 * 【⚠️ 为什么不用 throwIfError】同 insert / update —— 它会把 `code` 埋进 message，
 *   接口层就认不出 42501（权限不足 = 没配 CLOUDBASE_APIKEY）。
 */
async function remove(id) {
  /* ① 入口自查（见上面 🔴🔴 那段）——
     空 id 不可能是"想删某一行"，一定是调用方出错了。
     ⚠️ 宁可抛异常也不把请求发出去：不带条件的 DELETE 会清空整张表。 */
  if (!id) {
    throw new Error('remove() 拒绝执行：没有给出 id。不带条件的删除会清空整张表。');
  }

  const res = await db
    .from('observations')
    /* ⚠️ `.delete()` 无参是对的 —— SDK 里它的签名是 `delete(options = {})`，
       参数只用来传 `count`（统计口径），不是过滤条件。
       过滤条件靠链在后面的 `.eq()`。 */
    .delete()
    .eq('id', id) /* 🔴 这一行是"只删一条"的**全部保证**，绝不能省、绝不能写错 */
    .select(OBS_COLUMNS); /* 链了 `.select()` 才会把**被删掉的行**回吐给我们 */

  if (res.error) {
    const e = new Error('删 observations 失败：' + conn.describe(res.error));
    e.cause = res.error;
    throw e;
  }

  /* 形状兜底（同 insert / update）：正常是数组，取第一条；
     空数组 = 没有行匹配这个 id = 本来就没有这条记录 → 返回 null。 */
  const rows = Array.isArray(res.data) ? res.data : res.data ? [res.data] : [];
  return rows.length ? rows[0] : null;
}

module.exports = { listAll: listAll, insert: insert, update: update, remove: remove };
