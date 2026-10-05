// ============================================================================
//  db/gen-seed.mjs —— 生成 db/seed.sql（Day 16 的辅助工具）
//
//  用法（在仓库根目录或任意位置都行，路径从本文件自身推导）：
//      node db/gen-seed.mjs
//  可选：指定输出文件
//      node db/gen-seed.mjs db/seed.sql
//
//  ⚠️ 关于这个文件的性质
//  它是**工具**，不是 Day 16 清单点名要交的东西（清单点名的是 schema.sql 和 seed.sql）。
//  之所以放进仓库，是因为：seed.sql 里的值（11 行 × 28 列 = 308 个）**手抄必错**，
//  必须有一个可执行的原件来证明"这些数字是从 src/data/bodies.js 长出来的"，
//  并且在数据源改动后能重新生成。
//
//  它做三件事：
//    1. 实跑 src/data/bodies.js（vm.runInContext）→ 拿到真实结构，不靠记忆、不手抄
//    2. 从 db/schema.sql 抽取建表段 → 两个文件不会漂移（单一事实来源）
//    3. 拼成 db/seed.sql（DROP → CREATE → INSERT，自包含、可重复执行）
//
//  输出是**可字节复现**的：同样输入跑两次，产物逐字节相同（所以故意不写时间戳）。
//  ⇒ 想检查 seed.sql 有没有过期：重新跑一次本脚本，然后 git diff 看有没有变化。
// ============================================================================

import fs from 'fs';
import path from 'path';
import vm from 'vm';
import { fileURLToPath } from 'url';

// ---------- 0. 路径：从本文件自身推导，**不写死任何绝对路径** ----------
// 本文件位于 <仓库根>/db/gen-seed.mjs
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');
const OUT  = path.resolve(process.argv[2] || path.join(HERE, 'seed.sql'));

// ---------- 1. 实跑数据文件，拿真实结构 ----------
const bodiesPath = path.join(REPO, 'src/data/bodies.js');
if (!fs.existsSync(bodiesPath)) throw new Error(`找不到数据源：${bodiesPath}`);
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(bodiesPath, 'utf8'), ctx);

const BODIES  = ctx.window.SOLAR_BODIES;
const SOURCES = ctx.window.DATA_SOURCES;

if (!Array.isArray(BODIES) || BODIES.length === 0) throw new Error('没读到 window.SOLAR_BODIES');
if (!SOURCES || Object.keys(SOURCES).length === 0) throw new Error('没读到 window.DATA_SOURCES');

// ---------- 2. 从 schema.sql 抽取建表段（单一事实来源）-----------------------
const schemaPath = path.join(REPO, 'db/schema.sql');
if (!fs.existsSync(schemaPath)) throw new Error(`找不到建表脚本：${schemaPath}`);
const schemaSrc = fs.readFileSync(schemaPath, 'utf8');

// ⚠️ 起点必须锚在**行首**的 DROP 语句上 ——
//    不能用 indexOf('DROP TABLE IF EXISTS')，因为这个词在 schema.sql 的注释正文里也出现过
//    （"开头先 DROP TABLE IF EXISTS，所以这份脚本跑几次都不会报错"），会从注释中间切开。
// ⚠️ Day 18 修：只锚"**行首的 DROP TABLE IF EXISTS**"，而**不写表名**。
//    原来写死的是 bodies，Day 18 加第 3 张表（observations）时就必须回来改 —— 属于白踩一次。
const MARK = '--  自检：';
const startMatch = /^DROP TABLE IF EXISTS /m.exec(schemaSrc);
const markIdx = schemaSrc.indexOf(MARK);
if (!startMatch) throw new Error('在 schema.sql 里找不到行首的 "DROP TABLE IF EXISTS"');
const startIdx = startMatch.index;
if (markIdx < 0 || markIdx <= startIdx) throw new Error(`在 schema.sql 里找不到自检段标记 "${MARK}"`);
let ddl = schemaSrc.slice(startIdx, markIdx).replace(/\n-- -+\n\s*$/, '\n').trimEnd() + '\n';

// 兜底断言：缺了就必须报错，不许生成一个残缺的种子文件
// ⚠️ **加表时必须同步加这里** —— 它防的是"抽取范围悄悄少了一张表"这种最坏的假通过。
for (const t of ['CREATE TABLE sources', 'CREATE TABLE bodies', 'CREATE TABLE observations']) {
  if (!ddl.includes(t)) throw new Error(`抽取出的建表段缺少 "${t}"，拒绝生成`);
}
if (!ddl.startsWith('DROP TABLE IF EXISTS ')) throw new Error('抽取起点不对：ddl 不是以 DROP 语句开头');
if (ddl.includes('db/schema.sql —— 建表脚本')) throw new Error('抽取起点选错：把 schema.sql 的头部注释也抄进来了');

// Day 18 新增断言：**三张表的 DROP 都必须排在第一个 CREATE 之前**。
// 防的是有人把某张表的 DROP 挪到 CREATE 后面 —— 那样 seed.sql 重跑会撞 "already exists"。
{
  const firstCreate = ddl.indexOf('CREATE TABLE');
  const beforeFirstCreate = firstCreate < 0 ? '' : ddl.slice(0, firstCreate);
  for (const t of ['observations', 'bodies', 'sources']) {
    if (!new RegExp(`^DROP TABLE IF EXISTS ${t}\\b`, 'm').test(beforeFirstCreate)) {
      throw new Error(`"DROP TABLE IF EXISTS ${t}" 没有出现在第一个 CREATE TABLE 之前，拒绝生成`);
    }
  }
}

// ---------- 3. SQL 字面量 --------------------------------------------------
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lit = (v) => {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new Error(`非法数值：${v}`);
    return String(v);
  }
  return q(v);
};

// ---------- 4. 把「来源 URL 串」映射回 sources 的键名 ------------------------
// 代码里天体只存 URL 串；月球是两个 URL 用「＋」拼起来的。这里逆映射回键名。
const url2key = new Map(Object.entries(SOURCES).map(([k, v]) => [v.url, k]));

function resolveSourceIds(body) {
  const parts = String(body.source).split('＋').map((s) => s.trim()).filter(Boolean);
  const keys = parts.map((u) => {
    const k = url2key.get(u);
    // 宁可直接炸掉，也不要悄悄写一个不存在的 source_id
    if (!k) throw new Error(`天体 ${body.id} 的来源 URL 在 DATA_SOURCES 里找不到：${u}`);
    return k;
  });
  return { primary: keys[0], extra: keys.length > 1 ? keys.slice(1) : [] };
}

// ---------- 5. 拼 INSERT --------------------------------------------------
const SRC_COLS = ['id', 'label', 'url'];
const srcRows = Object.entries(SOURCES).map(
  ([key, v]) => `  (${[q(key), q(v.label), q(v.url)].join(', ')})`
);

// 列顺序必须和 schema.sql 里的定义顺序完全一致
const BODY_COLS = [
  'id', 'name_zh', 'name_en', 'type', 'diameter_km', 'distance_from_sun_km', 'distance_raw',
  'orbital_period_days', 'eccentricity', 'ratio_diameter', 'ratio_distance', 'ratio_period',
  'appearance_main_color', 'appearance_has_ring', 'appearance_note', 'appearance_ring_note',
  'source_id', 'source_extra_id', 'source_status',
  'parent_id', 'distance_from_parent_km', 'distance_from_parent_raw', 'orbital_period_note',
  'extent_raw', 'orbital_period_raw', 'perihelion_au', 'aphelion_au',
  'sort_order',
];
// 每行按语义分组换行：7 / 5 / 4 / 3 / 4 / 4 / 1 = 28
const GROUPS = [7, 5, 4, 3, 4, 4, 1];
if (GROUPS.reduce((a, b) => a + b, 0) !== BODY_COLS.length) throw new Error('分组数与列数不符');

const bodyRows = BODIES.map((b, i) => {
  const { primary, extra } = resolveSourceIds(b);
  const av = b.appearance || {};
  const cmp = b.compareToEarth || {};
  const vals = [
    lit(b.id), lit(b.nameZh), lit(b.nameEn), lit(b.type), lit(b.diameterKm),
    lit(b.distanceFromSunKm), lit(b.distanceRaw),
    lit(b.orbitalPeriodDays), lit(b.eccentricity), lit(cmp.diameter), lit(cmp.distance), lit(cmp.period),
    lit(av.mainColor), lit(av.hasRing), lit(av.note), lit(av.ringNote),
    lit(primary), extra.length ? lit(extra[0]) : 'NULL', lit(b.sourceStatus),
    lit(b.parentId), lit(b.distanceFromParentKm), lit(b.distanceFromParentRaw), lit(b.orbitalPeriodNote),
    lit(b.extentRaw), lit(b.orbitalPeriodRaw), lit(b.perihelionAu), lit(b.aphelionAu),
    lit(i + 1),
  ];
  if (vals.length !== BODY_COLS.length) throw new Error(`${b.id} 值数量 ${vals.length} ≠ 列数 ${BODY_COLS.length}`);

  const lines = [];
  let p = 0;
  for (const n of GROUPS) {
    lines.push(vals.slice(p, p + n).join(', '));
    p += n;
  }
  // ⚠️ 行的名字注释必须放在**行首**，不能放在最后一个值后面 ——
  //    放后面会生成 `1,  -- 太阳)`，而 SQL 的 `--` 会把右括号一起注释掉 ⇒ 括号不闭合 ⇒ 语法错误。
  let body = '';
  lines.forEach((l, idx) => {
    const isLast = idx === lines.length - 1;
    body += (idx === 0 ? '  (' : '   ') + l + (isLast ? ')' : ',\n');
  });
  return `  -- ${b.nameZh}\n${body}`;
});

// ---------- 6. 输出（不带时间戳 ⇒ 同样输入跑两次产物逐字节相同）------------
const out = `-- ============================================================================
--  db/seed.sql —— 种子数据（Day 16 建；Day 18 加第 3 张表）
--  环境：腾讯云 CloudBase · PostgreSQL
--  内容：sources 4 行 + bodies 11 行（共 15 行**真实数据**）
--        + observations —— **只建表，不插数据（0 行）**
--
--  ⚠️ 为什么 observations 一行都不插？
--     它是"**用户产出的数据**"，内容只能由 POST /api/observations 写出来（Day 18）。
--     给它编种子数据 = 编造用户记录。空表起步正好当第 4 步验证的对照。
--
--  ⚠️ 本文件是**生成出来的**，不要手改 —— 手改会在下次重新生成时被覆盖。
--     重新生成： node db/gen-seed.mjs
--     生成器  ： db/gen-seed.mjs
--     数据来源： src/data/bodies.js（生成器会真的把它跑起来读值）
--
--  【自包含】本文件包含 DROP → CREATE TABLE → INSERT 三段，单独跑就能从零到有数据。
--  ⚠️ 代价：建表段与 db/schema.sql 是重复的。
--     但这段 DDL 是**从 schema.sql 抽取**来的（生成器断言过两处 CREATE TABLE 都在），
--     所以两者不会漂移；改结构请改 schema.sql，再跑一次 gen-seed.mjs。
--
--  【可重复执行】开头 DROP TABLE IF EXISTS，跑几次都不会报错，结果都一样。
--
--  【数据从哪来】INSERT 的值**不是手抄的**：11 × 28 = 308 个值，手抄必错。
--     生成器把 src/data/bodies.js 真正跑起来（vm.runInContext 读 SOLAR_BODIES /
--     DATA_SOURCES），再把真实值吐成 SQL 字面量。
--     ✅ 全部 11 个天体、4 个来源，一个没编造、一个没漏。
--
--  【⚠️ 插入顺序有讲究】bodies.parent_id 是指向 bodies 自己的外键（月球 → 地球），
--     所以**地球必须先于月球插入**。下面的顺序是 sort_order 1..11：
--     太阳 → 水星 → 金星 → 地球 → 月球 → 火星 → 木星 → 土星 → 天王星 → 海王星 → 哈雷彗星
--     （地球是第 4 条，月球是第 5 条 ✅ 满足外键要求）
-- ============================================================================


-- ----------------------------------------------------------------------------
--  建表段 —— 从 db/schema.sql 抽取（起点=行首的 DROP TABLE，终点=自检段之前）
-- ----------------------------------------------------------------------------
${ddl}

-- ----------------------------------------------------------------------------
--  sources —— 4 行（代码里 DATA_SOURCES 的全部，如实 4 条，没有凑第 5 个）
-- ----------------------------------------------------------------------------
INSERT INTO sources
  (${SRC_COLS.join(', ')})
VALUES
${srcRows.join(',\n')};


-- ----------------------------------------------------------------------------
--  bodies —— 11 行
--   月球（第 5 条）同时填了 source_id 和 source_extra_id —— 全表唯一的"两个来源"
-- ----------------------------------------------------------------------------
INSERT INTO bodies
  (${BODY_COLS.join(', ')})
VALUES
${bodyRows.join(',\n')};


-- ----------------------------------------------------------------------------
--  自检：跑完立刻确认行数（应回 bodies 11 / observations 0 / sources 4）
-- ----------------------------------------------------------------------------
SELECT 'sources' AS tbl, count(*) AS n_rows FROM sources
UNION ALL
SELECT 'bodies', count(*) FROM bodies
UNION ALL
SELECT 'observations', count(*) FROM observations;
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, out, 'utf8');

console.log('✅ 已生成', OUT);
console.log('   sources 行数 =', srcRows.length);
console.log('   bodies  行数 =', bodyRows.length);
console.log('   observations 行数 = 0（Day 18：只建表，不插数据）');
const moon = BODIES.find((b) => b.id === 'moon');
const r = resolveSourceIds(moon);
console.log('   月球来源验证 :', r.primary, '+', r.extra.join(',') || '(无)');
