/**
 * repositories/observationsRepository.js —— `observations` 表（观测记录）的数据访问
 * ============================================================
 * 全项目**所有**对 `observations` 表的写入都在这个文件里。
 *
 * 【Day 19 重构：这个文件承接了 index.js 里的 1 处查库】
 *   createObservation() 里的 insert → insert()
 *
 * ⚠️ 本文件只有 `insert`，**没有** 查询 / 更新 / 删除 —— 因为接口一个都没有：
 *    契约 3.4.6 明确"不做的五件事"里就有 `GET /api/observations` / `PATCH` / `DELETE`。
 *    **今天也不许加**（Day 19 清单的「今日不做：加新功能」）。
 *    用不着的方法不写 —— 写了就是"看着有用、实际是死代码"的陷阱（Day 18 教训 25）。
 * ============================================================
 */

const conn = require('./db');
const db = conn.db;

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
    .select('id,body_id,observed_on,status,note,created_at');

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

module.exports = { insert: insert };
