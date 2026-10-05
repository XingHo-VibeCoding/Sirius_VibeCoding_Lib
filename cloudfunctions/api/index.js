/**
 * 云函数 api —— Day 17 读接口 + Day 18 写接口
 * ============================================================
 * 负责两个 GET 和一个 POST：
 *   GET  /api/bodies?id=<id>   单个天体详情
 *   GET  /api/bodies           天体列表（图鉴视图用）
 *                              可选筛选：?type= / ?q= / ?limit=（条数上限）
 *   POST /api/observations     新增一条观测记录（Day 18）
 *                              请求体是 JSON：bodyId / observedOn / status / note
 *                              详情见契约 3.4
 *
 * ⚠️ 详情接口用 **query 参数 `?id=`**，不是路径参数 `/:id`（Day 17 实测后改的）：
 *    CloudBase HTTP 网关**不支持通配符**（`wildcard /* is not supported`），
 *    `/api/bodies/:id` 这种路径**配不出路由**。函数里两条通道都留着（见 resolveRequest），
 *    但**公网只有 `?id=` 这条能用**。契约 3.2 已同步。
 *
 * 数据从哪来：云端的 **PostgreSQL**（Day 16 建的 bodies / sources，Day 18 加的 observations），
 * 不再是前端 src/data/bodies.js 里那份写死的静态数据。
 * ⚠️ 只有**读**走数据库；前端页面读的还是静态数据（详情页不能接异步接口，见 Day 14），
 *    唯一接了接口的是图鉴卡片。
 *
 * 【Day 18 写接口的两条注意】
 *   · `observations.id` 是 **uuid 且没有 DEFAULT**（刻意不依赖 pgcrypto 扩展）
 *     ⇒ id 必须由**本函数**生成（见 uuidv4）。
 *   · `created_at` 由**数据库** `DEFAULT now()` 生成，**不接受客户端传时间**。
 *
 * 【为什么用 app.rdb()，而不是 pg + TCP 直连】
 *   官方给了两条路：
 *     ① pg 直连：要 PGHOST/PGPORT/PGUSER/PGPASSWORD，还要 VPC / 安全组
 *     ② @cloudbase/node-sdk 的 app.rdb()：走平台的 PG HTTP 网关
 *   本环境是**免费体验版**。社区里官方对同款问题的答复很明确：
 *   免费/个人版下**内网地址不存在**（不支持 VPC 私有网络），
 *   **公网直连也开不了**（要安全组，安全组要独享集群）。
 *   ⇒ ① 这条路根本走不通，只能走 ②。
 *   附带好处：代码里**不出现任何数据库密码**（用的是云函数自身的身份）。
 *
 * 【env 不写死】
 *   init 用 cloudbase.SYMBOL_CURRENT_ENV —— 函数在哪个环境跑就用哪个环境，
 *   将来换环境不用改代码（写死的环境 ID 是定时炸弹）。
 *
 * 【响应形状】契约 1.2 的统一信封 { ok, data, error }。
 * ============================================================
 */

const crypto = require('crypto');
const cloudbase = require('@cloudbase/node-sdk');

/* ------------------------------------------------------------------
 * 🔴 连数据库的**身份**：必须是 service_role，不能是 anon
 *
 * Day 18 实测：写接口第一次上云就 500 ——
 *   `写 observations 失败：permission denied for table observations`
 * 而同一个函数读 bodies 一路正常。原因：
 *   `app.rdb()` 默认用云函数自带凭证换 token，网关解析出的角色是 **anon**，
 *   而 anon 在我们三张表上**只有 SELECT** ⇒ 能读、不能写。
 *   （`cloudbase_authenticator` 是 NOINHERIT，纯粹按 JWT 里的 role 字段 SET ROLE。）
 *
 * 官方《PG：身份认证》给的答案 —— 三个应用角色，各有唯一来源：
 *   anon          ← Publishable Key（可安全嵌入前端）
 *   authenticated ← 用户登录后的 Access Token
 *   service_role  ← **API Key**（不过期 · BYPASSRLS · 严禁前端）
 * 且文档给云函数的**方式二**就是"用 API Key、通过**环境变量**注入"。
 *
 * SDK 里本来就有这个口子：
 *   getClientCredential() 开头是「有 accessKey 就直接返回」，
 *   请求头拼装是「有 accessKey 就优先用 API Key」
 * ⇒ 传个 accessKey 就行，**数据访问代码一行都不用改**。
 *
 * ⚠️ 这个值**绝不能进仓库**：只存在云函数的「环境变量」里（控制台或 `tcb config`）。
 *    本地跑单测时它是 undefined，行为与加它之前**完全一致**（退回 anon，只读）。
 * ------------------------------------------------------------------ */
const API_KEY = process.env.CLOUDBASE_APIKEY;
if (!API_KEY) {
  /* ⚠️ 用 console.log 而不是 console.warn：实测云函数的「调用日志」里
     warn 级别不显示，只有 log / error 会出来 —— 这行看不见就等于没写。 */
  console.log(
    '[api][warn] 未配置 CLOUDBASE_APIKEY：读接口仍可用（anon 有 SELECT），' +
      '但 POST 写接口会因权限被拒（permission denied, SQLSTATE 42501）。'
  );
}

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, accessKey: API_KEY });

/* 放模块顶层：云函数实例会被复用，不每次调用都新建客户端
 *
 * ⚠️ 必须显式指定 schema = public（Day 17 实测踩到的坑）：
 *    app.rdb() 的默认值是 `database = envId`，也就是会把
 *    Accept-Profile / Content-Profile 设成**环境 ID**
 *    （solar-system-d3g10b341a8d66aa6）。而我们的两张表建在 **public** schema 下，
 *    于是网关直接回 "Invalid schema: solar-system-d3g10b341a8d66aa6"。
 *    传 { database: 'public' } 就好了。 */
const db = app.rdb({ database: 'public' });

/* ------------------------------------------------------------------
 * 响应信封（契约 1.2）—— 所有出口都必须走这两个函数，不许手写对象
 * ------------------------------------------------------------------ */

function ok(data) {
  return { ok: true, data: data, error: null };
}

function fail(code, message) {
  return { ok: false, data: null, error: { code: code, message: message } };
}

/* 契约 1.3 的三条错误码。文案对齐前端已有的那几句，避免搬上来之后串台。 */
const errInternal = () => fail('INTERNAL', '服务暂时不可用，请稍后再试。');
const errBadRequest = (msg) => fail('BAD_REQUEST', msg || '请求参数不合法。');
const errNotFound = (id) => fail('NOT_FOUND', '没有找到「' + id + '」这个天体。');

/* 把 SDK / 异常对象变成一句可读的话（用于日志和调试） */
function describe(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  return e.message || e.code || JSON.stringify(e);
}

/* ------------------------------------------------------------------
 * 请求解析
 * ------------------------------------------------------------------ */

/* 把 query string 统一成普通对象（**过滤掉空值**，用于筛选参数） */
function parseQuery(event) {
  const q = (event && event.queryStringParameters) || (event && event.queryString) || {};
  const out = {};
  Object.keys(q).forEach(function (k) {
    if (q[k] !== undefined && q[k] !== null && q[k] !== '') out[k] = String(q[k]);
  });
  return out;
}

/* 请求的原始 query，**不过滤空值** ——
   用来分辨「根本没传 id」和「传了 id 但值是空的」，见下面 resolveRequest。 */
function rawQuery(event) {
  return (event && event.queryStringParameters) || (event && event.queryString) || {};
}

/**
 * 判断这次请求要"列表"、"详情"，还是"参数不合法"。
 *
 * ⚠️ 路径参数（/api/bodies/earth）能不能配通？
 *    **Day 17 实测：配不通** —— 平台 HTTP 网关不支持通配符（`wildcard /* is not supported`）。
 *    但这里**两条通道都留着**：
 *      · query 参数：`/api/bodies?id=earth`  ← **公网只有这条能用**
 *      · 路径末段：`/api/bodies/earth`        ← 留着兜底，路由要是将来能配就自动生效
 *
 * ⚠️ 为什么「传了 id 但值是空的」要报 BAD_REQUEST（契约 3.2，5.1 第 1 条的修正）：
 *      `/api/bodies`      → 没给 id，**明确就是要列表** → 返回列表
 *      `/api/bodies?id=`  → 给了 id 这个键但值是空 → **几乎一定是写错了** → BAD_REQUEST
 *    改之前这两种都返回 11 条列表 —— 用户参数写错却拿到"正常数据"，根本看不出自己错了。
 */
function resolveRequest(event, query) {
  const raw = rawQuery(event);
  const hasIdKey = Object.prototype.hasOwnProperty.call(raw, 'id');

  if (hasIdKey) {
    const id = String(raw.id === null || raw.id === undefined ? '' : raw.id).trim();
    if (!id) return { kind: 'bad' }; /* 给了 id 这个键、值是空 */
    return { kind: 'detail', id: id };
  }

  /* 没给 id：再看路径里有没有 /bodies/<段> */
  const rawPath =
    (event && (event.path || event.rawPath)) ||
    (event && event.requestContext && event.requestContext.path) ||
    '';

  const m = /bodies(\/([^/]*))?\/?$/.exec(String(rawPath));
  if (m) {
    if (m[2]) return { kind: 'detail', id: decodeURIComponent(m[2]) };
    if (m[1]) return { kind: 'bad' }; /* /api/bodies/ —— 带斜杠但没给 id，同上 */
  }

  return { kind: 'list' };
}

/* ------------------------------------------------------------------
 * 读数据库
 * ------------------------------------------------------------------ */

async function loadBodies() {
  const res = await db.from('bodies').select('*').order('sort_order', { ascending: true });
  if (res.error) throw new Error('读 bodies 失败：' + describe(res.error));
  return res.data || [];
}

/* 字典表只有 4 行 —— 一次读全，在内存里做「编号 → 网址」的映射。
   比逐行做外键嵌套查询直白得多，而 4 行的成本是零。 */
async function loadSourceUrls() {
  const res = await db.from('sources').select('id, url');
  if (res.error) throw new Error('读 sources 失败：' + describe(res.error));
  const map = {};
  (res.data || []).forEach(function (r) {
    map[r.id] = r.url;
  });
  return map;
}

/* ------------------------------------------------------------------
 * 表列 → 接口字段（依据契约 4.7 的映射表）
 * ------------------------------------------------------------------ */

/* PG 的 numeric 经网关回来可能是字符串（"1391400.0"），统一转成数字。
   ⚠️ null 必须保持 null —— Number(null) 是 0，会把"不适用"悄悄变成"等于 0"。 */
function num(v) {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isNaN(n) ? null : n;
}

/* PG 的 boolean 也可能是字符串 'true' / 'false' */
function bool(v) {
  return v === true || v === 'true' || v === 't' || v === 1;
}

/* 有值才带上这个键 —— 源数据里没有的字段，响应里也不出现（保持一致） */
function put(target, key, value) {
  if (value !== null && value !== undefined) target[key] = value;
}

/* source_id + source_extra_id → 单个字符串（契约 4.7）
   顺序「主 ＋ 附加」，与页面现在显示的完全一致（月球 = 主 ＋ 附加）。
   ⚠️ 月球是唯一有两个来源的天体（Day 16 实测）。 */
function buildSource(row, srcUrls) {
  const ids = [row.source_id];
  if (row.source_extra_id) ids.push(row.source_extra_id);
  return ids
    .map(function (id) {
      return srcUrls[id];
    })
    .filter(Boolean)
    .join(' ＋ ');
}

/* 列表项：契约 3.1 只要 5 个字段（逐行核对 catalog.js 的 buildCard() 得到的） */
function toListItem(row) {
  return {
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    type: row.type,
    appearance: {
      mainColor: row.appearance_main_color,
      hasRing: bool(row.appearance_has_ring)
    }
  };
}

/* 详情：契约 3.2 的完整字段 + 月球/哈雷的额外字段 */
function toDetail(row, srcUrls) {
  const out = {
    id: row.id,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    type: row.type,
    diameterKm: num(row.diameter_km),
    distanceFromSunKm: num(row.distance_from_sun_km),
    distanceRaw: row.distance_raw,
    orbitalPeriodDays: num(row.orbital_period_days),
    eccentricity: num(row.eccentricity),
    /* ⚠️ 这三个键**总是出现**，太阳的 distance / period 就是 null ——
       与 src/data/bodies.js 里的形状一致（source 数据本身也是这么写的）。 */
    compareToEarth: {
      diameter: num(row.ratio_diameter),
      distance: num(row.ratio_distance),
      period: num(row.ratio_period)
    },
    appearance: {
      mainColor: row.appearance_main_color,
      hasRing: bool(row.appearance_has_ring)
    },
    source: buildSource(row, srcUrls),
    sourceStatus: row.source_status
  };

  /* appearance 的两个说明：只有部分天体有（太阳/哈雷有 note，木土天有 ringNote） */
  put(out.appearance, 'note', row.appearance_note);
  put(out.appearance, 'ringNote', row.appearance_ring_note);

  /* 月球专用 4 个 */
  put(out, 'parentId', row.parent_id);
  put(out, 'distanceFromParentKm', num(row.distance_from_parent_km));
  put(out, 'distanceFromParentRaw', row.distance_from_parent_raw);
  put(out, 'orbitalPeriodNote', row.orbital_period_note);

  /* 哈雷彗星专用 4 个 */
  put(out, 'extentRaw', row.extent_raw);
  put(out, 'orbitalPeriodRaw', row.orbital_period_raw);
  put(out, 'perihelionAu', num(row.perihelion_au));
  put(out, 'aphelionAu', num(row.aphelion_au));

  return out;
}

/* ------------------------------------------------------------------
 * 列表的筛选（契约 3.1 的 type 和 q）
 *
 * 11 行的表，在函数里过滤完全够用，而且**没有注入风险**（值从不拼进 SQL）。
 * 数据量大了再把条件下推到数据库 —— 那时才值得为它去调 postgREST 的过滤语法。
 * ------------------------------------------------------------------ */

function applyFilter(rows, query) {
  let out = rows;

  if (query.type) {
    const t = String(query.type).toLowerCase();
    out = out.filter(function (r) {
      return String(r.type).toLowerCase() === t;
    });
  }

  if (query.q) {
    const needle = String(query.q).toLowerCase();
    out = out.filter(function (r) {
      /* ⚠️ 要搜**三个**字段：nameZh / nameEn / id ——
         依据前端 src/filter.js 第 71 行的实际实现。少搜 id 的话，
         输入 "halley" / "jupiter" 这类纯英文 id 会搜不到（用户以为"没有这个天体"）。 */
      const hay = [r.name_zh, r.name_en, r.id].filter(Boolean).join(' ').toLowerCase();
      return hay.indexOf(needle) !== -1;
    });
  }

  return out;
}

/* 条数上限（契约 3.1 的 limit，Day 17 余力加练）
 *
 * 规则：
 *   · 不传（或传空串）→ **不截断**，返回全部 —— 与加这个参数之前的行为完全一致
 *   · 正整数       → 截断到前 N 条
 *   · 其它一律拒    → BAD_REQUEST
 *
 * ⚠️ 为什么用**正则**而不是 Number()：Number('') === 0、Number(' 3 ') === 3、
 *    Number('3abc') === NaN —— 靠它判"合不合法"会放进一堆脏输入。
 *    /^\d+$/ 一次性挡掉小数、负数、字母、空串，只留纯数字。
 *
 * 📌 这也是 errBadRequest() 的**第一个真实调用点**（此前它定义了却没人调用，
 *    契约 5.1 第 2 条就是这么登记的）。 */
function parseLimit(query) {
  if (query.limit === undefined) return { valid: true, value: null };

  const raw = String(query.limit).trim();
  if (!/^\d+$/.test(raw)) return { valid: false, value: null };

  const n = Number(raw);
  if (n < 1) return { valid: false, value: null }; /* 0 也拒：要 0 条没有意义，多半是写错了 */

  return { valid: true, value: n };
}

/* ==================================================================
 * 写接口（Day 18）：POST /api/observations —— 新增一条观测记录
 *
 * 契约 3.4 说了这三件事，代码就是照着它写的：
 *   1. 请求体是 **JSON**（不是 query string），4 个字段、其中 3 个必填；
 *   2. 校验失败一律 `BAD_REQUEST` + **中文 message，说清缺了什么**；
 *   3. **防重复靠数据库唯一约束** `uq_observations_body_date (body_id, observed_on)`，
 *      应用层只负责把唯一冲突（SQLSTATE 23505）**翻译**成一句中文。
 * ================================================================== */

/* 允许的观测状态（契约 3.4.2；与表上的 ck_observations_status 是同一条规则的两处表达） */
const OBS_STATUSES = ['observed', 'missed', 'planned'];

/* note 上限，与表上的 ck_observations_note_len 对齐 */
const NOTE_MAX = 200;

/* 契约 3.4.2 的第一句文案（两处要用，提出来免得抄串） */
const BODY_NOT_OBJECT =
  '请求体必须是一段 JSON 对象，例如 {"bodyId":"mars","observedOn":"2026-10-04","status":"observed"}。';

/* 必填字段 + 中文名。message 里要"一次列出全部缺失项"，所以按固定顺序遍历。 */
const REQUIRED_FIELDS = [
  { key: 'bodyId', label: '天体 id' },
  { key: 'observedOn', label: '观测日期' },
  { key: 'status', label: '观测状态' }
];

/* 生成 uuid v4
 *
 * ⚠️ 表上的 id 是 uuid 且**故意没写 DEFAULT gen_random_uuid()**（不想依赖 pgcrypto 扩展），
 *    所以这一列必须由函数给值，否则主键为 null、插入直接失败。
 * 优先用 Node 自带的 crypto.randomUUID（14.17+ 才有）；
 * 拿不到就退回手动拼 v4 —— 免得因为运行时版本差异整个接口 500。 */
function uuidv4() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.randomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40; /* 版本号 4 */
  b[8] = (b[8] & 0x3f) | 0x80; /* variant 10xx */
  const hex = b.toString('hex');
  return (
    hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-' + hex.slice(12, 16) + '-' +
    hex.slice(16, 20) + '-' + hex.slice(20)
  );
}

/* 取 HTTP 方法。
   ⚠️ 网关/云函数的 event 形状不保证 —— Day 17 已见过 query 原样透传、path 另有形状。
      三个可能的位置依次试，都取不到就按 GET 处理（与加写接口之前的行为一致）。 */
function getMethod(event) {
  const m =
    (event && event.httpMethod) ||
    (event && event.requestContext && event.requestContext.httpMethod) ||
    (event && event.requestContext && event.requestContext.http && event.requestContext.http.method);
  return m ? String(m).toUpperCase() : 'GET';
}

/* 取请求路径（只用于日志与"POST 打到了读接口"这种明显误用的判断） */
function getPath(event) {
  return String(
    (event && (event.path || event.rawPath)) ||
      (event && event.requestContext && event.requestContext.path) ||
      ''
  );
}

/* 取请求路径的**末段**（去掉 query、去掉首尾斜杠）
 *
 * ⚠️⚠️ Day 18 第 4 步实测后，这个函数**只剩日志用途**，不再参与任何判断：
 *      公网走网关时 `event.path` **恒为 "/"** ⇒ lastPathSegment() 永远返回空串。
 *      （`fn invoke` 手动塞 path 时它是有值的 —— 这就是"本地测过、云端失效"的根源。）
 *    别再拿它做资源分流。真要按资源分流，得让网关把路由信息放进
 *    query 或 header（`path_passthrough` 参数），那是独立一步。
 */
function lastPathSegment(event) {
  const raw = getPath(event).split('?')[0].replace(/\/+$/, '');
  if (!raw) return '';
  const parts = raw.split('/');
  return parts[parts.length - 1] || '';
}

/* 把请求体取成 JS 值
 *
 * ⚠️ body 有两种到达方式，都要接住：
 *    · 字符串（转发后没被解析）→ 自己 JSON.parse
 *    · 已经是对象（网关按 Content-Type: application/json 解析过）→ 直接用
 *    · isBase64Encoded（部分网关会 base64 编码）→ 先解 base64 再 parse
 *
 * 返回 { parsed: true, value } / { parsed: false }。
 * ⚠️ 这里**不判断"是不是对象"** —— 交给调用方，好让所有"请求体不对"都走同一句文案。 */
function readJsonBody(event) {
  let raw = event && event.body;

  if (raw === undefined || raw === null) return { parsed: false };
  if (typeof raw === 'object') return { parsed: true, value: raw };

  let text = String(raw);
  if (event && event.isBase64Encoded) {
    try {
      text = Buffer.from(text, 'base64').toString('utf8');
    } catch (e) {
      return { parsed: false };
    }
  }
  if (!text.trim()) return { parsed: false };

  try {
    return { parsed: true, value: JSON.parse(text) };
  } catch (e) {
    return { parsed: false };
  }
}

/* 判断一个值算不算"没给"：缺失 / null / 空串 / 全是空格 */
function isBlank(v) {
  if (v === undefined || v === null) return true;
  if (typeof v === 'string' && !v.trim()) return true;
  return false;
}

/* YYYY-MM-DD → 真的是一个存在的日期吗
 * ⚠️ 只靠正则挡不住 2026-02-30 / 2026-13-01 这种"格式对、日期不存在"的值。
 *    这里用 Date 回读三个分量再比一次：只有真正存在的那天才三层相等。 */
function isRealDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/* 按字符数算长度
 * ⚠️ 不用 s.length：那是 UTF-16 码元数，一个 emoji 会被算成 2。
 *    数据库那边 char_length() 数的是"字符"，两边必须同一把尺子。 */
function charLength(s) {
  return Array.from(s).length;
}

/* timestamptz → 契约 3.4.2 那种带 Z 的 ISO 串
 * （PostgREST 回来的是 "2026-10-04T13:14:00.123456+00:00"，格式与契约样例不一致） */
function isoUtc(v) {
  if (v === null || v === undefined) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}

/**
 * 校验请求体。返回 { ok:true, value } 或 { ok:false, message }。
 *
 * 校验顺序是**定死**的（先报哪个错是可预期的）：
 *   ① 不是 JSON 对象 → ② 缺必填（一次列全）→ ③ observedOn 格式 → ④ status 取值
 *   → ⑤ note 类型/长度 → ⑥ bodyId 在不在 bodies 里（要查库，放在最后）
 *   ⑦ 重复：不在这里判，交给唯一约束（见 createObservation）
 */
function validateObservation(body) {
  /* ① 必须是一段 JSON 对象：null / 数组 / 数字 / 字符串 都不算 */
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, message: BODY_NOT_OBJECT };

  /* ② 缺必填 —— 一次把**全部**缺失字段列出来（契约 3.4.2 的要求） */
  const missing = REQUIRED_FIELDS.filter(function (f) {
    return isBlank(body[f.key]);
  });
  if (missing.length) {
    return {
      ok: false,
      message:
        '缺少必填字段：' +
        missing.map(function (f) { return f.label ? f.key + '（' + f.label + '）' : f.key; }).join('、') +
        '。'
    };
  }

  const bodyId = String(body.bodyId).trim();
  const observedOn = String(body.observedOn).trim();
  const status = String(body.status).trim();

  /* ③ 日期格式（含"这天到底存不存在"） */
  if (!isRealDate(observedOn)) {
    return { ok: false, message: 'observedOn 格式不对，应为 YYYY-MM-DD，例如 2026-10-04。' };
  }

  /* ④ 状态三选一 */
  if (OBS_STATUSES.indexOf(status) === -1) {
    return { ok: false, message: 'status 只能是 observed、missed 或 planned 之一。' };
  }

  /* ⑤ note 可选；给了就必须是字符串、且不超长 */
  let note = null;
  if (body.note !== undefined && body.note !== null && body.note !== '') {
    if (typeof body.note !== 'string') return { ok: false, message: 'note 必须是字符串。' };
    if (charLength(body.note) > NOTE_MAX) return { ok: false, message: 'note 最长 ' + NOTE_MAX + ' 个字符。' };
    note = body.note;
  }

  return { ok: true, value: { bodyId: bodyId, observedOn: observedOn, status: status, note: note } };
}

/* 这个错误是不是"唯一约束冲突"（= 同一天同一天体重复提交）
 *
 * ⭐ Day 18 第 1 步的负向测试已经证实：**数据库层**回的原文是
 *      `23505 duplicate key value violates unique constraint "uq_observations_body_date"`
 *    且 SDK 的错误对象带 code / message / details 三个字段（code 就是 PG 的 SQLSTATE）。
 *    所以这里**两个判据都给上**：code 认 23505，message 兜底认约束名 ——
 *    万一哪天 SDK 不传 code 了，只看 message 也还能认出重复。 */
function isDuplicateError(err) {
  if (!err) return false;

  /* ⚠️ 云上真实的 code **不是裸 SQLSTATE**：Day 18 实测权限错回的是
     `DATABASE_42501`（平台加了 `DATABASE_` 前缀）。
     ⇒ 这里用「**包含 23505**」判，而不是全等 —— 全等会在云上静默失效。 */
  const code = String(err.code || '');
  if (code.indexOf('23505') !== -1) return true;

  /* 双判据：万一哪天平台把 code 也换了，message/details 里的约束名还能认出来 */
  const text = String(err.message || '') + ' ' + String(err.details || '');
  return text.indexOf('uq_observations_body_date') !== -1;
}

const errDuplicate = (observedOn) =>
  fail('BAD_REQUEST', '该天体在 ' + observedOn + ' 已有观测记录，同一天只能记一条。');

/**
 * POST /api/observations
 *
 * 契约 3.4：不幂等（重复**被拒**，不是"返回已存在"）；成功时把整条记录回吐，
 * 因为 id 和 createdAt 都是服务端生成的，调用方猜不出来。
 */
async function createObservation(event) {
  /* ---- 请求体 ---- */
  const got = readJsonBody(event);
  if (!got.parsed) return errBadRequest(BODY_NOT_OBJECT);

  /* ---- 校验（①–⑤） ---- */
  const v = validateObservation(got.value);
  if (!v.ok) return errBadRequest(v.message);

  const input = v.value;

  /* ---- ⑥ bodyId 必须指向一个真天体 ----
     ⚠️ 查不到给 BAD_REQUEST 而**不是** NOT_FOUND：URI 是合法的，
        错在"请求体里引用了一个不存在的天体"，属于参数不合法（契约 3.4.2 有争论记录）。 */
  const look = await db.from('bodies').select('id').eq('id', input.bodyId).limit(1);
  if (look.error) throw new Error('读 bodies 失败：' + describe(look.error));
  if (!(look.data || []).length) {
    return errBadRequest('没有找到 id 为 ' + input.bodyId + ' 的天体，bodyId 必须是 bodies 表里已有的 id。');
  }

  /* ---- ⑦ 插入 ---- */
  const row = {
    id: uuidv4(),                 /* 表上这一列没有 DEFAULT，必须自己给 */
    body_id: input.bodyId,        /* camelCase → snake_case，依据契约 4.7 */
    observed_on: input.observedOn,
    status: input.status
  };
  if (input.note !== null) row.note = input.note; /* 不给 note 就让它是 NULL，别塞空串 */
  /* created_at 不传：由数据库 DEFAULT now() 生成，**不信任客户端时间** */

  /* ⚠️ 全部走 .insert(对象)：值由平台做参数绑定，**不拼 SQL 字符串**
     （清单明确要求"SQL 参数化"，与读接口的 .eq() 同一个道理）。
     .select() 会带上 Prefer: return=representation —— 让数据库把**真正落库的那一行**回给我们，
     而不是由前端自己猜。 */
  const res = await db
    .from('observations')
    .insert(row)
    .select('id,body_id,observed_on,status,note,created_at');

  if (res.error) {
    /* 重复：由唯一约束兜底，这里只做翻译 */
    if (isDuplicateError(res.error)) return errDuplicate(input.observedOn);

    /* ⚠️ 日志里必须带上 `code`（PG 的 SQLSTATE）：
       describe() 只取 message，而权限类错误的 message 只有一句
       "permission denied for table observations" —— 看不出**是谁**没权限、为什么。
       42501 就是 Day 18 真踩的那个坑（云函数身份还是 anon、没配 API Key）。 */
    const code = String(res.error.code || '');
    const hint =
      code.indexOf('42501') !== -1
        ? '（42501 = 权限不足：多半是云函数没配 CLOUDBASE_APIKEY，连库身份还是 anon）'
        : '';
    throw new Error(
      '写 observations 失败：' + describe(res.error) + '（code=' + (code || '-') + '）' + hint
    );
  }

  /* insert + return=representation 回来的是**数组**（PostgREST 的形状），取第一条。
     兜一层"万一直接给了对象"，免得因为形状差异整条接口挂掉。 */
  const saved = Array.isArray(res.data) ? res.data[0] : res.data;
  if (!saved) throw new Error('写 observations 后没有拿到回吐的行。');

  /* 回吐的 6 个字段**固定都在**（含 note 为 null）——
     契约 3.4.2 明列了 6 个，调用方不用去猜"这个键是没有还是没值"。 */
  return ok({
    id: saved.id,
    bodyId: saved.body_id,
    observedOn: saved.observed_on,
    status: saved.status,
    note: saved.note === undefined ? null : saved.note,
    createdAt: isoUtc(saved.created_at)
  });
}

/* ------------------------------------------------------------------
 * 入口
 * ------------------------------------------------------------------ */

exports.main = async function (event) {
  try {
    return await dispatch(event, getMethod(event), getPath(event));
  } catch (e) {
    /* 真实原因只进日志，**不直接回给前端**（避免把内部结构暴露给公网）。
       ⏳ Day 17 收尾：排查期临时带的 `｜[调试] …` 已删掉，恢复契约 1.4 的固定文案。 */
    console.error('[api] 未处理异常：', (e && e.stack) || e);
    return errInternal();
  }
};

/* 真正的分流（原 exports.main 的实体，原样搬进来，只把 method/path 改成入参） */
async function dispatch(event, method, path) {
  /* ---- 写接口：POST ----
     ⚠️ **这里不做路径门禁，也做不了** —— Day 18 第 4 步实测（见下），
        CloudBase HTTP 网关**不把路由信息传给云函数**：
          /api/bodies        → event.path === "/"
          /api/observations  → event.path === "/"   ← 一模一样
        query / httpMethod / body 都原样透传，**唯独 path 被吃掉**。
        ⇒ "路径里写了 bodies 还是 observations"在函数里**根本区分不出来**。
        所以 POST 进来就按 createObservation 处理（今天只登记了这一个写接口）。

     记录这条实测（以后别再试着用 path 分流）：
        fn invoke 时给 event 带上 path 是**能**生效的（所以离线测试会通过），
        但公网走网关时 path 恒为 "/" —— 这正是它最难排查的地方：
        本地测过、云端就失效，且没有任何报错。 */
    if (method === 'POST') {
      console.log('[api] POST ' + path);
      return await createObservation(event);
    }

    /* ---- 其它非 GET 方法：直接拒 ----
       不加这一句的话，`PUT /api/bodies` 会掉进下面的列表分支、**返回 11 条数据还带 ok:true** ——
       调用方会以为自己改成功了。
       ⚠️ 这条**能**生效，因为它只看 method（method 是透传的），不看 path。 */
    if (method !== 'GET' && method !== 'HEAD') {
      return errBadRequest('只支持 GET 和 POST。');
    }

    /* ⚠️ 原来这里还有一条"路径写了 observations 就拒"的门禁 —— **已删除**。
       原因见上面 POST 分支的说明：公网事件里 path 恒为 "/"，
       那条判断永远不会触发（`fn invoke` 能触发，公网不能）⇒ 是个"看着有用、实际是死代码"的陷阱。
       `GET /api/observations` 现在仍会返回 bodies 列表，这个行为**已如实登记进契约**
       （5.1 未解锁项），不再假装拦得住。 */

    const query = parseQuery(event);
    const req = resolveRequest(event, query);

    /* ---- 参数不合法：传了 id 这个键、值是空的 ---- */
    if (req.kind === 'bad') {
      return errBadRequest('详情接口需要给出 id，但传了空值。');
    }

    /* ---- 详情：GET /api/bodies?id=<id> ---- */
    if (req.kind === 'detail') {
      const id = req.id;
      /* ⚠️ 参数化查询：id 的值通过 .eq() 交给平台做参数绑定，
         不会拼进 SQL 字符串（清单明确要求"SQL 参数化"）。 */
      const res = await db.from('bodies').select('*').eq('id', id).limit(1);
      if (res.error) throw new Error('读 bodies 失败：' + describe(res.error));

      const rows = res.data || [];
      if (!rows.length) return errNotFound(id);

      const srcUrls = await loadSourceUrls();
      return ok(toDetail(rows[0], srcUrls));
    }

    /* ---- 列表：GET /api/bodies ---- */
    const rows = await loadBodies();
    const filtered = applyFilter(rows, query);

    const lim = parseLimit(query);
    if (!lim.valid) return errBadRequest('limit 必须是大于 0 的整数。');

    /* ⚠️ total 给的是**筛选后的总数**，不受 limit 影响 ——
       这样前端能知道"总共有多少、这次只拿了多少"。
       不传 limit 时 total 恒等于 items.length，与加这个参数之前完全一致。 */
    const items = (lim.value === null ? filtered : filtered.slice(0, lim.value)).map(toListItem);
    return ok({ total: filtered.length, items: items });
}
