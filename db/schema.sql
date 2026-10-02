-- ============================================================================
--  db/schema.sql —— 建表脚本（Day 16）
--  环境：腾讯云 CloudBase · PostgreSQL
--  目标：建出 bodies（天体 11 行）与 sources（数据来源 4 行）两张表
--
--  【设计依据】本文件里的每个字段，都是从 src/data/bodies.js 的**实际结构**推出来的
--  （用探针实跑 vm.runInContext 读 window.SOLAR_BODIES 得到 11 个天体 / 21 个字段名），
--  不是凭印象写的。事实来源优先级：实际代码 > 实际环境 > 实际运行结果 > 记忆和旧文档。
--
--  【可重复执行】开头先 DROP TABLE IF EXISTS，所以这份脚本跑几次都不会报错。
--
--  ⚠️ 为什么用 DROP + CREATE，而不是 CREATE TABLE IF NOT EXISTS？
--     因为表结构一旦改过（比如今天从 22 列改成 28 列），
--     IF NOT EXISTS 会"看见表已存在就跳过"，悄悄留下一张旧结构的表，
--     后面所有查询都在测一张不该存在的表 —— 最坏的一类假通过。
--     代价是表里的数据会一起没掉。本阶段还没有真实数据，
--     而且 seed.sql 反正也会重新灌一遍，所以这个代价是零。
-- ============================================================================

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
--  自检：跑完立刻确认"表在不在、列数对不对"
--  （只要脚本跑成功，这一句一定会回 28 和 3）
-- ----------------------------------------------------------------------------
SELECT table_name, count(*) AS column_count
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('bodies', 'sources')
 GROUP BY table_name
 ORDER BY table_name;
