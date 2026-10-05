-- ============================================================================
--  db/schema.sql —— 建表脚本（Day 16）
--  环境：腾讯云 CloudBase · PostgreSQL
--  目标：建出三张表 —— sources（数据来源 4 行）· bodies（天体 11 行）· observations（观测记录，**0 行**）
--        ⚠️ observations 是 **Day 18 新增**的（项目里第一张"**用户产出的数据**"表）；
--           Day 16 只建了前两张。它的结构定在 api-contract.md 的 **3.4.4**。
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

-- ⚠️ DROP 顺序 = 建表顺序的**倒序**：先删"引用别人"的 observations，再删被引用的 bodies / sources。
--    生成器（gen-seed.mjs）就是锚在**这一段的第一行**上来抽取 DDL 的（见该文件里的说明）。
DROP TABLE IF EXISTS observations CASCADE;
DROP TABLE IF EXISTS bodies       CASCADE;
DROP TABLE IF EXISTS sources      CASCADE;


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

-- ----------------------------------------------------------------------------
--  表与字段注释（Day 16 余力加练）
--
--  ⚠️ 这和上面的 `--` 注释**不是一回事**：
--     · 上面的 `--` 注释只活在**这个脚本文件**里 —— 跑完它就没进数据库，
--       数据库根本不知道有这些字；
--     · 下面这些 COMMENT ON ... 会写进**数据库自己的元数据**（pg_description），
--       控制台点开列名能看到"备注"，psql 的 \d+ 也能看到。
--     所以这份脚本不只是"建表脚本"，还是"给表写说明书"。
--
--  ⚠️ COMMENT 必须写在 CREATE TABLE **之后**（表得先存在）。
--     它也在 gen-seed.mjs 的抽取范围里 ⇒ seed.sql 会一起带上，自包含不变。
-- ----------------------------------------------------------------------------

COMMENT ON TABLE sources IS
  'NASA 数据来源字典表（4 行）。bodies 通过 source_id / source_extra_id 指过来。';
COMMENT ON COLUMN sources.id    IS
  '来源短标识（主键）：factSheetMetric / sunFactSheet / moonFactSheet / jplSbdbHalley';
COMMENT ON COLUMN sources.label IS
  '给人看的来源名称，如 "NASA Planetary Fact Sheet (Metric)"';
COMMENT ON COLUMN sources.url   IS
  '来源页面地址，用于页脚"数据来源"链接与人工溯源核对';

COMMENT ON TABLE bodies IS
  '天体表（11 行：太阳 + 八大行星 + 月球 + 哈雷彗星）。数值列一律 numeric，理由见文件内注释。';

-- ---- 身份 ----------------------------------------------------------------
COMMENT ON COLUMN bodies.id      IS
  '天体短标识（主键），与代码里的 id 一致。接口 /api/bodies/:id 直接使用，如 earth / moon / halley';
COMMENT ON COLUMN bodies.name_zh IS
  '中文名，如 "地球"';
COMMENT ON COLUMN bodies.name_en IS
  '英文名，如 "Earth"。唯一（uq_bodies_name_en）';
COMMENT ON COLUMN bodies.type    IS
  '天体类型，只有 4 种：star / planet / moon / comet（ck_bodies_type）';

-- ---- 尺寸与轨道 ----------------------------------------------------------
COMMENT ON COLUMN bodies.diameter_km IS
  '直径（km）。太阳 1391400；哈雷 11.0 —— 有小数位，所以不能是 integer';
COMMENT ON COLUMN bodies.distance_from_sun_km IS
  '距太阳（km）。太阳为 0；哈雷远日点 2677801886 超出 int 上限 2147483647，故本列必须是 numeric';
COMMENT ON COLUMN bodies.distance_raw IS
  '距太阳的原始写法（给人看的），如 "≈149.6 × 10^6 km"。含 ≈ 和 × 10^6，存不进 numeric，只能 text';
COMMENT ON COLUMN bodies.orbital_period_days IS
  '公转周期（天）。太阳为 NULL —— 太阳是中心天体、没有轨道，NULL 表示"不适用"，不是 0';
COMMENT ON COLUMN bodies.eccentricity IS
  '轨道离心率，要求 0 ≤ e < 1。太阳为 NULL；哈雷 0.967 非常接近 1';

-- ---- 相对地球（源数据里的 compareToEarth）--------------------------------
COMMENT ON COLUMN bodies.ratio_diameter IS
  '直径 ÷ 地球直径。地球本身为 1，木星 11.21';
COMMENT ON COLUMN bodies.ratio_distance IS
  '日距 ÷ 地球日距。太阳为 NULL';
COMMENT ON COLUMN bodies.ratio_period IS
  '公转周期 ÷ 地球周期。太阳为 NULL';

-- ---- 外观 ----------------------------------------------------------------
COMMENT ON COLUMN bodies.appearance_main_color IS
  '主色，十六进制字符串（含 #），如 #3B7EC8';
COMMENT ON COLUMN bodies.appearance_has_ring IS
  '有没有行星环。木星、土星、天王星为真';
COMMENT ON COLUMN bodies.appearance_note IS
  '外观备注。只有太阳、哈雷有值';
COMMENT ON COLUMN bodies.appearance_ring_note IS
  '行星环说明。只有木星、土星、天王星有值';

-- ---- 数据来源 ------------------------------------------------------------
COMMENT ON COLUMN bodies.source_id IS
  '主数据来源 → sources(id)。每个天体必有 —— "禁止虚构数据"这条规矩在表结构上的落地';
COMMENT ON COLUMN bodies.source_extra_id IS
  '附加数据来源 → sources(id)。只有月球有（双来源）';
COMMENT ON COLUMN bodies.source_status IS
  '数据状态：verified / unverified（ck_bodies_source_status）。当前 11 行全部 verified';

-- ---- 月球专用 ------------------------------------------------------------
COMMENT ON COLUMN bodies.parent_id IS
  '母天体 → bodies(id)（自引用）。只有月球 = "earth"。自引用使 INSERT 顺序有讲究：地球必须先于月球';
COMMENT ON COLUMN bodies.distance_from_parent_km IS
  '距母天体（km）。只有月球有，384400';
COMMENT ON COLUMN bodies.distance_from_parent_raw IS
  '距母天体的原始写法。只有月球有';
COMMENT ON COLUMN bodies.orbital_period_note IS
  '公转周期备注。只有月球有，用来提醒"这是绕地球的周期，不是绕太阳的"';

-- ---- 哈雷彗星专用 --------------------------------------------------------
COMMENT ON COLUMN bodies.extent_raw IS
  '三轴尺寸的原始写法。只有哈雷有';
COMMENT ON COLUMN bodies.orbital_period_raw IS
  '公转周期的原始写法。只有哈雷有';
COMMENT ON COLUMN bodies.perihelion_au IS
  '近日点（天文单位 au）。只有哈雷有';
COMMENT ON COLUMN bodies.aphelion_au IS
  '远日点（天文单位 au）。只有哈雷有';

-- ---- 显示顺序 ------------------------------------------------------------
COMMENT ON COLUMN bodies.sort_order IS
  '图鉴显示顺序：1=太阳 … 11=哈雷彗星。唯一（uq_bodies_sort_order）';

-- ----------------------------------------------------------------------------
--  observations —— 观测记录（**Day 18 新建**）
--
--  ⚠️ 为什么单独建一张表，而不是往 bodies 里写？
--     bodies / sources 装的是 **NASA 真数据**（别人产出的）；
--     observations 装的是 **用户产出的数据**（我观测了什么）。
--     把用户输入写进真数据表 = 污染真数据 —— 与项目红线「**禁止虚构数据**」直接冲突。
--
--  ⚠️ 本表**起步是空表（0 行）**，故意没有种子数据：
--     它的内容**只能由 POST /api/observations 产生**（Day 18）。
--     ⇒ 这正好是第 4 步验证的天然对照：`0 行 → POST → 1 行 → 重复 POST → 被拒 → 仍然 1 行`。
--
--  🔑 防重复（= 清单里"同一天同一计划项重复打卡"的等价物）：
--     靠**唯一约束** uq_observations_body_date (body_id, observed_on)
--     ⇒ 同一天 + 同一天体 = 只能有一条记录。
--     ⚠️ 规则交给**数据库**，而不是相信应用层的"先查再插"（那有竞态窗口）。
-- ----------------------------------------------------------------------------
CREATE TABLE observations (
  id           uuid        PRIMARY KEY,   -- 记录 id。由**云函数**用 crypto.randomUUID() 生成
                                          --   ⚠️ 刻意不写 DEFAULT gen_random_uuid()：不想让表结构
                                          --      依赖 pgcrypto 扩展在环境里装没装
  body_id      text        NOT NULL,      -- 观测对象 → bodies(id)，如 'mars'
  observed_on  date        NOT NULL,      -- 观测日期
                                          --   ⚠️ 刻意**不加**"不能是未来"的 CHECK：status 里有
                                          --      planned（计划观测），未来日期本身是合法的
  status       text        NOT NULL,      -- 观测状态，只有 3 种，见下面 CHECK
  note         text,                      -- 备注，可空
  created_at   timestamptz NOT NULL DEFAULT now(),  -- 由**数据库**生成，不信任客户端时间

  -- ---- 约束（集中写在这里，一眼看全）--------------------------------------
  CONSTRAINT ck_observations_status
    CHECK (status IN ('observed', 'missed', 'planned')),
  CONSTRAINT ck_observations_note_len
    CHECK (note IS NULL OR char_length(note) <= 200),
  CONSTRAINT uq_observations_body_date
    UNIQUE (body_id, observed_on),        -- 🔑 防重复的唯一真防线

  -- ---- 外键 --------------------------------------------------------------
  CONSTRAINT fk_observations_body
    FOREIGN KEY (body_id) REFERENCES bodies (id) ON DELETE RESTRICT
);

-- ---- observations 的注释（同样写进数据库元数据）--------------------------
COMMENT ON TABLE observations IS
  '用户观测记录（Day 18 新建）。空表起步，内容只能由 POST /api/observations 产生。';
COMMENT ON COLUMN observations.id IS
  '记录 id（主键，uuid）。由云函数用 crypto.randomUUID() 生成，不是数据库的默认值';
COMMENT ON COLUMN observations.body_id IS
  '观测对象 → bodies(id)（外键）。只能是已有天体的 id，如 mars / moon / halley';
COMMENT ON COLUMN observations.observed_on IS
  '观测日期（date）。与 body_id 组成唯一约束 uq_observations_body_date ⇒ 同一天同一天体只能记一条';
COMMENT ON COLUMN observations.status IS
  '观测状态，只有 3 种：observed（观测到了）/ missed（没看到）/ planned（计划观测）（ck_observations_status）';
COMMENT ON COLUMN observations.note IS
  '备注，可空，最长 200 字符（ck_observations_note_len）';
COMMENT ON COLUMN observations.created_at IS
  '写入时间，由数据库 DEFAULT now() 生成 —— 不信任客户端传的时间';

-- 刻意**不加**额外索引：三张表一共 15 行，主键和 UNIQUE 已经自带索引，
-- 再加 type / source_id 的索引纯属浪费。等数据量真的大了再说。


-- ----------------------------------------------------------------------------
--  自检：跑完立刻确认"表在不在、列数对不对"
--  （只要脚本跑成功，这一句一定会回：bodies 28 / observations 6 / sources 3）
-- ----------------------------------------------------------------------------
SELECT table_name, count(*) AS column_count
  FROM information_schema.columns
 WHERE table_schema = 'public'
   AND table_name IN ('bodies', 'observations', 'sources')
 GROUP BY table_name
 ORDER BY table_name;
