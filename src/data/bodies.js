/* ============================================================
 * src/data/bodies.js —— 天体数据（项目唯一数据源）
 * ------------------------------------------------------------
 * 【项目规则】AGENTS.md 八.1：凡是写进项目的天体数据，必须写明
 * 可查证的官方出处；不得凭印象填写，也不得从同类网站转抄数值。
 *
 * 【文档依据】TECH_DESIGN.md 3.1（SolarBody 字段表）
 *             TECH_DESIGN.md 3.3（数据规则：只放数据，不放逻辑）
 *
 * 【数据来源】全部为 NASA 官方地址，共 4 个：
 *   [S1] NASA Planetary Fact Sheet (Metric)
 *        https://nssdc.gsfc.nasa.gov/planetary/factsheet/
 *        → 水星/金星/地球/火星/木星/土星/天王星/海王星（含月球部分字段）
 *        ⚠️ 这份表里【没有太阳】，也不含哈雷彗星
 *   [S2] NASA Sun Fact Sheet
 *        https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html
 *   [S3] NASA Moon Fact Sheet
 *        https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html
 *   [S4] NASA/JPL Small-Body Database (SBDB) API
 *        https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1P
 *
 * 【换算约定】TECH_DESIGN.md 3.3 规则 3：
 *   换算值必须与原始值一起标注，便于反查。所以 distanceRaw 保留原文，
 *   distanceFromSunKm 是换算后的 km。
 * ============================================================ */

/* ---------- 数据来源登记表 ---------- */
const DATA_SOURCES = {
  factSheetMetric: {
    label: 'NASA Planetary Fact Sheet (Metric)',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/'
  },
  sunFactSheet: {
    label: 'NASA Sun Fact Sheet',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html'
  },
  moonFactSheet: {
    label: 'NASA Moon Fact Sheet',
    url: 'https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html'
  },
  jplSbdbHalley: {
    label: 'NASA/JPL Small-Body Database (SBDB) — 1P/Halley',
    url: 'https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1P'
  }
};

/* 距离换算用的常数 */
const AU_KM = 149597870.7;          // 1 天文单位（定义值）
const S1 = DATA_SOURCES.factSheetMetric.url;
const S2 = DATA_SOURCES.sunFactSheet.url;
const S3 = DATA_SOURCES.moonFactSheet.url;
const S4 = DATA_SOURCES.jplSbdbHalley.url;

/* ---------- 页面可调常量 ----------
 * TECH_DESIGN.md 第 7 节「可配置项」（本项目无服务器，故无环境变量）。
 *
 * ⚠️ 一处对文档的修正，理由写在下面：
 *    TECH_DESIGN 第 7 节把 DEFAULT_TIME_SCALE 的示意值写成「实时」。
 *    但实测下来必须改——「实时」= 1 秒走 1 天，水星绕太阳一圈要 88 秒，
 *    肉眼看不出在动，会直接违反 PRD 验收 V1「打开 3 秒内看到行星肉眼可见在动」。
 *    所以默认值定在「演示」档（1 秒 = 100 天）。
 */
const SOLAR_CONFIG = {
  /* 时间流速档位，单位「天/秒」。0 表示暂停。 */
  TIME_SCALE_OPTIONS: [
    { rate: 0, label: '暂停', hint: '画面停住' },
    { rate: 1, label: '实时', hint: '和真实时间一样快——水星绕一圈要 88 秒，几乎看不出在动' },
    { rate: 100, label: '演示', hint: '1 秒 ≈ 100 天（默认）' },
    { rate: 1000, label: '快进', hint: '1 秒 ≈ 1000 天，内行星会跑得很快' }
  ],
  DEFAULT_TIME_SCALE: 100,

  /* 尺度模式：轨道的间距怎么算 */
  SCALE_MODE_DEFAULT: 'illustrative',
  SCALE_MODE_OPTIONS: [
    { mode: 'illustrative', label: '图示比例', hint: '把各条轨道拉开，方便看清每一颗' },
    { mode: 'true', label: '真实比例', hint: '按实际距离画——内行星会挤成一团，这才是太阳系真实的样子' }
  ],

  /* 3D 聚焦总开关。
     关掉之后页面退化成纯 2D —— 主图和资料卡照常工作，只是点天体不再弹 3D。
     这是 TECH_DESIGN 第 7 节刻意留的「一键规避」开关：
     万一 3D 在某种设备上出问题，改这一个值就能绕开，不用连夜修。 */
  ENABLE_3D: true
};

/* ---------- 天体数据 ----------
 * 字段见 TECH_DESIGN.md 3.1。两处补充说明：
 *   · eccentricity：为实现椭圆轨道而加，取自 NASA 表的 "Orbital Eccentricity" 行
 *   · parentId / distanceFromParentKm：只有月球用，标明它绕的是地球而不是太阳
 */
const SOLAR_BODIES = [

  /* ============ 太阳 ============ */
  {
    id: 'sun', nameZh: '太阳', nameEn: 'Sun', type: 'star',
    // 官方给的是 volumetric mean radius = 695,700 km，直径取其 2 倍
    diameterKm: 1391400,
    distanceFromSunKm: 0,          // 太阳是中心，按定义为 0
    distanceRaw: '0（太阳为太阳系中心）',
    orbitalPeriodDays: null,       // 太阳不绕自己公转，此项不适用
    eccentricity: null,
    compareToEarth: { diameter: 109.2, distance: null, period: null },
    appearance: { mainColor: '#F2B230', hasRing: false, note: '自身发光的恒星，画成亮黄圆盘' },
    source: S2, sourceStatus: 'verified'
  },

  /* ============ 水星 ============ */
  {
    id: 'mercury', nameZh: '水星', nameEn: 'Mercury', type: 'planet',
    diameterKm: 4879,
    distanceFromSunKm: 57900000,
    distanceRaw: '57.9 × 10^6 km',
    orbitalPeriodDays: 88.0,
    eccentricity: 0.206,
    compareToEarth: { diameter: 0.383, distance: 0.387, period: 0.241 },
    appearance: { mainColor: '#9C9188', hasRing: false },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 金星 ============ */
  {
    id: 'venus', nameZh: '金星', nameEn: 'Venus', type: 'planet',
    diameterKm: 12104,
    distanceFromSunKm: 108200000,
    distanceRaw: '108.2 × 10^6 km',
    orbitalPeriodDays: 224.7,
    eccentricity: 0.007,
    compareToEarth: { diameter: 0.949, distance: 0.723, period: 0.615 },
    appearance: { mainColor: '#E8D9A0', hasRing: false },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 地球 ============ */
  {
    id: 'earth', nameZh: '地球', nameEn: 'Earth', type: 'planet',
    diameterKm: 12756,
    distanceFromSunKm: 149600000,
    distanceRaw: '149.6 × 10^6 km',
    orbitalPeriodDays: 365.2,
    eccentricity: 0.017,
    compareToEarth: { diameter: 1, distance: 1, period: 1 },
    appearance: { mainColor: '#3B7EC8', hasRing: false },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 月球 ============
   * 注意：月球绕的是【地球】不是太阳。
   * 它不画进 2D 日心轨道图（PRD F1 的整体视图只要求「太阳 + 八大行星」），
   * 但数据要留着，供资料卡与 3D 聚焦使用。
   * 表中带 * 的数值本身指「相对地球」，不是相对太阳。
   */
  {
    id: 'moon', nameZh: '月球', nameEn: 'Moon', type: 'moon',
    parentId: 'earth',
    diameterKm: 3475,
    distanceFromSunKm: 149600000,        // 与地球几乎相同（跟随地球）
    distanceRaw: '≈149.6 × 10^6 km（与地球相同）',
    distanceFromParentKm: 384400,        // 原始值 0.3844（单位 10^6 km）
    distanceFromParentRaw: '0.3844 × 10^6 km（距地球的半长轴）',
    orbitalPeriodDays: 27.3217,          // 绕地球一圈
    orbitalPeriodNote: '这是绕【地球】的公转周期，不是绕太阳',
    eccentricity: 0.0549,
    compareToEarth: { diameter: 0.2727, distance: 0.00257, period: 0.0748 },
    appearance: { mainColor: '#B8B5AE', hasRing: false },
    source: S1 + ' ＋ ' + S3, sourceStatus: 'verified'
  },

  /* ============ 火星 ============ */
  {
    id: 'mars', nameZh: '火星', nameEn: 'Mars', type: 'planet',
    diameterKm: 6792,
    distanceFromSunKm: 228000000,
    distanceRaw: '228.0 × 10^6 km',
    orbitalPeriodDays: 687.0,
    eccentricity: 0.094,
    compareToEarth: { diameter: 0.532, distance: 1.52, period: 1.88 },
    appearance: { mainColor: '#C1653B', hasRing: false },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 木星 ============ */
  {
    id: 'jupiter', nameZh: '木星', nameEn: 'Jupiter', type: 'planet',
    diameterKm: 142984,
    distanceFromSunKm: 778500000,
    distanceRaw: '778.5 × 10^6 km',
    orbitalPeriodDays: 4331,
    eccentricity: 0.049,
    compareToEarth: { diameter: 11.21, distance: 5.20, period: 11.9 },
    appearance: { mainColor: '#D8A47F', hasRing: true, ringNote: '木星有微弱行星环，2D 主图暂不画' },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 土星 ============ */
  {
    id: 'saturn', nameZh: '土星', nameEn: 'Saturn', type: 'planet',
    diameterKm: 120536,
    distanceFromSunKm: 1432000000,
    distanceRaw: '1432.0 × 10^6 km',
    orbitalPeriodDays: 10747,
    eccentricity: 0.052,
    compareToEarth: { diameter: 9.45, distance: 9.57, period: 29.4 },
    appearance: { mainColor: '#E3CE9A', hasRing: true, ringNote: '土星环最显著，主图上要画出来' },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 天王星 ============ */
  {
    id: 'uranus', nameZh: '天王星', nameEn: 'Uranus', type: 'planet',
    diameterKm: 51118,
    distanceFromSunKm: 2867000000,
    distanceRaw: '2867.0 × 10^6 km',
    orbitalPeriodDays: 30589,
    eccentricity: 0.047,
    compareToEarth: { diameter: 4.01, distance: 19.17, period: 83.7 },
    appearance: { mainColor: '#9BD8DC', hasRing: true, ringNote: '天王星也有环，但很暗，主图暂不画' },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 海王星 ============ */
  {
    id: 'neptune', nameZh: '海王星', nameEn: 'Neptune', type: 'planet',
    diameterKm: 49528,
    distanceFromSunKm: 4515000000,
    distanceRaw: '4515.0 × 10^6 km',
    orbitalPeriodDays: 59800,
    eccentricity: 0.010,
    compareToEarth: { diameter: 3.88, distance: 30.18, period: 163.7 },
    appearance: { mainColor: '#3E5FA8', hasRing: false },
    source: S1, sourceStatus: 'verified'
  },

  /* ============ 哈雷彗星 ============
   * 它不在 NASA Planetary Fact Sheet 覆盖范围内，
   * 来源为 JPL 小天体数据库（SBDB），见 PRD 5.1。
   * 偏心率 0.968 —— 远大于八大行星，这是 PRD V10 要求「轨道必须肉眼可见很扁」的依据。
   */
  {
    id: 'halley', nameZh: '哈雷彗星', nameEn: '1P/Halley', type: 'comet',
    // 等效直径（JPL 注明为 effective body diameter）；
    // 实测三轴尺寸为 14.9 × 8.2 km —— 彗核是长条状，不是圆球
    diameterKm: 11.0,
    extentRaw: '14.9 × 8.2 km（三轴尺寸）',
    distanceFromSunKm: 2677801886,       // 半长轴 17.9 au × 149,597,870.7 km/au = 2,677,801,885.5 km
    distanceRaw: '17.9 au（半长轴）',
    orbitalPeriodDays: 27700,
    orbitalPeriodRaw: '27,700 d（≈75.8 年）',
    eccentricity: 0.968,
    perihelionAu: 0.575,
    aphelionAu: 35.3,
    compareToEarth: { diameter: 0.00086, distance: 17.9, period: 75.8 },
    appearance: {
      mainColor: '#6E6E6E',
      hasRing: false,
      note: '反照率仅 0.04，是太阳系最暗的天体之一'
    },
    source: S4, sourceStatus: 'verified'
  }

];

/* 挂到 window 上，方便在浏览器控制台里直接查看数据（自查用） */
window.SOLAR_BODIES = SOLAR_BODIES;
window.DATA_SOURCES = DATA_SOURCES;
window.SOLAR_CONFIG = SOLAR_CONFIG;
