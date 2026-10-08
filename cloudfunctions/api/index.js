/**
 * 云函数 api —— Day 17 读接口 + Day 18 写接口 + **Day 19 分层重构**
 * ============================================================
 * 负责两个 GET、一个 POST、一个 PATCH、一个 DELETE：
 *   GET  /api/bodies?id=<id>   单个天体详情
 *   GET  /api/bodies           天体列表（图鉴视图用）
 *                              可选筛选：?type= / ?q= / ?limit=（条数上限）
 *   POST /api/observations     新增一条观测记录（Day 18）
 *                              请求体是 JSON：bodyId / observedOn / status / note
 *                              详情见契约 3.4
 *   PATCH /api/observations?id=<uuid>  修改一条观测记录（Day 22）
 *                                   请求体是 JSON：status / note（**只允许改这两个**）
 *                                   详情见契约 3.5
 *   DELETE /api/observations?id=<uuid> 删除一条观测记录（Day 22）
 *                                   无请求体；成功回吐**被删掉的那一行**
 *                                   详情见契约 3.6
 *
 * 【Day 22 为什么"改哪一条"只能写在 query 里】
 *   `PATCH /api/observations/<uuid>` 这种路径参数**配不出来** ——
 *   CloudBase HTTP 网关不支持通配符（Day 17 实测 `wildcard /* is not supported`）。
 *   ⇒ 只能 `?id=<uuid>`。同一个理由早就决定了详情接口用 `?id=earth`。
 *
 * 【Day 19 重构：这个文件现在是**纯接口层**】
 *   原先的 737 行里混着四类东西：接请求 / 查数据库 / 字段塑形 / 校验。
 *   今天按一条判据把它们切开 ——
 *
 *     ⭐「这段代码**知不知道数据库的表名和列名**？」
 *         知道 → 数据访问层（搬去 repositories/）
 *         不知道、只认接口字段（nameZh / bodyId 这种）→ 接口层（留在这里）
 *
 *   搬走的：5 处 `db.from(...)` + `init/rdb` 那 5 行 → `repositories/`
 *   留下的：请求解析、字段塑形（toListItem/toDetail）、校验（validateObservation）、
 *            id 生成（uuidv4）、重复判据翻译（isDuplicateError）
 *
 *   ⇒ **本文件里现在一个 `db.` 都不出现**（验证方法：`grep -n "db\." index.js` → 0 命中）。
 *     这行注释就是"查数据库那段代码从哪移到了哪"的答案本身。
 *
 * 【一条容易搞错的边界，写在最前面免得被误搬】
 *   `isDuplicateError()` 读的是 `err.code` 里的 `23505`（那是 PostgreSQL 的 SQLSTATE），
 *   看着像数据访问 —— 但它要产出的是**一句给用户看的中文**
 *   （「该天体在 X 已有观测记录，同一天只能记一条。」）。
 *   判据看的是「它服务谁」，不是「它读了什么」⇒ 它属**返响应**，留在本文件。
 *
 * 【只增删代码位置，不改任何接口行为】
 *   重构后 3 个接口的**响应形状逐字节不变**（契约 v0.4.1 是判据）。
 *   验证方式：13 条命令的重构前/后输出 diff（探针目录 regress-api.cjs）。
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

/* ------------------------------------------------------------------
 * 🔴 Day 19：连数据库的代码**已经整体搬走**
 *
 * 原来这里有一段 45 行的注释 + `init` + `rdb`，解释"为什么用 service_role、
 * 为什么必须传 { database: 'public' }"。那些解释**没有删**，只是跟着代码
 * 一起搬到了 `repositories/db.js`（注释跟着代码走，不能留在原地下蛋）。
 *
 * 本文件现在只 require 三个 repository，拿到的是**业务方法**（findById / urlMap / insert），
 * 而不是数据库连接 —— 接口层不需要、也不应该拿到连接。
 * ------------------------------------------------------------------ */
const bodiesRepo = require('./repositories/bodiesRepository');
const sourcesRepo = require('./repositories/sourcesRepository');
const observationsRepo = require('./repositories/observationsRepository');

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

/* 观测记录找不到（Day 22，PATCH / DELETE 用）。
 * ⚠️ 与 errNotFound 分开写：那句的主语是"天体"，套到观测记录上不通顺
 *    （「没有找到「dc97fecd-…」这个天体」会让人以为在找天体）。
 *    两句话说的是两回事，就别硬复用。 */
const errObservationNotFound = (id) =>
  fail('NOT_FOUND', '没有找到 id 为 ' + id + ' 的观测记录。');

/* ------------------------------------------------------------------
 * 允许的 HTTP 方法（Day 22 新增 PATCH 与 DELETE）
 *
 * ⭐ 为什么写成**数组 + 由数组生成文案**，而不是手写那句中文字：
 *    方法和文案是**同一件事的两处表达**，改一处忘一处就是 bug。
 *    今天探针实测撞到的正是这个 bug 的成品 ——
 *    PATCH 请求明明已经进到函数里，却被一句"只支持 GET 和 POST"挡掉，
 *    而代码里根本没有 PATCH 分支可走。
 *    ⇒ 让文案从白名单生成，"允许什么"和"说了允许什么"永远同一句话。
 *
 * ⚠️ HEAD 也放行：它按 GET 处理（下面没有单独的 HEAD 分支，直接走 GET 的流程），
 *    这是加写接口之前就有的行为，不要因为这次改动把它挤出去。
 *
 * ⭐ Day 22 实测：加 DELETE 时**只改了下面这一行数组** ——
 *    上面那句报错文案是拼出来的，自动跟着变，一个字都不用改。
 *    这就是"文案从白名单生成"想要的收益。（对比：手写两处必有一天对不上。）
 * ------------------------------------------------------------------ */
const ALLOWED_METHODS = ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'];
const ALLOWED_METHODS_TEXT = '只支持 ' + ALLOWED_METHODS.join('、') + '。';

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
 * 数据访问：**已搬到 repositories/**（Day 19）
 *
 * 这里原本有两个函数：
 *   · loadBodies()        → 现在是 bodiesRepo.listAll()
 *   · loadSourceUrls()    → 现在是 sourcesRepo.urlMap()（连内存映射一起搬走）
 * ⇒ 已删除，调用点见下面的 dispatch()。
 * ------------------------------------------------------------------ */

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

/* 观测记录（表里的行）→ 接口字段：**契约 3.4.2 的那 6 个**。
 *
 * ⭐ 为什么把它从 createObservation 里提出来（Day 22）：
 *    现在**两处要用** —— POST 新增后回吐、PATCH 修改后回吐，而且契约要求
 *    两者的响应形状**完全一致**。抄成两份的话，将来契约加一个字段只会改一处，
 *    另一处就静默少一个键 —— 调用方还以为"这条记录本来就没这个字段"。
 *    （同 BODY_NOT_OBJECT / OBS_COLUMNS 的理由：两处要用就提出来。）
 *
 * ⚠️ note 写成 `row.note === undefined ? null : row.note`：
 *    让这个键**总是出现**（值可能是 null），调用方不用去猜
 *    "是没有这个键，还是值就是空"。
 * ⚠️ created_at 要过 isoUtc()：PostgREST 回来的是
 *    "2026-10-04T13:14:00.123456+00:00"，与契约样例的带 Z 格式不一致。 */
function toObservation(row) {
  return {
    id: row.id,
    bodyId: row.body_id,
    observedOn: row.observed_on,
    status: row.status,
    note: row.note === undefined ? null : row.note,
    createdAt: isoUtc(row.created_at)
  };
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

/* 取请求路径 —— 现在有两个用途：
 *   ① 日志（每个分支都打一条，用来确认请求到底进没进来）
 *   ② **读侧的资源分流**（见下面的 resourceOf()；Day 22 板块③ 步骤 2 起才成立）。
 * 原注释写的是「只用于日志与"POST 打到了读接口"这种明显误用的判断」—— 那句话已过期。 */
function getPath(event) {
  return String(
    (event && (event.path || event.rawPath)) ||
      (event && event.requestContext && event.requestContext.path) ||
      ''
  );
}

/* 取请求路径的**末段**（去掉 query、去掉首尾斜杠）
 *
 * ⚠️ Day 18 第 4 步实测：公网走网关时 `event.path` **恒为 "/"** ⇒ 本函数永远返回空串，
 *    当时它**只剩日志用途**（`fn invoke` 手动塞 path 时才有效 —— 这就是"本地测过、云端失效"的根源）。
 *
 * ⭐ Day 22 板块③ 步骤 2 起，这条限制**对 `/api/observations` 已解除**：
 *    该路由在 `cloudbaserc.json` 里开了 `enablePathTransmission: true`
 *    （原文：**true=完整路径传到上游，false=只传匹配后路径**；默认 false ⇒ 所以之前一直是 "/"），
 *    `event.path` 现在带回**完整路径**（实测 `/api/observations`）⇒ 可按资源分流，见下面的 resourceOf()。
 *    ⚠️ `/api/bodies` 那条**有意没开**（保持老行为零变化），它的末段仍是空串 ——
 *       `resourceOf()` 把"认不出末段"一律映射成 bodies，靠的就是这一点。
 */
function lastPathSegment(event) {
  const raw = getPath(event).split('?')[0].replace(/\/+$/, '');
  if (!raw) return '';
  const parts = raw.split('/');
  return parts[parts.length - 1] || '';
}

/**
 * 这次请求打的是哪个资源？返回 `'bodies'` 或 `'observations'`。
 *
 * 【为什么现在才可能】
 *   开 `enablePathTransmission` 之前，`event.path` 恒为 "/"，两个资源在函数里
 *   **长得一模一样** ⇒ 只能按 method 分流（见 dispatch 里那几段说明）。
 *   开关打开后 `/api/observations` 的 path 是完整路径，才第一次有了"资源"这个维度。
 *
 * 【⭐ 判据：路径末段**全等**，不是"路径里包含 observations"】
 *   「包含」会让将来任何名字里带 observations 的路径（比如 `/api/x-observations`）
 *   误命中 —— 这类误命中**不报错**，只是安静地返回了错的数据，最难查。
 *   同理也**不看 query**：query 是用户可控的，路径是配置决定的，后者才可信。
 *
 * 【⭐ 认不出来时一律按 bodies】
 *   `/api/bodies` 没开透传（末段为空串）⇒ 走这条兜底 ⇒ **加本函数之前的行为原样保留**。
 *   这条兜底不是"顺手写的默认值"，是"老路由零变化"的实现方式。
 */
function resourceOf(event) {
  return lastPathSegment(event).toLowerCase() === 'observations' ? 'observations' : 'bodies';
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

/* ==================================================================
 * 读接口（Day 22 板块③ 步骤 2）：GET /api/observations —— 观测记录列表
 *
 * 【为什么现在才加 —— 它推翻了 Day 18「不解锁读侧」的拍板】
 *   Day 22 清单的完成标准原文是「**DELETE 删除后 GET 不再返回**」，
 *   主任务写的是「增删改查四类操作**闭环完整**」——
 *   没有读接口，"该条已经消失了"这件事**用任何现有接口都验不了**
 *   （唯一能读的 GET /api/bodies 读的是**另一张表**）。
 *   检查台要做的"删除前二次确认"也得先能**看到要删哪条**，否则只能让人手抄 uuid。
 *   ⇒ 三条理由指的是同一件事：必须有最小读接口。契约 v0.5 记了这次翻转。
 *
 * 【⚠️ 它是"最小"的：故意不加参数】
 *   · 不分页、不筛选、不支持 `?id=` —— 整张表现在就那么几行，加参数只会多出一堆
 *     要校验、要写契约、要测的东西（理由同 observationsRepository 里的说明）。
 *   · 🔴 但它也**不报错**：传了 `?id=` 之类会被**静默忽略**、照常返回列表。
 *     这与 `GET /api/bodies?id=`（给了 id 键、值是空 → BAD_REQUEST）的严格态度**不一致**。
 *     要不要对"意料之外的参数"报错，已提给用户拍板，**结论未定 —— 先如实登记，不擅自决定**。
 * ================================================================== */
async function listObservations() {
  const rows = await observationsRepo.listAll();

  /* 形状与 GET /api/bodies 的列表**保持一致**（`{total, items}`）——
     前端两个接口共用一套读法，检查台不用为它写第二套解析。
     ⚠️ `total` = 实际返回条数（没有筛选、没有 limit，两者恒等）。 */
  const items = rows.map(toObservation);
  return ok({ total: items.length, items: items });
}

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
        错在"请求体里引用了一个不存在的天体"，属于参数不合法（契约 3.4.2 有争论记录）。
     Day 19：查库那行搬去 bodiesRepository.existsById()，这里只留**判断与报错**——
        "在不在"是数据库的知识，"在不在该报什么错"是接口层的决定。 */
  const exists = await bodiesRepo.existsById(input.bodyId);
  if (!exists) {
    return errBadRequest('没有找到 id 为 ' + input.bodyId + ' 的天体，bodyId 必须是 bodies 表里已有的 id。');
  }

  /* ---- ⑦ 插入 ----
     ⚠️ 组装 row 这一步**留在接口层**（Day 19 分层判据）：
        因为这里在做 camelCase → snake_case 的翻译（bodyId → body_id），
        而"接口字段叫什么"是接口层的知识，不是数据库的知识。
        repository 只负责"把这行塞进去、把落库的那行还回来"。 */
  const row = {
    id: uuidv4(),                 /* 表上这一列没有 DEFAULT，必须自己给 */
    body_id: input.bodyId,        /* camelCase → snake_case，依据契约 4.7 */
    observed_on: input.observedOn,
    status: input.status
  };
  if (input.note !== null) row.note = input.note; /* 不给 note 就让它是 NULL，别塞空串 */
  /* created_at 不传：由数据库 DEFAULT now() 生成，**不信任客户端时间** */

  /* Day 19：insert 那 4 行搬去 observationsRepository.insert()。
     ⚠️ 那个函数**故意不认重复**、只把原始错误对象抛出来（带在 `e.cause` 上），
        因为下面这段"认 23505 → 翻译成中文"是**返响应**的事，不是数据访问的事。 */
  let saved;
  try {
    saved = await observationsRepo.insert(row);
  } catch (e) {
    const raw = e.cause || e; /* 取回 SDK 的原始 error 对象（含 code / message / details） */

    /* 重复：由唯一约束兜底，这里只做翻译 */
    if (isDuplicateError(raw)) return errDuplicate(input.observedOn);

    /* ⚠️ 日志里必须带上 `code`（PG 的 SQLSTATE）：
       describe() 只取 message，而权限类错误的 message 只有一句
       "permission denied for table observations" —— 看不出**是谁**没权限、为什么。
       42501 就是 Day 18 真踩的那个坑（云函数身份还是 anon、没配 API Key）。 */
    const code = String(raw.code || '');
    const hint =
      code.indexOf('42501') !== -1
        ? '（42501 = 权限不足：多半是云函数没配 CLOUDBASE_APIKEY，连库身份还是 anon）'
        : '';
    throw new Error(
      '写 observations 失败：' + describe(raw) + '（code=' + (code || '-') + '）' + hint
    );
  }

  if (!saved) throw new Error('写 observations 后没有拿到回吐的行。');

  /* 回吐的 6 个字段**固定都在**（含 note 为 null）——
     契约 3.4.2 明列了 6 个，调用方不用去猜"这个键是没有还是没值"。 */
  return ok(toObservation(saved));
}

/* ==================================================================
 * 改接口（Day 22）：PATCH /api/observations?id=<uuid> —— 修改一条观测记录
 *
 * 契约 3.5 说了三件事，代码照着它写：
 *   1. **只能改两个字段**：status 和 note（Day 22 拍板）。
 *      bodyId / observedOn 是"这条记录记的是谁、哪一天"，改了等于换了一条记录，
 *      正确做法是删掉重记 —— 所以它们出现在请求体里要**报错**，不能默默忽略。
 *   2. id 从 query 给（`?id=<uuid>`），因为网关不支持通配符、路径参数配不出来。
 *   3. id 不存在 → `NOT_FOUND` + 中文说明。
 * ================================================================== */

/* 可改字段的白名单。提成数组：既用于校验，也用于生成"只能改 xxx"那句报错文案 ——
 * 又是"同一件事的两处表达"，手写两遍必然有对不上的一天。 */
const PATCH_FIELDS = ['status', 'note'];

/* PATCH 的"请求体不对"文案。
 * ⚠️ 和 POST 的 BODY_NOT_OBJECT **故意分成两句**：举例必须举这个接口真能接受的形状，
 *    POST 那句举例里的 bodyId / observedOn 在 PATCH 里恰恰是**不许出现**的字段 ——
 *    照着 POST 那句写，等于在教用户发一个会被拒的请求。 */
const PATCH_BODY_NOT_OBJECT =
  '请求体必须是一段 JSON 对象，例如 {"status":"observed","note":"看得很清楚"}。';

/* uuid 的形状：8-4-4-4-12 个十六进制字符。
 *
 * 🔴 为什么必须在**接口层**先挡一道（Day 22）：
 *    `observations.id` 是 PG 的 `uuid` 类型。传 `?id=abc` 进去，
 *    数据库会回 `invalid input syntax for type uuid`（SQLSTATE 22P02），
 *    而这个异常在入口被统一变成 INTERNAL ⇒ 用户只是**把 id 写错了**，
 *    却看到"服务暂时不可用"。（Day 17 判过同一类案子：别把"你写错了"说成"服务器坏了"。）
 *
 * ⚠️ 这里只查"形状像不像 uuid"，**不查版本号 / variant** ——
 *    目的只是别让非法值走到数据库，不是做 uuid 规范校验。
 *    写严了会把合法但非 v4 的 id 误拒（PG 本身也接受多种写法）。 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 从 query 里解析出"这次要动哪一条记录"，或者直接给出**一句现成的中文报错**。
 *
 * @param {object} event 云函数事件
 * @param {string} verb  出现在报错里的动作名 —— `'修改'`（PATCH）/ `'删除'`（DELETE）
 * @returns {{ok:true, id:string} | {ok:false, message:string}}
 *
 * 【⭐ 为什么 PATCH 和 DELETE 共用这一个函数】
 *   两条路径要做**完全一样的四步判断**（没给 id 键 / 值是空 / 不是 uuid / 通过），
 *   只有报错里的动词不一样。抄两份的风险不是"看着啰嗦"，而是**将来只改一处** ——
 *   比如哪天把 uuid 的正则放宽，只改了 PATCH、DELETE 还在按老规矩拒；
 *   这种不一致很难被注意到，因为两条路径**都"能跑"**。
 *   ⇒ 抽成一个函数、动词当参数传进来，句式的统一由代码保证。
 *   📌 这也是"两处要用就提出来"（同 BODY_NOT_OBJECT / OBS_COLUMNS）——
 *      在这里它顺带把 Day 22 第 3 步留下的 readTargetId() 收编掉了：
 *      那一步只有一个调用方，多留一个只被调用一次的函数反而是噪声。
 *
 * 【⭐ 为什么"没给 id"要分成两种，而不是都算"没给"】
 *      · 没写 `?id=`          → 用户根本没表达要动哪一条 → 该告诉他"要给出 id"
 *      · 写了 `?id=` 值是空   → 他表达了意图、但值漏了     → 该告诉他"值是空的"
 *    两种都是错，但**错在哪不一样**，文案不一样人才知道怎么改。
 *    ⇒ 同一套判据在给 bodies 用的 resolveRequest() 里已经用过一次，那次修的是
 *      "`?id=` 空值却返回 11 条列表"——用户参数写错却拿到"看起来正常"的数据。
 *
 * ⚠️ 用 rawQuery() 而**不是** parseQuery()：后者会把空值滤掉，
 *    于是"键在、值是空"会退化成"键不在"，上面两种错就分不开了。
 *
 * ⚠️ 非法 id 报 BAD_REQUEST（由调用方原样返回），**不是** NOT_FOUND：
 *    `abc` 连一个合法的 uuid 都不是，它不可能存在于库中 ⇒
 *    问题不在"找不到"，而在"你给的 id 不成形"。
 *    给 NOT_FOUND 会让人以为"格式对、只是没数据"，方向就带偏了。
 */
function resolveTargetId(event, verb) {
  const raw = rawQuery(event);
  const hasIdKey = Object.prototype.hasOwnProperty.call(raw, 'id');
  const id = hasIdKey
    ? String(raw.id === null || raw.id === undefined ? '' : raw.id).trim()
    : '';

  if (!hasIdKey) {
    return { ok: false, message: verb + '接口需要给出 id，例如 ?id=dc97fecd-5e5c-4f59-959c-0196a3b3179b。' };
  }
  if (!id) {
    return { ok: false, message: verb + '接口需要给出 id，但传了空值。' };
  }
  if (!UUID_RE.test(id)) {
    return { ok: false, message: 'id 必须是 uuid 格式，例如 dc97fecd-5e5c-4f59-959c-0196a3b3179b。' };
  }
  return { ok: true, id: id };
}

/**
 * 校验 PATCH 的请求体。返回 `{ ok:true, value }` 或 `{ ok:false, message }`。
 * `value` 只装**这次真要改的列**（没给的字段不出现 ⇒ 数据库那边这一列不动）。
 *
 * 校验顺序是**定死**的（先报哪个错可预期）：
 *   ① 不是 JSON 对象 → ② 出现了白名单外的字段 → ③ 两个可改字段一个都没给
 *   → ④ status 取值 → ⑤ note 类型 / 长度
 *
 * ⚠️ 三个最容易写错的地方：
 *   1. 判"字段给没给"必须用 `hasOwnProperty`，**不能**用 `isBlank()`：
 *      `{"note": null}` 是**有意义的**（= 把备注清空），而 isBlank() 会把它
 *      当成"没给" ⇒ 用户想清空备注，结果什么都没发生，两边都看不出问题。
 *      （isBlank 那套是 POST 的语义：POST 里字段缺失就是"没这个值"。PATCH 不一样。）
 *   2. 白名单外的字段要**报错**，不能默默忽略。否则调用方传了 observedOn、
 *      以为日期改了，实际一个字都没变 —— 这种"静默无操作"是最难查的。
 *   3. `note: ""` / 纯空格 → 归一化成 `null` 再入库。空串和 NULL 在 PG 里是两回事，
 *      留着空串会让"没有备注"出现两种表示，以后筛选/判空就得分两种情况写。
 *      （POST 那边也刻意避开空串，见 createObservation 的 `if (input.note !== null)`。）
 */
function applyPatch(body) {
  /* ① 必须是一段 JSON 对象 */
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, message: PATCH_BODY_NOT_OBJECT };
  }

  /* ② 白名单外的字段一律拒（含 bodyId / observedOn） */
  const extra = Object.keys(body).filter(function (k) {
    return PATCH_FIELDS.indexOf(k) === -1;
  });
  if (extra.length) {
    return {
      ok: false,
      message:
        '只能修改 ' + PATCH_FIELDS.join(' 和 ') + '，收到了不该出现的字段：' + extra.join('、') + '。'
    };
  }

  const hasStatus = Object.prototype.hasOwnProperty.call(body, 'status');
  const hasNote = Object.prototype.hasOwnProperty.call(body, 'note');

  /* ③ 一个都没给：空的 PATCH 没有意义（到底层也会是非法语句） */
  if (!hasStatus && !hasNote) {
    return {
      ok: false,
      message: '至少要给出 ' + PATCH_FIELDS.join(' 或 ') + ' 其中一个字段，否则这次修改没有任何内容。'
    };
  }

  const value = {};

  /* ④ status：给了就必须三选一；没给 = 这一列不动 */
  if (hasStatus) {
    const status = String(body.status === null || body.status === undefined ? '' : body.status).trim();
    if (OBS_STATUSES.indexOf(status) === -1) {
      return { ok: false, message: 'status 只能是 observed、missed 或 planned 之一。' };
    }
    value.status = status;
  }

  /* ⑤ note：允许字符串（写进去）/ null 或空串（= 清空）/ 其它类型拒 */
  if (hasNote) {
    const rawNote = body.note;
    if (rawNote === null) {
      value.note = null;
    } else if (typeof rawNote !== 'string') {
      return { ok: false, message: 'note 必须是字符串；想清空备注就传 null。' };
    } else if (!rawNote.trim()) {
      value.note = null;
    } else if (charLength(rawNote) > NOTE_MAX) {
      return { ok: false, message: 'note 最长 ' + NOTE_MAX + ' 个字符。' };
    } else {
      value.note = rawNote;
    }
  }

  return { ok: true, value: value };
}

/**
 * PATCH /api/observations?id=<uuid>
 *
 * 契约 3.5：改一条已有记录，只允许改 status / note；成功回吐**改完之后**的整条记录
 * （调用方不用再查一次才知道现在是什么值）；id 不存在 → NOT_FOUND。
 */
async function updateObservation(event) {
  /* ---- ① 请求体先校验 ----
     ⚠️ 顺序上先校 body、后查 id：body 错是"这个请求根本没发对"，
        先报它比先跑一趟数据库更省事，而且错误顺序可预期。
     Day 22 的求值顺序：body → id 形状 → 查库。 */
  const got = readJsonBody(event);
  if (!got.parsed) return errBadRequest(PATCH_BODY_NOT_OBJECT);

  const v = applyPatch(got.value);
  if (!v.ok) return errBadRequest(v.message);

  /* ---- ② 要动哪一条 ----
     ⚠️ 顺序上先校 body、后解析 id：body 错是"这个请求根本没发对"，
        先报它比先跑一趟数据库更省事，而且错误顺序可预期。
     Day 22 的求值顺序：body → id（三态 + 格式）→ 查库。 */
  const target = resolveTargetId(event, '修改');
  if (!target.ok) return errBadRequest(target.message);

  /* ---- ③ 改库 ----
     ⚠️ 这里**不判断重复（23505）**，和 createObservation 不一样 —— 这是有意的：
        可改字段只有 status / note，而唯一约束是 (body_id, observed_on)，
        这个接口**没有能触发唯一冲突的路径**。
        留这段说明，免得后来人以为是漏了。（POST 必须判，因为它的三个字段全在约束里。） */
  let saved;
  try {
    /* ⚠️ 注意这里**没有 camelCase → snake_case 的翻译**，而 POST 那边有
       （bodyId → body_id）。不是漏了 —— 是可改字段叫 status / note，
       本来就是单字、表上的列名也一样，翻译是恒等的。
       📌 记一笔免得后来人以为这里漏了一步；哪天可改字段里加了带大写字母的
         （比如 bodyId），**这里就必须补翻译**，否则会写进一列不存在的列名。 */
    saved = await observationsRepo.update(target.id, v.value);
  } catch (e) {
    const raw = e.cause || e; /* 取回 SDK 的原始 error 对象（含 code / message） */
    const code = String(raw.code || '');
    const hint =
      code.indexOf('42501') !== -1
        ? '（42501 = 权限不足：多半是云函数没配 CLOUDBASE_APIKEY，连库身份还是 anon）'
        : '';
    throw new Error('改 observations 失败：' + describe(raw) + '（code=' + (code || '-') + '）' + hint);
  }

  /* ⚠️ null = 库里没有这个 id。这里**不抛异常**（同 bodies 的 findById）：
     "用户写了个不存在的 id"是**正常结果**，抛出去会被入口的 catch 变成 INTERNAL，
     那就把"你写错了"说成"服务器坏了"。 */
  if (!saved) return errObservationNotFound(target.id);

  return ok(toObservation(saved));
}

/* ==================================================================
 * 删接口（Day 22）：DELETE /api/observations?id=<uuid> —— 删除一条观测记录
 *
 * 契约 3.6 说了三件事：
 *   1. **无请求体** —— 删哪一行完全由 `?id=` 决定；
 *   2. id 不存在 → `NOT_FOUND` + 中文说明（与 PATCH 一致）；
 *   3. 成功时回吐**被删掉的那一行**（删之前的样子）。
 * ================================================================== */

/**
 * DELETE /api/observations?id=<uuid>
 *
 * ⚠️ 先分清两个 "delete"（读这个文件最容易混的一处）：
 *    · `method === 'DELETE'`        —— **HTTP 动词**：客户端说"这次请求要删东西"；
 *    · `observationsRepo.remove()`  —— **数据访问层的函数名**：去数据库删掉那一行。
 *    两个名字故意不完全一样：如果仓库层也叫 `delete()`，
 *    读到这里就分不清"这是在判断请求方法，还是在操作数据库"。
 *
 * 🔴 🔴 【「删除容易出事」三处值守，这里是第 ② 处】
 *    ① 仓库层 `remove()`：入口自查空 id —— 不带条件的 DELETE 会清空整张表；
 *    ② **本函数**：id 三态 + uuid 格式，不正的 id 根本到不了数据库；
 *    ③ 前端：删除前弹二次确认，人没法手滑。
 *    三道彼此不重复：它们拦的是**不同来源**的错误（调用方的 bug / 用户的输入 / 人的手滑）。
 *
 * 【为什么这个接口不需要校验请求体】
 *    删哪一行**完全由 `?id=` 决定**，请求体里没有任何东西能改变删除的范围
 *    ⇒ "不问 body"不是图省事，是因为 body 在这里**不构成影响**。
 *    这句话本身就是一条安全论证：只要 `?id=` 是被校验过的，删除范围就是确定的，
 *    不存在"请求体里藏了个条件把删除范围放大了"这种可能。
 *    （对比 POST / PATCH：它们的 body 里装着要写进去的值，所以必须逐字段校。
 *      DELETE 没有这个面，也就少了一整类"用户输入没校验"的风险。）
 */
async function deleteObservation(event) {
  /* ---- ① 删哪一条：id 三态 + uuid 格式（与 PATCH 共用同一个函数） ---- */
  const target = resolveTargetId(event, '删除');
  if (!target.ok) return errBadRequest(target.message);

  /* ---- ② 删库 ----
     ⚠️ 调用的是 `remove()` 而**不是** `delete()`：见上面"两个 delete"那段。
     ⚠️ 这里**不判 23505 / 23503**：observations 是叶子表，
        没有任何表靠外键引用它 ⇒ 删它不会撞外键
        （仓库层函数注释里记了"哪天有表引用它就要补翻译"）。 */
  let removed;
  try {
    removed = await observationsRepo.remove(target.id);
  } catch (e) {
    const raw = e.cause || e; /* 取回 SDK 的原始 error 对象（含 code / message） */
    const code = String(raw.code || '');
    const hint =
      code.indexOf('42501') !== -1
        ? '（42501 = 权限不足：多半是云函数没配 CLOUDBASE_APIKEY，连库身份还是 anon）'
        : '';
    throw new Error('删 observations 失败：' + describe(raw) + '（code=' + (code || '-') + '）' + hint);
  }

  /* ---- ③ 没删到 = 库里本来就没有这个 id ----
     ⚠️ 这里**不抛异常**（同 update / bodies.findById）：
        "这条记录不存在"是**正常结果**，抛出去会被入口的 catch 变成 INTERNAL，
        那就把"你要删的东西不在了"说成"服务器坏了"。

     ⭐ 这也顺带定义了**重复删同一条**的行为（可预期）：第二次来会拿到 NOT_FOUND。
        这样做比"假装成功"安全 —— 假装成功的话，前端会以为删掉的是另一条记录，
        而硬删已经撤不回来了：宁可明确说"这条不存在"，也不给一个假的成功。 */
  if (!removed) return errObservationNotFound(target.id);

  /* ---- ④ 回吐被删掉的那一行（删之前的样子）----
     硬删撤不回来 ⇒ 必须让调用方能核对"删掉的到底是不是这一条"。
     形状与 POST / PATCH 完全一致（同一个 toObservation）。 */
  return ok(toObservation(removed));
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
     ⚠️ **本分支不按 path 分流**：POST 进来就按 createObservation 处理。

     📌 历史（Day 18 第 4 步实测）：当时 CloudBase HTTP 网关**不把路由信息传给云函数**，
        /api/bodies 与 /api/observations 的 event.path **都是 "/"**：
          /api/bodies        → event.path === "/"
          /api/observations  → event.path === "/"   ← 一模一样
        query / httpMethod / body 原样透传，**唯独 path 被吃掉** ⇒
        "路径里写了 bodies 还是 observations"在函数里根本区分不出来。
        （`fn invoke` 手动塞 path 是**能**生效的 ⇒ 离线测试会绿、公网静默失效、且不报错。
         这就是它最难排查的地方。）

     ⭐ 现状（Day 22 板块③ 步骤 2）：`/api/observations` 路由开了 `enablePathTransmission` 后
        **path 能区分了**（实测 `/api/observations`，而 `/api/bodies` 仍是 "/"）。

     🔴 但这段代码**仍然不按 path 分流**，两个理由：
        ① 今天的清单只要求"读观测记录"能工作，**没要求给写接口加路径门禁**；
        ② `POST /api/bodies` 该**拒掉**（它本来就不是写接口）还是**保持现状**，
           是一个新决策 —— 已提给用户，**未定**。
        ⇒ 别看到"path 能用了"就顺手加门禁，那是清单外的改动。
     ⚠️ 也因此，本函数的分流依据**现在有两套**：
        写侧（POST/PATCH/DELETE）**只认 method**；读侧除了 method 还认 path（见下面的 resourceOf()）。
        加新的写接口时别以为 path 会顺手帮你分流。 */
    if (method === 'POST') {
      console.log('[api] POST ' + path);
      return await createObservation(event);
    }

    /* ---- 改接口：PATCH（Day 22）----
       ⭐ 同 POST：**不按 path 分流**（理由见上），"改哪一条"由 query 里的 `?id=` 表达。
       ⚠️ 分流依据：**写侧只认 method**。query / httpMethod / body 全都透传；
          path 虽然在**读侧**已经可用（见下面 resourceOf()），但**写侧一律不用它**。 */
    if (method === 'PATCH') {
      console.log('[api] PATCH ' + path);
      return await updateObservation(event);
    }

    /* ---- 删接口：DELETE（Day 22）----
       同 POST / PATCH：**不按 path 分流**，"删哪一条"由 `?id=` 表达。
       ⚠️ 到这一步，四种方法各自去哪已经一目了然：
          POST → 新增、PATCH → 修改、DELETE → 删除、GET/HEAD → 下面读那一段。 */
    if (method === 'DELETE') {
      console.log('[api] DELETE ' + path);
      return await deleteObservation(event);
    }

    /* ---- 其它方法：直接拒 ----
       不加这一句的话，`PUT /api/bodies` 会掉进下面的列表分支、**返回 11 条数据还带 ok:true** ——
       调用方会以为自己改成功了。
       ⚠️ 这条**能**生效，因为它只看 method（method 是透传的），不看 path。

       ⭐ Day 22：判据从「不等于 GET/HEAD 就拒」改成**白名单**，
          文案由 ALLOWED_METHODS 生成。加 PATCH 时只往数组里加一个词，
          报错文案自动跟上 —— 不会再出现今天探针撞到的自相矛盾：
          **代码里已经有 PATCH 分支，门禁却还在说"只支持 GET 和 POST"。** */
    if (ALLOWED_METHODS.indexOf(method) === -1) {
      return errBadRequest(ALLOWED_METHODS_TEXT);
    }

    /* ---- 读接口：先按**资源**分流（Day 22 板块③ 步骤 2）----
       ⭐ 这是全函数**第一处用 path 做判断**的地方，成立的前提只有一个：
          `/api/observations` 路由在 `cloudbaserc.json` 里开了 `enablePathTransmission`
          （终端里用 `?__probe=1` 抓过 event：它的 path 是 `/api/observations`，
           而 `/api/bodies` 仍是 `/`）。
          `resourceOf()` 把"认不出"一律映射成 bodies ⇒ `/api/bodies` 那条老路由
          **走的还是原路，行为零变化**。

       ⚠️ 这里**曾经删过**一条"路径写了 observations 就拒"的门禁 —— 当时它永远不触发
          （path 恒为 "/"），是个"看着有用、实际是死代码"的陷阱。
          现在**不是**把它加回来，而是**正面分流**：门禁只能挡住错的路由，
          分流才能让对的路由真正工作 —— 这两件事必须分清。
       📌 顺带修掉一个登记在册的错误行为：改这一步之前，`GET /api/observations`
          返回的是 **bodies 的 11 条列表**（契约 5.1 未解锁项）。从这一步起它第一次返回对的东西。 */
    if (resourceOf(event) === 'observations') {
      console.log('[api] GET observations ' + path);
      return await listObservations();
    }

    const query = parseQuery(event);
    const req = resolveRequest(event, query);

    /* ---- 参数不合法：传了 id 这个键、值是空的 ---- */
    if (req.kind === 'bad') {
      return errBadRequest('详情接口需要给出 id，但传了空值。');
    }

    /* ---- 详情：GET /api/bodies?id=<id> ---- */
    if (req.kind === 'detail') {
      const id = req.id;

      /* Day 19：查库那 3 行搬去 bodiesRepository.findById()。
         ⚠️ 它返回 null（不是抛异常）—— "库里没这个天体"是正常结果，
            对应契约 3.2 的 NOT_FOUND，由下面这行翻译成中文提示。 */
      const row = await bodiesRepo.findById(id);
      if (!row) return errNotFound(id);

      const srcUrls = await sourcesRepo.urlMap();
      return ok(toDetail(row, srcUrls));
    }

    /* ---- 列表：GET /api/bodies ---- */
    const rows = await bodiesRepo.listAll();
    const filtered = applyFilter(rows, query);

    const lim = parseLimit(query);
    if (!lim.valid) return errBadRequest('limit 必须是大于 0 的整数。');

    /* ⚠️ total 给的是**筛选后的总数**，不受 limit 影响 ——
       这样前端能知道"总共有多少、这次只拿了多少"。
       不传 limit 时 total 恒等于 items.length，与加这个参数之前完全一致。 */
    const items = (lim.value === null ? filtered : filtered.slice(0, lim.value)).map(toListItem);
    return ok({ total: filtered.length, items: items });
}
