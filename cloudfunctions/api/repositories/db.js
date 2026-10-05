/**
 * repositories/db.js —— 数据库连接实例（**全项目唯一一处**）
 * ============================================================
 * 这个文件只干一件事：把「怎么连数据库」写成代码。
 * 别的什么都不管 —— 不查表、不认识任何业务字段。
 *
 * 【Day 19 重构：这 5 行原先在 index.js 里】
 *   原来 `init` + `rdb` 和一堆接口代码混在同一个文件（那时是 737 行）。
 *   按分层判据「这段代码知不知道表名和列名」—— 它知道（`database: 'public'` 就是 schema 名），
 *   所以它属**数据访问层**，搬到这里来。
 *
 * 【为什么必须抽成单独文件，而不是留在 index.js 传给 repository】
 *   如果把 init 留在 index.js、再把 db 当参数传给各 repository：
 *   index.js 里就会有**一段纯粹连数据库的代码**，与"接口只留接请求/调函数/返响应"冲突。
 *   反过来，如果让每个 repository 自己 init：
 *   会建出 4 个客户端实例，而且下面那句 API Key 警告会**打印 4 遍** —— 排查时看不出真话。
 *   ⇒ 折中：抽成这一个文件，三个 repository 都 require 它，实例**只建一次**。
 * ============================================================
 */

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

/* 【env 不写死】
 *   init 用 cloudbase.SYMBOL_CURRENT_ENV —— 函数在哪个环境跑就用哪个环境，
 *   将来换环境不用改代码（写死的环境 ID 是定时炸弹）。 */
const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV, accessKey: API_KEY });

/* 放模块顶层：云函数实例会被复用，不每次调用都新建客户端
 *
 * ⚠️ 必须显式指定 schema = public（Day 17 实测踩到的坑）：
 *    app.rdb() 的默认值是 `database = envId`，也就是会把
 *    Accept-Profile / Content-Profile 设成**环境 ID**
 *    （solar-system-d3g10b341a8d66aa6）。而我们的三张表建在 **public** schema 下，
 *    于是网关直接回 "Invalid schema: solar-system-d3g10b341a8d66aa6"。
 *    传 { database: 'public' } 就好了。
 *
 * ⚠️ 这里**必须传 `database` 这个键名**（不是 `schema`）—— 这是 SDK 的 API 名字，
 *    虽然它的值其实是 PostgreSQL 的 schema。别按直觉改名。 */
const db = app.rdb({ database: 'public' });

/* ------------------------------------------------------------------
 * 抛错的小工具
 *
 * 三个 repository 都要写「失败了就把 SDK 的错误对象变成一句可读的话，然后抛出去」。
 * 把它提出来放这里，是因为它**只服务于数据库调用**（要读 res.error 的形状）。
 *
 * ⚠️ 为什么 repository **抛异常**、而不是把 res.error 返回给 index.js：
 *    index.js 的 exports.main 里那个 catch 是契约 1.4「真实原因只进日志、公网只回固定文案」
 *    的**唯一**出口。repository 抛 → main 接，链路最短、只有一个地方决定"给用户看什么"。
 * ------------------------------------------------------------------ */
function describe(e) {
  if (!e) return '未知错误';
  if (typeof e === 'string') return e;
  return e.message || e.code || JSON.stringify(e);
}

/* 把 SDK 的 res.error 变成异常抛出 */
function throwIfError(res, what) {
  if (res && res.error) throw new Error(what + '失败：' + describe(res.error));
}

module.exports = { db: db, describe: describe, throwIfError: throwIfError };
