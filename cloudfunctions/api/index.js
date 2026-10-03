/**
 * 云函数 api —— Day 17 的第一个读接口
 * ============================================================
 * 负责两个 GET：
 *   GET /api/bodies?id=<id>   单个天体详情
 *   GET /api/bodies           天体列表（图鉴视图用）
 *                             可选筛选：?type= / ?q= / ?limit=（条数上限）
 *
 * ⚠️ 详情接口用 **query 参数 `?id=`**，不是路径参数 `/:id`（Day 17 实测后改的）：
 *    CloudBase HTTP 网关**不支持通配符**（`wildcard /* is not supported`），
 *    `/api/bodies/:id` 这种路径**配不出路由**。函数里两条通道都留着（见 resolveRequest），
 *    但**公网只有 `?id=` 这条能用**。契约 3.2 已同步。
 *
 * 数据从哪来：云端的 **PostgreSQL**（Day 16 建的 bodies / sources 两张表），
 * 不再是前端 src/data/bodies.js 里那份写死的静态数据。
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

const cloudbase = require('@cloudbase/node-sdk');

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });

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

/* ------------------------------------------------------------------
 * 入口
 * ------------------------------------------------------------------ */

exports.main = async function (event) {
  try {
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
  } catch (e) {
    /* 真实原因只进日志，**不直接回给前端**（避免把内部结构暴露给公网）。
       ⏳ Day 17 收尾：排查期临时带的 `｜[调试] …` 已删掉，恢复契约 1.4 的固定文案。 */
    console.error('[api] 未处理异常：', (e && e.stack) || e);
    return errInternal();
  }
};
