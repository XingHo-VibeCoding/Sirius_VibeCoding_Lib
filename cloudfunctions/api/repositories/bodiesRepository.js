/**
 * repositories/bodiesRepository.js —— `bodies` 表（天体）的数据访问
 * ============================================================
 * 全项目**所有**对 `bodies` 表的读写都在这个文件里。
 * 外面（index.js）只调这里的方法，不认识表名、不认识列名。
 *
 * 【Day 19 重构：这个文件承接了 index.js 里的 3 处查库】
 *   ① loadBodies()        → listAll()
 *   ② createObservation() 里校验 bodyId 存在 → existsById()
 *   ③ dispatch() 详情分支   → findById()
 *
 * ⚠️ ② 和 ③ 是**同一个查询**（都是"按 id 查一行"），只是用途不同：
 *    ② 只关心"有没有"，③ 要整行。现在它们是两个方法，但都走同一张表、同一个 `.eq('id', …)`——
 *    将来要改（比如加个软删除过滤），改的是这里，不用去 index.js 翻。
 * ============================================================
 */

const conn = require('./db');
const db = conn.db;

/**
 * 取全部天体，按 `sort_order` 升序。
 *
 * ⚠️ 排序必须有：契约 3.1 的列表顺序依据就是 `sort_order`（1..11，
 *    太阳→水星→…→哈雷），不是数据库的物理顺序。少了 `.order()`，
 *    PostgreSQL 不保证返回顺序，图鉴卡片的顺序就会随机变。
 */
async function listAll() {
  const res = await db.from('bodies').select('*').order('sort_order', { ascending: true });
  conn.throwIfError(res, '读 bodies');
  return res.data || [];
}

/**
 * 这个 id 在天体表里存在吗？→ boolean
 *
 * ⚠️ 只 select `id`（不是 `*`）：这个查询只回答"有没有"，
 *    多取 27 列是白费流量。
 * ⚠️ `.limit(1)` 是**性能保险**：id 是主键，最多也就一行，但写上限能让
 *    数据库不用扫全表（而且万一哪天约束被去掉，也不会一次拖回一堆）。
 *
 * 【原代码在 createObservation 里，注释说：】
 *   查不到给 BAD_REQUEST 而**不是** NOT_FOUND：URI 是合法的，
 *   错在"请求体里引用了一个不存在的天体"，属于参数不合法（契约 3.4.2 有争论记录）。
 *   ⚠️ 那个判断**不在这里** —— repository 只回答"在不在"，
 *      "在不在该报什么错"是接口层的决定（见 index.js）。
 */
async function existsById(id) {
  const res = await db.from('bodies').select('id').eq('id', id).limit(1);
  conn.throwIfError(res, '读 bodies');
  return (res.data || []).length > 0;
}

/**
 * 按 id 取一行；没有就返回 `null`。
 *
 * ⚠️ 返回 `null` 而不是抛异常：
 *    "库里没有这个天体"是**正常结果**，不是错误 —— 它对应契约 3.2 的 `NOT_FOUND`，
 *    由 index.js 翻译成那句「没有找到「xxx」这个天体。」。
 *    抛异常的话，main 的 catch 会把它统一变成 INTERNAL（"服务暂时不可用"），
 *    那就把"用户写错了 id"说成"服务器坏了"。
 */
async function findById(id) {
  /* ⚠️ 参数化查询：id 的值通过 .eq() 交给平台做参数绑定，
     不会拼进 SQL 字符串（与 Day 18 写接口的 .insert() 同一个道理）。 */
  const res = await db.from('bodies').select('*').eq('id', id).limit(1);
  conn.throwIfError(res, '读 bodies');
  const rows = res.data || [];
  return rows.length ? rows[0] : null;
}

module.exports = {
  listAll: listAll,
  existsById: existsById,
  findById: findById
};
