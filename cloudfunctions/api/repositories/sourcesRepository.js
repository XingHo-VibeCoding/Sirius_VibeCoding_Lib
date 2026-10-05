/**
 * repositories/sourcesRepository.js —— `sources` 表（数据来源）的数据访问
 * ============================================================
 * 全项目**所有**对 `sources` 表的读取都在这个文件里。
 *
 * 【Day 19 重构：这个文件承接了 index.js 里的 1 处查库】
 *   loadSourceUrls() → urlMap()
 * ============================================================
 */

const conn = require('./db');
const db = conn.db;

/**
 * 取「来源编号 → 网址」的映射表。返回 `{ factSheetMetric: 'https://…', … }`。
 *
 * ⚠️ 返回的是**映射**，不是那 4 行原始数据 —— 这是 Day 19 第 0 步拍板决定的（选项：搬进 repository）。
 *    理由：这个映射**只服务于这一个查询**，除了"给 buildSource() 查网址"之外没有任何别的用途。
 *    把它留在 index.js 只会多一段循环，而且那段循环仍然"知道 id / url 是列名"——按判据它本来就该在这一层。
 *    代价：repository 稍微"多知道一点接口要什么形状"。这个取舍已如实记在这里。
 *
 * 【数据形状的背景（搬过来时原样保留）】
 *   字典表只有 4 行 —— 一次读全，在内存里做「编号 → 网址」的映射，
 *   比逐行做外键嵌套查询直白得多，而 4 行的成本是零。
 *
 * ⚠️ 只 select `id, url` 两列：`label`（显示名）接口用不上，不取。
 */
async function urlMap() {
  const res = await db.from('sources').select('id, url');
  conn.throwIfError(res, '读 sources');

  const map = {};
  (res.data || []).forEach(function (r) {
    map[r.id] = r.url;
  });
  return map;
}

module.exports = { urlMap: urlMap };
