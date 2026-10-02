-- ============================================================================
--  db/seed.sql —— 种子数据（Day 16）
--  环境：腾讯云 CloudBase · PostgreSQL
--  内容：sources 4 行 + bodies 11 行，共 15 行**真实数据**
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
DROP TABLE IF EXISTS bodies  CASCADE;
DROP TABLE IF EXISTS sources CASCADE;


-- ----------------------------------------------------------------------------
--  sources —— 数据来源（4 行）
--  来源：代码里本来就有的 DATA_SOURCES 结构，恰好 4 条
-- ----------------------------------------------------------------------------
CREATE TABLE sources (
  id     text PRIMARY KEY,   -- 主键沿用代码里的键名：factSheetMetric / sunFactSheet /
                             --   moonFactSheet / jplSbdbHalley
                             --   （用短标识而不是自增数字：外键一眼看懂，种子脚本可复现）
  label  text NOT NULL,      -- 给人看的名字，如 "NASA Planetary Fact Sheet (Metric)"
  url    text NOT NULL       -- 来源地址
);


-- ----------------------------------------------------------------------------
--  bodies —— 天体（11 行：太阳 + 八大行星 + 月球 + 哈雷彗星）
--
--  为什么数值列一律用 numeric 而不是 int / float？
--    · int   —— 哈雷的日距是 2,677,801,886 km，超过 int 上限 2,147,483,647，会直接溢出；
--    · float —— 直径 11.0 这类小数会有精度误差，且"12756"可能存成"12756.000000001"；
--    · numeric —— 精确、无上限、小数整数都能装。11 行的表，性能完全不是问题，清晰优先。
--
--  为什么列名是 snake_case（name_zh）而不是照抄 camelCase（nameZh）？
--    PostgreSQL 里不加双引号的标识符会被折叠成小写 ⇒ nameZh 会变成 namezh，
--    前端读 row.nameZh 会拿到 undefined（经典坑）。
--    接口层（Day 17）负责把它映射回 camelCase，这是标准做法。
-- ----------------------------------------------------------------------------
CREATE TABLE bodies (
  id                       text    PRIMARY KEY,   -- 代码里的 id：sun / earth / moon / halley …
                                                  --   接口 /api/bodies/:id 直接用它
  name_zh                  text    NOT NULL,      -- 地球
  name_en                  text    NOT NULL,      -- Earth
                                                  --   唯一性由下面的 uq_bodies_name_en 保证
                                                  --   （Day 16 修订：起初只在注释里写了"唯一"、
                                                  --    没真的写 UNIQUE，属于"注释承诺了、实现没给"）
  type                     text    NOT NULL,      -- 取值只有 4 种，见文件末尾 CHECK

  diameter_km              numeric NOT NULL,      -- 直径（km）。哈雷是 11.0，必须有小数位
  distance_from_sun_km     numeric NOT NULL,      -- 距太阳（km）。太阳自己是 0
  distance_raw             text    NOT NULL,      -- 界面上原样显示的写法："149.6 × 10^6 km"
  orbital_period_days      numeric,               -- 公转周期（天）。⚠️ 太阳为 NULL
  eccentricity             numeric,               -- 轨道离心率。⚠️ 太阳为 NULL

  ratio_diameter           numeric NOT NULL,      -- 以下三个来自 compareToEarth
  ratio_distance           numeric,               -- ⚠️ 太阳为 NULL
  ratio_period             numeric,               -- ⚠️ 太阳为 NULL

  appearance_main_color    text    NOT NULL,      -- 主色，如 #3B7EC8
  appearance_has_ring      boolean NOT NULL,      -- 有没有环
  appearance_note          text,                  -- 备注。只有太阳、哈雷有
  appearance_ring_note     text,                  -- 环的说明。只有木星、土星、天王星有

  source_id                text    NOT NULL,      -- 主来源 → sources(id)
  source_extra_id          text,                  -- 附加来源 → sources(id)。只有月球有
  source_status            text    NOT NULL,      -- 数据状态，取值为 verified

  parent_id                text,                  -- 母天体（自引用 → bodies(id)）。只有月球 = 'earth'
  distance_from_parent_km  numeric,               -- 距母天体（km）。只有月球有
  distance_from_parent_raw text,                  -- 距母天体原始写法。只有月球有
  orbital_period_note      text,                  -- 公转周期备注。只有月球有（"这是绕地球的，不是绕太阳"）

  extent_raw               text,                  -- 三轴尺寸原始写法。只有哈雷有
  orbital_period_raw       text,                  -- 公转周期原始写法。只有哈雷有
  perihelion_au            numeric,               -- 近日点（au）。只有哈雷有
  aphelion_au              numeric,               -- 远日点（au）。只有哈雷有

  sort_order               integer NOT NULL,      -- 图鉴显示顺序，1=太阳 … 11=哈雷

  -- ---- 约束（集中写在这里，一眼看全）--------------------------------------
  CONSTRAINT ck_bodies_type
    CHECK (type IN ('star', 'planet', 'moon', 'comet')),
  CONSTRAINT ck_bodies_source_status
    CHECK (source_status IN ('verified', 'unverified')),
  CONSTRAINT ck_bodies_diameter
    CHECK (diameter_km > 0),
  CONSTRAINT ck_bodies_distance
    CHECK (distance_from_sun_km >= 0),
  CONSTRAINT ck_bodies_period
    CHECK (orbital_period_days IS NULL OR orbital_period_days > 0),
  CONSTRAINT ck_bodies_eccentricity
    CHECK (eccentricity IS NULL OR (eccentricity >= 0 AND eccentricity < 1)),
  CONSTRAINT ck_bodies_sort_order
    CHECK (sort_order > 0),
  CONSTRAINT ck_bodies_no_self_parent
    CHECK (parent_id IS NULL OR parent_id <> id),
  CONSTRAINT uq_bodies_name_en
    UNIQUE (name_en),
  CONSTRAINT uq_bodies_sort_order
    UNIQUE (sort_order),

  -- ---- 外键 --------------------------------------------------------------
  -- ON DELETE RESTRICT：来源被引用时不允许删掉它（来源是"字典表"，不该被随手删）
  CONSTRAINT fk_bodies_source
    FOREIGN KEY (source_id)       REFERENCES sources (id) ON DELETE RESTRICT,
  CONSTRAINT fk_bodies_source_extra
    FOREIGN KEY (source_extra_id) REFERENCES sources (id) ON DELETE RESTRICT,
  -- 自引用外键：parent_id 指向本表的另一行（月球 → 地球）
  -- ⚠️ 因此 INSERT 顺序有讲究：地球必须先于月球
  CONSTRAINT fk_bodies_parent
    FOREIGN KEY (parent_id)       REFERENCES bodies (id)  ON DELETE RESTRICT
);

-- 刻意**不加**额外索引：两张表一共 15 行，主键和 UNIQUE 已经自带索引，
-- 再加 type / source_id 的索引纯属浪费。等数据量真的大了再说。


-- ----------------------------------------------------------------------------
--  sources —— 4 行（代码里 DATA_SOURCES 的全部，如实 4 条，没有凑第 5 个）
-- ----------------------------------------------------------------------------
INSERT INTO sources
  (id, label, url)
VALUES
  ('factSheetMetric', 'NASA Planetary Fact Sheet (Metric)', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/'),
  ('sunFactSheet', 'NASA Sun Fact Sheet', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html'),
  ('moonFactSheet', 'NASA Moon Fact Sheet', 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html'),
  ('jplSbdbHalley', 'NASA/JPL Small-Body Database (SBDB) — 1P/Halley', 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1P');


-- ----------------------------------------------------------------------------
--  bodies —— 11 行
--   月球（第 5 条）同时填了 source_id 和 source_extra_id —— 全表唯一的"两个来源"
-- ----------------------------------------------------------------------------
INSERT INTO bodies
  (id, name_zh, name_en, type, diameter_km, distance_from_sun_km, distance_raw, orbital_period_days, eccentricity, ratio_diameter, ratio_distance, ratio_period, appearance_main_color, appearance_has_ring, appearance_note, appearance_ring_note, source_id, source_extra_id, source_status, parent_id, distance_from_parent_km, distance_from_parent_raw, orbital_period_note, extent_raw, orbital_period_raw, perihelion_au, aphelion_au, sort_order)
VALUES
  -- 太阳
  ('sun', '太阳', 'Sun', 'star', 1391400, 0, '0（太阳为太阳系中心）',
   NULL, NULL, 109.2, NULL, NULL,
   '#F2B230', FALSE, '自身发光的恒星，画成亮黄圆盘', NULL,
   'sunFactSheet', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   1),
  -- 水星
  ('mercury', '水星', 'Mercury', 'planet', 4879, 57900000, '57.9 × 10^6 km',
   88, 0.206, 0.383, 0.387, 0.241,
   '#9C9188', FALSE, NULL, NULL,
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   2),
  -- 金星
  ('venus', '金星', 'Venus', 'planet', 12104, 108200000, '108.2 × 10^6 km',
   224.7, 0.007, 0.949, 0.723, 0.615,
   '#E8D9A0', FALSE, NULL, NULL,
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   3),
  -- 地球
  ('earth', '地球', 'Earth', 'planet', 12756, 149600000, '149.6 × 10^6 km',
   365.2, 0.017, 1, 1, 1,
   '#3B7EC8', FALSE, NULL, NULL,
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   4),
  -- 月球
  ('moon', '月球', 'Moon', 'moon', 3475, 149600000, '≈149.6 × 10^6 km（与地球相同）',
   27.3217, 0.0549, 0.2727, 0.00257, 0.0748,
   '#B8B5AE', FALSE, NULL, NULL,
   'factSheetMetric', 'moonFactSheet', 'verified',
   'earth', 384400, '0.3844 × 10^6 km（距地球的半长轴）', '这是绕【地球】的公转周期，不是绕太阳',
   NULL, NULL, NULL, NULL,
   5),
  -- 火星
  ('mars', '火星', 'Mars', 'planet', 6792, 228000000, '228.0 × 10^6 km',
   687, 0.094, 0.532, 1.52, 1.88,
   '#C1653B', FALSE, NULL, NULL,
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   6),
  -- 木星
  ('jupiter', '木星', 'Jupiter', 'planet', 142984, 778500000, '778.5 × 10^6 km',
   4331, 0.049, 11.21, 5.2, 11.9,
   '#D8A47F', TRUE, NULL, '木星有微弱行星环，2D 主图暂不画',
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   7),
  -- 土星
  ('saturn', '土星', 'Saturn', 'planet', 120536, 1432000000, '1432.0 × 10^6 km',
   10747, 0.052, 9.45, 9.57, 29.4,
   '#E3CE9A', TRUE, NULL, '土星环最显著，主图上要画出来',
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   8),
  -- 天王星
  ('uranus', '天王星', 'Uranus', 'planet', 51118, 2867000000, '2867.0 × 10^6 km',
   30589, 0.047, 4.01, 19.17, 83.7,
   '#9BD8DC', TRUE, NULL, '天王星也有环，但很暗，主图暂不画',
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   9),
  -- 海王星
  ('neptune', '海王星', 'Neptune', 'planet', 49528, 4515000000, '4515.0 × 10^6 km',
   59800, 0.01, 3.88, 30.18, 163.7,
   '#3E5FA8', FALSE, NULL, NULL,
   'factSheetMetric', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   NULL, NULL, NULL, NULL,
   10),
  -- 哈雷彗星
  ('halley', '哈雷彗星', '1P/Halley', 'comet', 11, 2677801886, '17.9 au（半长轴）',
   27700, 0.968, 0.00086, 17.9, 75.8,
   '#6E6E6E', FALSE, '反照率仅 0.04，是太阳系最暗的天体之一', NULL,
   'jplSbdbHalley', NULL, 'verified',
   NULL, NULL, NULL, NULL,
   '14.9 × 8.2 km（三轴尺寸）', '27,700 d（≈75.8 年）', 0.575, 35.3,
   11);


-- ----------------------------------------------------------------------------
--  自检：跑完立刻确认行数（应回 sources 4 / bodies 11）
-- ----------------------------------------------------------------------------
SELECT 'sources' AS tbl, count(*) AS n_rows FROM sources
UNION ALL
SELECT 'bodies', count(*) FROM bodies;
