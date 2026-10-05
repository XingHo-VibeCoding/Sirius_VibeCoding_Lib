# API 契约（api-contract.md）

> **状态：两个读接口 + 一个写接口均已实现、已部署、已在公网验证（Day 17 读 / Day 18 写）。**
> Day 15 定了接口"长什么样"；Day 16 把数据库的 2 张表真的建出来并灌了数据（见 **四、数据模型**）；
> Day 17 把两个读接口写完、部署、并用真库数据验证通过（见 **三、接口**）；
> Day 18 新增**第 3 张表 `observations`** 与**第一个写接口 `POST /api/observations`**（见 **3.4**），
> 并完成「真实写入 + SQL 读回交叉验证」（见 **3.4.5**）。
> 这份文件是 **Day 15–20 建表和写接口的唯一依据** —— 后面写接口时以它为准，不再临时改主意。

| | |
|---|---|
| 项目 | 重走太阳系（可交互的 2D/3D 太阳系科普网页） |
| 前端形态 | **原生 HTML + JS，无构建步骤**（`index.html` + `src/*.js`） |
| 后端平台 | **腾讯云 CloudBase（云开发）** 免费体验环境 |
| 数据库 | **PostgreSQL** —— `sources` 4 行 / `bodies` 11 行 / **`observations`（Day 18 新建）**；约束数 15 → **20**（见 **四、数据模型** 与 **3.4.4**） |
| 契约版本 | **v0.4.1**（v0.1.1 → Day 16 v0.2 → Day 17 v0.3.2 → Day 18 v0.4 写接口 → **v0.4.1 回填实测 + 登记网关路径限制**） |
| 已实现 | `GET /api/health` ✅ ｜ 3 张表已建好且已灌数据 ✅ ｜ **`GET /api/bodies`（列表，含 `?type` / `?q` / `?limit`）** ✅ ｜ **`GET /api/bodies?id=<id>`（详情）** ✅ ｜ **`POST /api/observations`（写入）** ✅ |
| 未实现 | **`PATCH` / `DELETE`、批量写入** —— 第 4 周 ｜ **`GET /api/observations`（读观测记录）** —— Day 18 拍板**不做**（见 **3.4.6**） |

---

## 零、先说清楚一件事：这两个接口**当前没有实际收益**

⚠️ **必须如实写在最前面，不能假装它们是必需品。**

今天登记的 `GET /api/bodies` 和详情接口（**详情接口 Day 17 起形状是 `/api/bodies?id=<id>`**，原因见 3.2），**数据现在就在前端** ——
`src/data/bodies.js` 里 11 个天体是**写死的静态数据**，零延迟、不走网络、还省一次请求。

把它们搬到后端，**性能只会更差**（多一跳网络），收益是"演示三层结构"。

所以这份契约的定位是：

- ✅ **结构演示**：走通「前端 → HTTP 访问服务 → 云函数 → 数据」这条链路
- ✅ **为 Day 16 建表做铺垫**：把"一个天体有哪些字段"先定死
- ❌ **不是**因为页面现在需要它

> 📌 **真要一个"有收益"的接口**，应该配一个**页面现在没有的功能** ——
> 比如「我的观测记录」「收藏的天体」。那属于**改版级**动作，今天清单没要求。
> 这个判断留给 Day 16 建表前再确认一次：**如果那时仍觉得没收益，应当如实说出来，而不是硬做。**

**Day 16 的回执**（按上面那句要求，如实回答）：

建表做完了，但**这个判断的答案没有变** —— 数据现在仍然全在 `src/data/bodies.js` 里，
搬到后端**只会多一跳网络**，性能更差。

今天建表是因为清单要求走通"数据层"这一环（学习目的：认识数据模型、外键、约束），
**不是因为页面现在需要它**。⇒ 接口到底接不接进页面，留到 **Day 17 动手前再确认一次**；
如果那时结论仍是"没收益"，应当照实说，**不硬接**。

**Day 17 的回执**（结论**变了**，变在哪也说清楚）：

Day 17 拍板「前端接，并保留静态兜底」，所以**图鉴视图现在真的在用这个接口了**。
但要区分清楚，**收益不是性能**：

| | |
|---|---|
| ✅ **真的收益** | **内容可以不改前端就更新**：Day 17 实测「改数据库一行 → 刷新接口和页面立刻跟着变」。以前改数据必须改代码、提交、重新发布静态站；现在改库即可 |
| ❌ **仍然不是收益** | **速度更差**：数据本来就在 `src/data/bodies.js` 里，零延迟、不走网络；现在多一跳云函数 + 一次查询 |

⇒ 从 Day 16 的「没收益、不硬接」变成 **「有收益，但收益是内容可维护性，不是速度」**。

> ⚠️ 另：接入范围**刻意只做图鉴** —— 详情页**故意不接**，理由见 **3.3**（Day 14 真机测试的教训）。

---

## 一、通用约定

### 1.1 基础路径

所有接口挂在云函数的 **HTTP 访问服务**下，对外路径统一以 `/api/` 开头。

**本项目的真实地址（Day 15 实测）**：

```
https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com/api/<资源>
```

通用形状：

```
https://<环境ID>-<系统分配的数字后缀>.ap-shanghai.app.tcloudbase.com/api/<资源>
```

> ⚠️ **域名不是 `<环境ID>.service.tcloudbase.com`** —— 那是 CloudBase **旧版**的域名格式，
> 照记忆写会写错。现在的默认域名要去控制台
> 「HTTP 访问服务 → 域名管理 → 默认域名」看，或用命令查：
>
> ```
> tcb domains ls -e <envId>
> ```
>
> 本环境实测值：`solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com`
> ⚠️ 中间那段数字后缀（`1483420860`）是**平台分配的，不能自己编**，也不能从别的环境抄。

### 1.2 响应信封（**所有接口统一用这个形状**）

⚠️ 下面是**形状示意**（`<具体数据>` 是占位符，不是字面量），不能直接拿去当 JSON 解析：

```text
成功：
{
  "ok": true,
  "data": <具体数据>,      ← 各接口自己的内容（对象或数组）
  "error": null
}

失败：
{
  "ok": false,
  "data": null,
  "error": {
    "code": "NOT_FOUND",
    "message": "没有找到这个天体。"
  }
}
```

**可直接复制粘贴的真实例子**（以详情接口为例）：

```json
{
  "ok": true,
  "data": { "id": "earth", "nameZh": "地球", "type": "planet" },
  "error": null
}
```

**为什么用信封而不是直接返回数据**：前端只需要判一个 `ok` 字段，
不用靠 HTTP 状态码去猜（有些网关会改写状态码，靠它判断不可靠）。

### 1.3 错误码表

| code | 契约里的 HTTP | **实际 HTTP** | 含义 | 前端该怎么表现 |
|---|---|---|---|---|
| `BAD_REQUEST` | 400 | **200** | 参数不合法（如 `limit` 非法） | 显示错误态 + 重试按钮 |
| `NOT_FOUND` | 404 | **200** | 资源不存在（如 id 查不到） | 显示**空**态（重试没用，不给按钮） |
| `INTERNAL` | 500 | **200** | 服务端自己坏了 | 显示错误态 + 重试按钮 |

> ⚠️ 上表最后两列的区分**沿用 Day 8 定的判据**：
> **空 = 用户重试也没用（不给按钮）；错误 = 重试有用（给按钮）**。
> 三视图（探索 / 图鉴 / 详情）必须说同一句话，不能串台。

> 🔴 **Day 17 实测：三个分支的公网 HTTP 状态码全都是 `200`** ——
> 云函数只返回信封、**没有设置 `statusCode`**，网关也就照 200 回。
> ⇒ 「契约里的 HTTP」这一列是**设计意图**（真按 REST 该是 400 / 404 / 500），**不是当前实际**。
>
> 📌 **这恰好印证了 1.2 的那句话**：本来就不该靠 HTTP 状态码判断，**一律看信封的 `ok` 字段**。
> ⇒ 所以这条差异**对前端零影响**。要不要真返回 400/404，已登记在 **5.1** 第 5 条。

> ⚠️ **`BAD_REQUEST` 的现状（Day 17 三次核对，结论一路在变，最终形态如下）**：
> · 先回代码看：`errBadRequest()` **定义了但无调用点** ⇒ 当时是"预留码"；
> · **余力加练**给了它第 1 个调用点 —— `limit` 非法（见 3.1）；
> · **收尾修正**给了它第 2 个调用点 —— `id` 给了键但值是空（见 3.2）。
> ⇒ 现在它是个**真的会被触发**的错误码。⚠️ 但 `/api/bodies`（**完全不给 id 键**）仍然返回列表，这是**列表的正常写法**、不是错误。

### 1.4 通用错误返回

所有接口都可能返回这两个：

```json
{ "ok": false, "data": null, "error": { "code": "INTERNAL", "message": "服务暂时不可用，请稍后再试。" } }
```

```json
{ "ok": false, "data": null, "error": { "code": "BAD_REQUEST", "message": "请求参数不合法。" } }
```

---

## 二、已实现的接口（Day 15）

### `GET /api/health` ✅ 已实现

**用途**：探活。只回答"服务活着吗"，**不连数据库、无任何依赖**。

| 项 | 内容 |
|---|---|
| 路径 | `/api/health` |
| 方法 | `GET` |
| 请求参数 | **无** |
| 是否需要登录 | 否 |

**成功响应 200**：

```json
{
  "ok": true,
  "service": "solar System"
}
```

> ⚠️ 注意：这是**唯一一个不遵守 1.2 信封**的接口 ——
> 它是 Day 15 临时定的形状（清单原文要求就返回 `{ "ok": true, "service": "solar System" }`）。
> **Day 16 起新增的接口一律走信封**；health 保持原样不改，避免前端探活逻辑跟着动。

**错误响应**：无（这个函数不做任何可能失败的判断）。

**实现位置**：`cloudfunctions/health/index.js`

---

## 三、接口：读（**Day 17**）与写（**Day 18**）

> 📌 `GET /api/bodies` 与 `GET /api/bodies?id=` 已在 **Day 17 写完、部署、并用真库数据验证通过**。
> **实现位置**：`cloudfunctions/api/index.js`（依赖 `@cloudbase/node-sdk`）。
> **路由**由 `cloudbaserc.json` 的 `gateway.routes` 声明，用 `tcb deploy --only gateway` 收敛（幂等、可入库）。
> **连库方式**：`app.rdb({ database: 'public' })` —— ⚠️ 不显式传 `database` 会默认成**环境 ID**，报 `Invalid schema`。

> 📌 **本节导航**：**3.1 / 3.2 是读接口**（Day 17）；**3.3 是前端接入说明**（插叙，讲"为什么只接一处"）；
> **3.4 是写接口**（Day 18 新增）。
>
> ⚠️ **为什么写接口挂在 3.4，而不是另起一整节**：
> 另起一节要把 `四、数据模型` / `五、边界` / `六、变更记录` 全往下挪一位，
> 连带 `4.1–4.8` 八个小节和 `5.1` 都要改号 —— **改号本身就是一次引入不一致的机会**（本文件此前就栽过"凭印象写文档"）。
> ⇒ 选择**零重编号**：接口都归 §三，读在前、写在后。将来 `PATCH` / `DELETE` 进来就顺排 **3.5 / 3.6**。

### 3.1 `GET /api/bodies` —— 天体列表 ✅ **已实现**

**对应页面**：图鉴视图（`#/catalog`）的天体目录。

| 项 | 内容 |
|---|---|
| 路径 | `/api/bodies` |
| 方法 | `GET` |
| 是否需要登录 | 否 |

**请求参数（query string，全部可选）**：

| 参数 | 类型 | 说明 |
|---|---|---|
| `type` | string | 按类型筛。取值：`star` / `planet` / `moon` / `comet`。不传 = 全部 |
| `q` | string | 按名字搜，匹配 **`nameZh` / `nameEn` / `id` 三者任一**（大小写不敏感）。不传 = 不筛 |
| `limit` | integer | **条数上限**（Day 17 余力加练加的）。不传 = 不截断。**必须是 ≥ 1 的整数**，否则 `BAD_REQUEST` |

> 📌 这两个参数**对应当前页面已有的筛选条**（Day 12 做的类型筛选 + 搜索框）。
> 现在筛选是前端算的；将来如果搬到后端，接口形状**已经对得上，前端不用改**。
>
> ⚠️ **`q` 要搜三个字段，不是两个。** 依据 `src/filter.js` 第 71 行的实际实现：
>
> ```js
> const hay = [body.nameZh, body.nameEn, body.id].filter(Boolean).join(' ').toLowerCase();
> ```
>
> `id` 也进了搜索池 —— 所以输入 `halley`、`jupiter` 这类**纯英文 id** 也能命中。
> 后端实现时**必须一致**，否则会静默少搜一类结果（用户以为"没有这个天体"）。

> 📌 **`limit` 的三条规则**（Day 17 余力加练，实测见下）：
>
> | 传什么 | 行为 |
> |---|---|
> | 不传 / 传空串（`?limit=`） | **不截断**，返回全部 —— 与加这个参数之前**完全一致** |
> | `1` ~ 任意正整数 | 截断到前 N 条（超过总数就返回全部，不报错） |
> | `0` / 负数 / 小数 / 字母 | **`BAD_REQUEST`**，message = `limit 必须是大于 0 的整数。` |
>
> ⚠️ **`total` 的语义**：`total` 是**筛选后的总数**，**不受 `limit` 影响** ——
> 这样调用方能知道"一共多少条、这次拿了多少条"。
> 例：`?type=planet&limit=2` → `total: 8`（8 个行星）但 `items` 只有 2 条。
> **不传 `limit` 时 `total === items.length`**，与旧行为一致（前端现在就是这么用的）。
>
> ⚠️ **校验用正则 `/^\d+$/`，不是 `Number()`** —— `Number('')` 是 `0`、`Number(' 3 ')` 是 `3`、
> `Number('3abc')` 是 `NaN`，靠它判"合不合法"会放进一堆脏输入。

**成功响应 200**：

```json
{
  "ok": true,
  "data": {
    "total": 11,
    "items": [
      {
        "id": "earth",
        "nameZh": "地球",
        "nameEn": "Earth",
        "type": "planet",
        "appearance": { "mainColor": "#3B7EC8", "hasRing": false }
      }
    ]
  },
  "error": null
}
```

> 📌 **列表接口只返回"目录真的要用的字段"** —— 完整字段走下面的详情接口，
> 这样列表响应小、加载快。
>
> **这 5 个字段是逐行核对 `src/catalog.js` 的 `buildCard()` 得到的**，不是凭印象列的：
>
> | 字段 | 卡片拿它做什么 |
> |---|---|
> | `id` | 写进 `data-body-id`，点击时用它打开详情 |
> | `nameZh` | 中文名 |
> | `nameEn` | 英文名（有才显示）|
> | `type` | 右上角类型角标（`TYPE_SHORT` 映射成「行星」等）|
> | `appearance.mainColor` | 左边的色点 |
>
> ⚠️ **`diameterKm` / `orbitalPeriodDays` 不在列表里** —— 卡片根本不读它们。
> 初稿曾把这两个也写进列表，属于"顺手多给"，与"只给要用的"这条原则自相矛盾，已删。

**空结果（筛选没命中）**：

```json
{ "ok": true, "data": { "total": 0, "items": [] }, "error": null }
```

> ⚠️ **注意**：筛选没命中是 **200 + 空数组**，**不是 404**。
> 对应用户看到的「没有符合条件的天体」+「清空筛选」出口（Day 12 定的 `no-match` 态）。

**错误响应**：见 1.4。

**Day 17 公网实测**：

| 请求 | 结果 |
|---|---|
| `GET /api/bodies` | 200，`total: 11`，11 条按 `sort_order` 升序 ✅ |
| `GET /api/bodies?type=moon` | 只回月球 1 条 ✅ |
| `GET /api/bodies?q=halley` | 命中哈雷彗星（**证明 `id` 确实在搜索池里**）✅ |
| 筛选没命中 | 200 + `{ "total": 0, "items": [] }`（**不是 404**）✅ |

**Day 17 余力加练 `limit` 的实测**（`fn invoke` + 公网 **两处都跑了**，结果一致）：

| 请求 | `total` | `items` | 结论 |
|---|---|---|---|
| 不传 `limit` | 11 | 11 | 与加参数前**完全一致** ✅ |
| `?limit=3` | **11** | **3**（sun/mercury/venus） | `total` 不受影响 ✅ |
| `?limit=100`（> 总数） | 11 | 11 | 不报错、不截断 ✅ |
| `?type=planet&limit=2` | **8** | **2** | 先筛后截，`total` 是**筛后总数** ✅ |
| `?limit=0` / `?limit=-1` / `?limit=abc` / `?limit=1.5` | — | — | **4 种全部 `BAD_REQUEST`**，message 一字不差 ✅ |

> 📌 `?limit=3` 这类带参数的请求**公网网关会原样透传**（Day 17 实测），不需要额外配置。

> 📌 `type` / `q` 的过滤**在云函数内存里做**（表只有 11 行），**值从不拼进 SQL** ⇒ 无注入面。
> 详情查询走 `.eq('id', id).limit(1)` —— **参数化**。

**实现函数**：`cloudfunctions/api/index.js` 的 `listBodies()`

---

### 3.2 `GET /api/bodies?id=<id>` —— 单个天体详情 ✅ **已实现**

> 🔴 **路径形状在 Day 17 改了：`/api/bodies/:id` → `/api/bodies?id=<id>`。**
> **不是设计改主意，是平台不支持** —— CloudBase HTTP 网关的路径**不接受通配符**
> （CLI 帮助与官方文档都写明 `wildcard /* is not supported`），
> 所以 `/api/bodies/:id` 这种**路径参数根本配不出路由**，只会 404。
>
> ⇒ 云函数里**两条通道都留着**（`?id=` 优先，再兜底从 `/api/bodies/xxx` 末段取），
> **但公网只有 `?id=` 这条能用**。用 `:id` 写的旧文档一律作废。

| 项 | 内容 |
|---|---|
| 路径 | `/api/bodies?id=<id>` |
| 方法 | `GET` |
| 请求参数 | `id` —— 天体标识，如 `earth` / `jupiter` / `halley`。⚠️ **给键但传空值 → `BAD_REQUEST`**；**完全不传键 → 返回列表**，见下 |
| 是否需要登录 | 否 |

**对应页面**：详情视图（`#/body/:id`）的资料卡。
⚠️ 但 **Day 17 前端没有接入这个接口** —— 详情页刻意保持读静态数据，理由见 **3.3**。
接口先做出来是为了**走通链路**，不是详情页现在需要它。

> ⚠️ **`id` 给不给、给了但是空值，行为是不一样的**（Day 17 收尾时改的：原来这两种**都返回列表**）：
>
> | 写法 | 行为 |
> |---|---|
> | `/api/bodies` —— **完全不给 `id` 这个键** | **返回列表** ✅ 这是「列表」的正式写法，图鉴正在用它 |
> | `/api/bodies?id=earth` | 返回 earth 详情 |
> | `/api/bodies?id=` —— **给了键、值是空** | **`BAD_REQUEST`**，message = `详情接口需要给出 id，但传了空值。` |
> | `/api/bodies/` —— **路径带斜杠但没 id** | 同上，`BAD_REQUEST` |
>
> 📌 **为什么要区分**（这是 5.1 第 1 条的正解）：
> 原来 `/api/bodies?id=` 也返回 11 条列表 —— 用户参数写错了，却拿到一份"看起来正常"的数据，**根本看不出自己错了**。
> ⇒ 判据是「**有没有表达出"我要详情"的意图**」：**没给这个键** = 明确要列表；**给了键却是空的** = 想查详情但漏了值。

**成功响应 200**：

```json
{
  "ok": true,
  "data": {
    "id": "earth",
    "nameZh": "地球",
    "nameEn": "Earth",
    "type": "planet",
    "diameterKm": 12756,
    "distanceFromSunKm": 149600000,
    "distanceRaw": "149.6 × 10^6 km",
    "orbitalPeriodDays": 365.2,
    "eccentricity": 0.017,
    "compareToEarth": { "diameter": 1, "distance": 1, "period": 1 },
    "appearance": { "mainColor": "#3B7EC8", "hasRing": false },
    "source": "https://nssdc.gsfc.nasa.gov/planetary/factsheet/",
    "sourceStatus": "verified"
  },
  "error": null
}
```

> 📌 字段与 `TECH_DESIGN.md` 3.1 的 `SolarBody` **完全一致** ——
> 后端返回的东西，前端 `renderBodyCard()` 能直接吃，不用做字段映射。

**月球和哈雷彗星的额外字段**（列表里没有、详情里才有）：

| 字段 | 出现在 | 说明 |
|---|---|---|
| `parentId` | 月球 | `"earth"` —— 月球绕的是地球不是太阳 |
| `distanceFromParentKm` | 月球 | 距地球的半长轴 |
| `distanceFromParentRaw` | 月球 | 原始值，便于反查 |
| `orbitalPeriodNote` | 月球 | 「这是绕【地球】的公转周期」的说明 |
| `extentRaw` | 哈雷彗星 | `"14.9 × 8.2 km（三轴尺寸）"` —— 彗核是长条状，不是圆球 |
| `orbitalPeriodRaw` | 哈雷彗星 | `"27,700 d（≈75.8 年）"` |
| `perihelionAu` | 哈雷彗星 | `0.575` —— 近日点（天文单位）|
| `aphelionAu` | 哈雷彗星 | `35.3` —— 远日点（天文单位）|

> 📌 **这两组字段是实跑 `src/data/bodies.js` 取出来的真实结构**（共 21 个字段名）：
> 11 个天体**共有 13 个**（`id` `nameZh` `nameEn` `type` `diameterKm` `distanceFromSunKm`
> `distanceRaw` `orbitalPeriodDays` `eccentricity` `compareToEarth` `appearance`
> `source` `sourceStatus`），月球**独有 4 个**，哈雷彗星**独有 4 个**。
>
> ⚠️ 初稿只列了月球的 4 个，**哈雷那 4 个漏了** —— 标题却写着"月球和哈雷彗星的"，
> 属"标题承诺了、正文没给"。以后照契约实现会丢掉彗星的近日/远日点。

**id 不存在时的响应 404**：

```json
{ "ok": false, "data": null, "error": { "code": "NOT_FOUND", "message": "没有找到「xxx」这个天体。" } }
```

> ⚠️ **这个文案是刻意对齐前端已有的那句的。**
> 详情页现在区分两种"空"：**数据源为空**（说「暂时没有可显示的天体资料。」，三视图统一）
> 和 **id 不存在**（说「没有找到「xxx」这个天体。」）。
> 后端必须**说同一句话**，否则搬上来之后三视图会串台（Day 13 踩过）。

**Day 17 公网实测**：

| 请求 | 结果 |
|---|---|
| `GET /api/bodies?id=earth` | 完整字段（含 `compareToEarth` / `appearance` 两个**重新拼出来的对象**）✅ |
| `GET /api/bodies?id=moon` | 含月球 4 个独有字段；`source` 由两条来源按「主 ＋ 附加」拼成**一条** ✅ |
| `GET /api/bodies?id=halley` | 含哈雷 4 个独有字段（`extentRaw` / `orbitalPeriodRaw` / `perihelionAu` / `aphelionAu`）✅ |
| `GET /api/bodies?id=nosuch` | `NOT_FOUND` + 上面那句**原文** ✅ |
| `GET /api/bodies?id=`（键在、值是空） | **`BAD_REQUEST`** + `详情接口需要给出 id，但传了空值。` ✅ |
| `GET /api/bodies/`（路径带斜杠、没 id） | 同上 `BAD_REQUEST` ✅ |
| `GET /api/bodies/earth`（**路径通道兜底**） | 详情正常返回 ✅ —— 路由虽然配不出来，函数里这条通道是好的 |

**实现函数**：`cloudfunctions/api/index.js` 的 `getBody()`

---

### 3.3 前端接进哪儿了、为什么**只接一处**

Day 17 新增 `src/api.js`（取数层），**只把图鉴视图接上了**：

| 视图 / 模块 | 数据来源 | 为什么 |
|---|---|---|
| **图鉴**（`#/catalog`） | ✅ **走接口**（`SolarApi.fetchBodies()`） | 纯展示、数据量小；出问题也只是卡片少几张，不影响操作 |
| 2D 主图 · 详情 · 3D 聚焦 · 公转面板 · 三态判据 | ❌ 仍读静态 `src/data/bodies.js` | **详情页不能接异步接口** —— Day 14 真机测试把 300ms「假装在读」删掉了，就是因为它给"手还停在屏幕上"留了窗口（点星 → 内容没出来 → 再点一下 → 落到面包屑上被退回）。异步等待会把这个 bug 请回来 |

**保留静态兜底**：接口拿不到数据时 `src/api.js` 用 `window.SOLAR_BODIES` 顶上并给提示，**页面不会白屏**；
但**两边都空时仍然抛错**，以保住 Day 8 的判据（「空 = 重试没用」vs「错 = 重试有用」）。

⚠️ **实测口径（写文档 / 验收时都按这条）**：
**改数据库一行，只有图鉴的卡片会变；主图上的行星名与颜色不会变。**
这不是 bug，是上表的必然结果。

---

### 3.4 `POST /api/observations` —— 新增一条观测记录（**Day 18**）

> 📌 **这一节是 Day 18 新开的，开之前契约里根本没有 POST 的形状** ——
> 头部只写着"写接口仍未实现、留到 Day 18 再议"。
> ⚠️ 所以 Day 18 清单那句「实现**契约中登记的** POST 接口」**当天并不成立**：
> Day 17 的 GET 有形状可依，今天没有。
> ⇒ **第 0 步就是先把形状定下来再写代码**（沿用 Day 15/16/17 的"契约先行"惯例）。

#### 3.4.1 定这一节之前，三项拍板（Day 18 第 0 步）

| # | 问题 | 拍板 | 代价 / 后果 |
|---|---|---|---|
| 1 | POST 往哪张表写 | **新建第 3 张表 `observations`（观测记录）** | 要改 `db/schema.sql` + `db/seed.sql`，库从 2 张表变 3 张 |
| 2 | 读回怎么做 | ✅ **解锁「写」、不解锁「读」**：**不新增任何读接口** | ⚠️ 清单附加要求里"调读接口读回"这条**今天就做不成**，收尾时如实标为**未做**；读回证据改用 **SQL `select`** |
| 3 | 重复提交的错误码 | **复用 `BAD_REQUEST`** | **1.3 错误码表保持 3 个码不变**，不引入 `CONFLICT` |

**为什么写新表，而不是写进 `bodies`**：
`bodies` / `sources` 装的是 **NASA 真数据**，往里写用户输入就是**污染真数据** —— 与项目红线「**禁止虚构数据**」直接冲突。
`observations` 是**用户产出的数据**（我观测了什么），与天体数据是**两类东西，必须分表**。

**沿用假设（已声明、未被否决）**：**不加用户列** —— 沿用 §五 定的"整站单用户、无登录"。

#### 3.4.2 请求与响应

| 项 | 内容 |
|---|---|
| 路径 | `/api/observations` |
| 方法 | `POST` |
| Content-Type | `application/json`（**请求体是 JSON，不是 query string**） |
| 是否需要登录 | 否 |
| 幂等 | ❌ **不幂等** —— 重复提交**被拒**（拍板：拒绝，**不是**"返回已存在"） |

**请求体**：

```json
{
  "bodyId": "mars",
  "observedOn": "2026-10-04",
  "status": "observed",
  "note": "肉眼可见，偏红"
}
```

| 字段 | 必填 | 类型 / 格式 | 说明 |
|---|---|---|---|
| `bodyId` | ✅ | string | 必须是 `bodies` 表里**已存在**的 id（如 `mars` / `moon` / `halley`） |
| `observedOn` | ✅ | string，`YYYY-MM-DD` | 观测日期 |
| `status` | ✅ | string，三选一 | `observed`（观测到了）/ `missed`（没看到）/ `planned`（计划观测） |
| `note` | ❌ | string，≤ 200 字符 | 备注 |

> 📌 **接口用 camelCase、表用 snake_case**，映射规则沿用 **4.7**；为什么必须映射见 **4.6**
> （PostgreSQL 会把不加引号的 `bodyId` 折叠成 `bodyid`，前端读 `row.bodyId` 拿到 `undefined`、**而且不报错**）。

**成功响应**：

```json
{
  "ok": true,
  "data": {
    "id": "7b0f2c4e-1a3d-4f8b-9c21-5e6d7a8b9c0d",
    "bodyId": "mars",
    "observedOn": "2026-10-04",
    "status": "observed",
    "note": "肉眼可见，偏红",
    "createdAt": "2026-10-04T12:58:31.204Z"
  },
  "error": null
}
```

> **为什么把整条记录回吐**：调用方不用再查一次就知道**服务端到底存了什么** ——
> 尤其是 `id` 和 `createdAt` 都是**服务端生成**的，客户端猜不出来。
> 字段就这 **6 个** —— 沿用 Day 17 定下的原则：**只给要用的，不顺手多给**。

**错误响应**（全部走 **1.2** 的信封，`ok:false`）：

| 场景 | `error.code` | `error.message`（中文，**说清缺了什么**） |
|---|---|---|
| 请求体不是 JSON 对象（含空/纯文本） | `BAD_REQUEST` | `请求体必须是一段 JSON 对象，例如 {"bodyId":"mars","observedOn":"2026-10-04","status":"observed"}。` |
| **缺必填字段**（可同时缺多个） | `BAD_REQUEST` | `缺少必填字段：bodyId（天体 id）、observedOn（观测日期）。` ← **一次列出全部缺失项**，不是只报第一个 |
| `observedOn` 格式不对 | `BAD_REQUEST` | `observedOn 格式不对，应为 YYYY-MM-DD，例如 2026-10-04。` |
| `status` 取值不对 | `BAD_REQUEST` | `status 只能是 observed、missed 或 planned 之一。` |
| `bodyId` 查不到 | `BAD_REQUEST` | `没有找到 id 为 xxx 的天体，bodyId 必须是 bodies 表里已有的 id。` |
| `note` 超长 | `BAD_REQUEST` | `note 最长 200 个字符。` |
| **同一天同一天体重复提交** | `BAD_REQUEST` | `该天体在 2026-10-04 已有观测记录，同一天只能记一条。` |
| 服务端自己坏了 | `INTERNAL` | 走 **1.4** 的固定文案 |

> ⚠️ **`bodyId` 查不到，为什么给 `BAD_REQUEST` 而不是 `NOT_FOUND`**：
> `NOT_FOUND` 描述的是"**这个请求 URI 上找不到资源**"（GET 详情用它）；
> 而这里 **URI 是合法的**，错在**请求体里引用了一个不存在的天体** ⇒ 属于"**参数不合法**"。
> ⇒ **错误码表保持 3 个，不新增。**

#### 3.4.3 防重复：靠数据库唯一约束，不靠"先查后插"

**规则**：**同一天 + 同一天体 = 只能有一条记录**。
这是清单里"**同一天同一计划项**重复打卡"的等价物 —— 项目里没有"计划项"，最接近的维度是"**天体**"。

| 环节 | 怎么做 | 为什么 |
|---|---|---|
| **兜底** | 表上建**唯一约束 `uq_observations_body_date (body_id, observed_on)`** | 把规则交给**数据库**，而不是相信应用层的判断 |
| 应用层 | INSERT 后**捕获唯一冲突**（SQLSTATE `23505`），翻译成 3.4.2 那句中文 `BAD_REQUEST` | 应用层"先 select 再 insert"**有竞态窗口**：两个请求同时查、都说"没有"，然后都插进去 |
| **不做** | **不做**"先查有没有、再插"作为**唯一**手段 | 单用户 demo 下撞不上，但这是坏习惯；**唯一约束才是真防线** |

> ✅ **已全部验证完毕（Day 18 第 2 步实测，本节结案）**：
>
> · ✅ **数据库层**回的原文是这样：`23505 duplicate key value violates unique constraint "uq_observations_body_date"`
>   ⇒ **SQLSTATE 和约束名都在**。
> · ✅ **SDK 的 `res.error` 也确实把 code 传上来了** —— 但 🔴 **带着平台前缀**：
>   实测权限错回来的是 **`DATABASE_42501`**，**不是裸 `42501`**。
>   ⇒ 判断**必须用「包含」而不是全等**：`String(err.code).indexOf('23505') !== -1`。
>   ⚠️ 原来写的 `code === '23505'` **在云上会静默失效**（认不出重复）—— 这是"离线桩喂什么 code、就只会验证什么 code"的典型教训。
> · ✅ 实现里额外留了**第二判据**：`message + details` 里认约束名 `uq_observations_body_date`，
>   万一哪天平台不传 code 了也还能认出重复。
> · ✅ **端到端实测**：重复 POST → `ok:false` / `BAD_REQUEST` / `该天体在 2026-10-05 已有观测记录，同一天只能记一条。`，**库里仍是 1 行**（见 3.4.5）

#### 3.4.4 依赖的表：`observations` ✅ **已建（Day 18 第 1 步，已实测）**

> ✅ **本表已按下面这份结构建好并灌库**。实测（**独立查 `information_schema` / `pg_constraint`**，不照脚本念）：
> **6 列** · **约束 5 条**（全库 **15 → 20**）· 5 条约束名与设计**一字不差** · 建完 **0 行**。
> ⇒ 下面这份结构**已从"设计"升级为"实际"**，不再是待验证草案。汇总数字见 **4.5**，负向测试见 **4.8**。

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | `uuid` | **主键** | 由**云函数**用 `crypto.randomUUID()` 生成 |
| `body_id` | `text` | NOT NULL，**外键** → `bodies.id`（`ON DELETE RESTRICT`） | 观测对象 |
| `observed_on` | `date` | NOT NULL | 观测日期 |
| `status` | `text` | NOT NULL，CHECK ∈ `observed` / `missed` / `planned` | 观测状态 |
| `note` | `text` | 可空，CHECK `char_length(note) <= 200` | 备注 |
| `created_at` | `timestamptz` | NOT NULL，**`DEFAULT now()`** | 由**数据库**生成，**不信任客户端时间** |

**新增约束 5 条** ⇒ 全库 **15 → 20 条**：
`observations` 主键 1 · 外键 1 · 唯一 1（`uq_observations_body_date`）· CHECK 2（`status` 取值、`note` 长度）。

> 📌 **为什么 `observed_on` 不加"不能是未来"的 CHECK**：
> `status` 里有 `planned`（计划观测），**未来日期本身是合法的**。
> 加了这条 CHECK 等于把这个状态废掉；而且会让测试结果**跟着当天日期变**（今天能过、明天不能过）。

**新表起步是空表（0 行）** —— 这正好给第 4 步当**"插入前"的对照**：
`0 行 → POST → 1 行 → 重复 POST → 被拒 → 仍然 1 行`。

#### 3.4.5 验收用例（三条命令 + SQL 读回）✅ **实测通过（Day 18 第 4 步）**

> 下面用 `$API` 代指网关域名：
> `API=https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com`

⚠️ **给用户的命令不要写 `curl`**：本机 PowerShell 5.1 里 `curl` 是 `Invoke-WebRequest` 的 **Alias**，
粘 `curl -s -X POST …` 会报参数错。下面同时给 **`curl.exe` 版**（通用、可给外人）和 **PowerShell 版**（本机实测用）。

**① 正常**

```bash
curl.exe -s -X POST "$API/api/observations" \
  -H "Content-Type: application/json" \
  -d '{"bodyId":"mars","observedOn":"2026-10-05","status":"observed","note":"肉眼可见，偏红"}'
```

```powershell
(Invoke-WebRequest -Uri "$API/api/observations" -Method Post `
  -ContentType "application/json; charset=utf-8" `
  -Body '{"bodyId":"mars","observedOn":"2026-10-05","status":"observed","note":"肉眼可见，偏红"}' `
  -UseBasicParsing).Content
```

预期：`{"ok":true,"data":{"id":"…","bodyId":"mars",…},"error":null}`，**且库里多一行**。

**② 重复**（把 ① 原样再跑一次，或省掉 `note`）

```bash
curl.exe -s -X POST "$API/api/observations" \
  -H "Content-Type: application/json" \
  -d '{"bodyId":"mars","observedOn":"2026-10-05","status":"observed"}'
```

预期：`ok:false`，`error.message` = `该天体在 2026-10-05 已有观测记录，同一天只能记一条。`，**库里行数不变**。

**③ 缺必填字段**

```bash
curl.exe -s -X POST "$API/api/observations" \
  -H "Content-Type: application/json" -d '{"bodyId":"mars"}'
```

预期：`ok:false`，`error.message` = `缺少必填字段：observedOn（观测日期）、status（观测状态）。`

**SQL 读回**（Day 18 拍板：**不用读接口**，用这个证明真的写进去了）

```sql
SELECT id, body_id, observed_on, status, note, created_at
FROM observations ORDER BY created_at DESC;
```

预期：**1 行**，`body_id = mars`、`observed_on = 2026-10-05`。**重复 POST 之后再查，还是 1 行。**

---

##### 📌 实测结果（Day 18 第 4 步，2026-10-05 08:40 · 公网真跑 + 控制台 SQL）

| # | 场景 | 公网真实返回 | 库里 |
|---|---|---|---|
| 0 | 写之前 | — | `count(*) = 0`（对照基线） |
| ① | 正常 POST | `{"ok":true,"data":{"id":"056a7a09-e0d9-4756-bdeb-4a8d91db6015","bodyId":"mars","observedOn":"2026-10-05","status":"observed","note":"肉眼可见，偏红","createdAt":"2026-10-05T00:32:57.231Z"},"error":null}` | **1 行** |
| ② | 重复 POST | `{"ok":false,"data":null,"error":{"code":"BAD_REQUEST","message":"该天体在 2026-10-05 已有观测记录，同一天只能记一条。"}}` | **仍 1 行**（没多插） |
| ③ | 缺 `observedOn` + `status` | `{"ok":false,…,"message":"缺少必填字段：observedOn（观测日期）、status（观测状态）。"}` | 不变 |

**SQL 读回实测**：`id=056a7a09-e0d9-4756-bdeb-4a8d91db6015` / `body_id=mars` / `observed_on=2026-10-05` /
`status=observed` / `note=肉眼可见，偏红` / `created_at=2026-10-05 08:32:57.08+08`

**⭐ 两个交叉验证点**（这两个才是"真的写进去了"的证据，不是"命令没报错"）：

1. **响应里的 `id` 与库里那一行的 `id` 一字不差** ⇒ 确实是同一行，不是各说各话
2. **`createdAt` `2026-10-05T00:32:57.231Z`(UTC) ↔ 库 `2026-10-05 08:32:57.08+08`**：相差正好 8 小时
   ⇒ `isoUtc()` 转换正确，且 `created_at` 确实是**数据库** `DEFAULT now()` 生成的（不是函数传的）

📌 **三点与预期不同的地方，如实记录**：

| 项 | 说明 |
|---|---|
| HTTP 状态码 | ① ② ③ **全部是 200** —— 云函数只返信封、不设 `statusCode` ⇒ **不能靠状态码判断成败**，一律看 `ok`（见 5.1 第 5 条） |
| 错误码 | ② 重复复用 **`BAD_REQUEST`**，不是 `CONFLICT` —— Day 18 拍板，沿用契约 1.3 的三码制 |
| 日期 | 上面示例写 `2026-10-05`（实测用的就是它）；早期草稿里的 `2026-10-04` 已统一改掉 |

#### 3.4.6 本接口**不做**的事（写出来，免得以后以为漏了）

| 项 | 说明 |
|---|---|
| `GET /api/observations`（读接口） | ❌ **不做** —— Day 18 拍板"不解锁读侧"。读回**只用 SQL `select`**<br>⚠️ **但要注意**：这个 URL **现在会返回 bodies 列表且 `ok:true`**（原因见 **5.1 第 7 条**）—— 属**已知行为**，Day 19+ 再处理 |
| `PATCH` / `DELETE`（改 / 删记录） | ❌ **不做** —— 第 4 周 |
| 批量写入（一次 POST 多条） | ❌ **不做** —— 清单明确排除 |
| 用户列 / 登录 | ❌ **不加** —— 沿用"整站单用户" |
| 把 POST 接进前端 | ❌ **不做** —— 今天不接前端；清单要的截图是**公网命令的返回** + **库里那一行** |

---

## 四、数据模型（Day 16 建 2 张表 · **Day 18 加第 3 张**）

> 本节描述的是**实际建出来的结构**，依据 `db/schema.sql`（**不是**凭印象写）。
> 三个文件都在仓库 `db/` 下：
>
> | 文件 | 作用 |
> |---|---|
> | `db/schema.sql` | **建表**（含主键/外键/约束），可重复执行 |
> | `db/seed.sql` | **种子数据**（自包含：DROP → CREATE → INSERT），可重复执行 |
> | `db/gen-seed.mjs` | 生成 `seed.sql` 的**工具**（实跑 `src/data/bodies.js` 取值，非手抄） |
>
> 📌 **改了表结构的正确顺序**：改 `db/schema.sql` → 跑 `node db/gen-seed.mjs` → 跑 `db/seed.sql`。
> （`seed.sql` 的建表段是从 `schema.sql` 抽取的，所以两者不会漂移。）

### 4.1 三张表各存什么

| 表 | 存什么 | 行数 | 数据是**谁产出的** |
|---|---|---|---|
| `sources` | **数据来源**：来源编号 / 显示名 / 网址 | **4** | 别人（NASA） |
| `bodies` | **天体**：每个天体的身份、尺寸与轨道、相对地球、外观、来源 | **11** | 别人（NASA） |
| `observations` | **观测记录**：哪个天体 / 哪天 / 观测状态 / 备注 | **0**（Day 18 起步，空表） | **我的用户** |

**关联字段**：`bodies.source_id` → `sources.id`；**`observations.body_id` → `bodies.id`**（都是外键）

> 📌 **为什么 `sources` 要单独一张表**：8 个行星的数据来自**同一份** NASA 资料。
> 把网址直接写进 `bodies` 的每一行 = 同一个长网址重复 8 遍，改一次要改 8 处。
> 存"编号"、由编号去 `sources` 表查 ⇒ **只写一份、只改一处**。

> ⚠️ **`observations` 为什么必须另起一张表、不能写进 `bodies`**：
> 前两张装的是**别人产出的真数据**，第三张装的是**用户产出的数据**。
> 混在一起 = 用户输入污染真数据，与项目红线「**禁止虚构数据**」冲突。
> ⚠️ 它的**完整结构**放在 **3.4.4**，本节**不重复**（避免两处各写一份、日后漂移）。

### 4.2 `sources`（4 行 × 3 列）

| 列 | 类型 | 约束 | 说明 |
|---|---|---|---|
| `id` | text | **主键** | 沿用代码里 `DATA_SOURCES` 的键名 |
| `label` | text | NOT NULL | 显示名 |
| `url` | text | NOT NULL | 网址 |

4 个来源：`factSheetMetric` / `sunFactSheet` / `moonFactSheet` / `jplSbdbHalley`

> ⚠️ **只有 4 行，不是 5 行。** 清单的完成标准写的是"每张核心表 select ≥ 5 行"，
> 但代码里的 `DATA_SOURCES` **本来就只有 4 条** —— 凭空加第 5 条就是编造数据（项目红线）。
> ⇒ **如实记 4 行，缺口明写在这里，不凑数。**

### 4.3 `bodies`（11 行 × 28 列）

| 这一堆 | 列 | 说明 |
|---|---|---|
| 身份 | `id`(主键) · `name_zh` · `name_en`(唯一) · `type` | `type` ∈ `star` / `planet` / `moon` / `comet` |
| 尺寸与轨道 | `diameter_km` · `distance_from_sun_km` · `distance_raw` · `orbital_period_days` · `eccentricity` | ⚠️ 后两列**只有太阳是 NULL** |
| 相对地球 | `ratio_diameter` · `ratio_distance` · `ratio_period` | 来自 `compareToEarth`；后两列太阳为 NULL |
| 外观 | `appearance_main_color` · `appearance_has_ring` · `appearance_note` · `appearance_ring_note` | 后两列**只有部分行有** |
| 来源 | `source_id`(**外键**) · `source_extra_id`(外键，可空) · `source_status` | 见 4.4 |
| **月球专用** | `parent_id`(**自引用外键**) · `distance_from_parent_km` · `distance_from_parent_raw` · `orbital_period_note` | 只有月球这 4 列非 NULL |
| **哈雷专用** | `extent_raw` · `orbital_period_raw` · `perihelion_au` · `aphelion_au` | 只有哈雷这 4 列非 NULL |
| 顺序 | `sort_order`(唯一) | 1 = 太阳 … 11 = 哈雷，图鉴的显示顺序 |

### 4.4 两处"不是一对一"的地方

**① 月球有两条来源** —— 全表唯一

| 列 | 月球的值 | 其余 10 个天体 |
|---|---|---|
| `source_id` | `factSheetMetric` | 各自一个 |
| `source_extra_id` | `moonFactSheet` | **NULL** |

> 📌 顺序以**代码**为准：`bodies.js` 里是 `S1 + ' ＋ ' + S3`，**`factSheetMetric` 在前**。
> 后端拼回 `source` 字符串时按「主 ＋ 附加」，与页面现在显示的完全一致。

**② `parent_id` 是自引用外键** —— 月球 → 地球，而地球也在同一张表里

⇒ **INSERT 顺序有讲究：地球必须先于月球**（`seed.sql` 里地球是第 4 条、月球是第 5 条，满足）。

### 4.5 约束清单（**共 20 条** = Day 16 的 15 条 + Day 18 的 5 条）

| 表 | 种类 | 条数 | 明细 |
|---|---|---|---|
| `bodies` + `sources`<br>（Day 16） | 主键 | 2 | `bodies.id` · `sources.id` |
| | 外键 | 3 | `source_id`→`sources` · `source_extra_id`→`sources` · `parent_id`→**`bodies` 自己**（全部 `ON DELETE RESTRICT`）|
| | 唯一 | 2 | `uq_bodies_name_en` · `uq_bodies_sort_order` |
| | 检查 | 8 | `type` 取值 · `source_status` 取值 · `diameter_km > 0` · `distance_from_sun_km >= 0` · `orbital_period_days > 0` · `eccentricity ∈ [0,1)` · `sort_order > 0` · `parent_id <> id` |
| **`observations`**<br>（Day 18） | 主键 | 1 | `observations_pkey`（`id`）|
| | 外键 | 1 | `fk_observations_body`：`body_id` → `bodies.id`（`ON DELETE RESTRICT`）|
| | 唯一 | 1 | **`uq_observations_body_date`（`body_id`, `observed_on`）** ← 🔑 **防重复的唯一真防线** |
| | 检查 | 2 | `ck_observations_status`（`status ∈ observed / missed / planned`）· `ck_observations_note_len`（`char_length(note) <= 200`）|
| **合计** | | **20** | |

**Day 18 实测**（**独立查 `information_schema` / `pg_constraint`**，不是照脚本念）：

| 实测项 | 结果 |
|---|---|
| 三张表的列数 | `bodies` 28 · `observations` **6** · `sources` 3 ✅ |
| 约束总数 | **20**（`bodies` 14 + `observations` 5 + `sources` 1）✅ **与设计一字不差** |
| `observations` 的 5 条约束名 | `observations_pkey` · `fk_observations_body` · `uq_observations_body_date` · `ck_observations_status` · `ck_observations_note_len` ✅ **全部命中** |
| 灌库后行数 | `bodies` 11 · `observations` **0** · `sources` 4 ✅ |

> ⚠️ **`uq_bodies_name_en` 是 Day 16 当天补的，值得记一笔。**
> 初版 `db/schema.sql` **只在一句注释里写了"唯一"、没真的写 `UNIQUE`** ——
> 于是设计说 15 条、实际只有 14 条。
> ⇒ 教训：**拿到实际约束清单之后，要和设计清单逐条对账**；只看"总数对不对"是不够的
> （14 和 15 只差一个，但差的是一个真实的数据保护）。

### 4.6 列名为什么是 snake_case

`bodies.js` 里是 `nameZh`，表里是 `name_zh`。

⚠️ **PostgreSQL 里不加双引号的标识符会被折叠成小写** —— 建一个 `nameZh` 列，
实际列名会变成 `namezh`，前端读 `row.nameZh` 拿到 `undefined`（**静默、不报错**）。

⇒ 表里一律 snake_case，**由接口层映射回 camelCase**（见 4.7）。

### 4.7 表 ↔ 接口字段的映射（Day 17 读接口 · **Day 18 写接口**）

#### 4.7.1 `bodies` → 读接口（Day 17）

| 表列 | 接口字段（JSON） | 备注 |
|---|---|---|
| `id` / `name_zh` / `name_en` / `type` | `id` / `nameZh` / `nameEn` / `type` | 直接改名 |
| `diameter_km` / `distance_from_sun_km` / `distance_raw` / `source_status` | `diameterKm` / `distanceFromSunKm` / `distanceRaw` / `sourceStatus` | 直接改名 |
| `ratio_diameter` · `ratio_distance` · `ratio_period` | `compareToEarth.diameter` · `.distance` · `.period` | **要重新拼成一个对象** |
| `appearance_main_color` · `appearance_has_ring` · `appearance_note` · `appearance_ring_note` | `appearance.mainColor` · `.hasRing` · `.note` · `.ringNote` | **要重新拼成一个对象** |
| `source_id` + `source_extra_id` | `source`（**单个字符串**） | 查 `sources.url`；有两条就按「主 ＋ 附加」拼 |
| `parent_id` / `distance_from_parent_km` / `distance_from_parent_raw` / `orbital_period_note` | `parentId` / `distanceFromParentKm` / `distanceFromParentRaw` / `orbitalPeriodNote` | 只有月球有值 |
| `extent_raw` / `orbital_period_raw` / `perihelion_au` / `aphelion_au` | `extentRaw` / `orbitalPeriodRaw` / `perihelionAu` / `aphelionAu` | 只有哈雷有值 |
| `sort_order` | ——（**不出现在响应里**） | 只用于 `ORDER BY` |

> ⚠️ **这是把"平铺的列"还原成"页面看到的嵌套结构"的唯一依据。**
> 少了这一步映射，前端 `renderBodyCard()` 拿不到 `compareToEarth` / `appearance`，资料卡会缺块。

#### 4.7.2 `observations` → 写接口（Day 18，见 **3.4**）

| 表列 | 接口字段（JSON） | 备注 |
|---|---|---|
| `id` | `id` | `uuid`，**由云函数生成**（不是数据库默认值）|
| `body_id` | `bodyId` | 直接改名 |
| `observed_on` | `observedOn` | `date` → `"YYYY-MM-DD"` 字符串 |
| `status` | `status` | 直接改名 |
| `note` | `note` | 可空 ⇒ `null` |
| `created_at` | `createdAt` | `timestamptz` → ISO 8601 字符串，**由数据库生成** |

> 📌 **这张表的映射比 `bodies` 简单得多：6 列平铺 ⇒ 6 个平铺字段，没有"拼嵌套对象"的活。**
> ⇒ 这就是为什么写接口的实现会比读接口短。
> ⚠️ **反过来说：这里没有 `source` 那种"查另一张表"的映射** ——
> 因为 `observations` 不指向 `sources`（观测记录不需要来源，它不是数据，是用户行为）。

### 4.8 怎么验证它是对的（Day 16 实测）

不是"SELECT 出来看着没错"，而是**逐值断言**：

| 检查 | 做法 | 实测结果 |
|---|---|---|
| 数据与代码是否一致 | 从云端 dump 全量 → 与 `src/data/bodies.js` **逐字段对拍** | **318 条断言 / 0 处差异** |
| 约束是否真在拦 | **故意插坏数据**，看被哪条约束拒绝 | **6 / 6 全被拒**，报出的约束名与预测一字不差 |
| 脚本能否重复执行 | `schema.sql` / `seed.sql` 各连跑两次 | 两次结果一致（幂等） |
| 生成器是否可复现 | 连跑两次比对 sha256 | 完全相同 |

---

## 五、边界：**还不登记**的东西

如实列出边界，避免以后以为漏了：

| 项 | 状态 / 为什么还不写 |
|---|---|
| 用户系统 / 登录 | ❌ 页面当前**没有用户概念**，硬加等于虚构 |
| 「收藏天体」「观测记录」 | ⚠️ **半解锁** —— Day 18 解锁了「观测记录」的**写**侧（`POST /api/observations`，见 **3.4**）；**读**侧仍未登记。⚠️ 清单字面提到的 `GET /api/favorites` 仍**不做**（Day 17 拍板按契约做 bodies 两个） |
| **把接口接进前端** | ✅ **Day 17 已做**（只接图鉴，见 **3.3**）。⚠️ 写接口 **Day 18 不接前端**（见 **3.4.6**） |
| CORS 跨域配置 | ✅ **不需要配** —— Day 17 实测**网关自带 CORS**：带 `Origin` 请求会回 `access-control-allow-origin: <origin>` + `access-control-allow-credentials: true` + `vary: Origin`，前端可直接调 |
| 写接口 | ⚠️ **部分解锁** —— ✅ **Day 18 做了 `POST /api/observations`**（见 **3.4**）；❌ `PATCH` / `DELETE` 仍不做（第 4 周）；❌ 批量写入不做 |
| `INTERNAL` 里的调试后缀 | ✅ **已修**（Day 17 收尾）—— catch 里临时带的 `｜[调试] …` 已删掉，恢复 **1.4** 的固定文案；内部原因仍进 `console.error` 日志，公网看不到 |
| 分页（`page` / `pageSize`） | ❌ **不做** —— 表只有 11 行，列表一次给全。Day 17 余力加练只加了 **`limit`（条数上限）**、已进正式契约 3.1；真正的分页留到数据量大了再说 |

---

### 5.1 ⚠️ 代码与契约的差异（Day 17 发现 → **同一天全部处置完毕**）

回读 `cloudfunctions/api/index.js` + `resolveRequest()`、并用 `curl` 实测 HTTP 状态码时，共发现 **5 处**不一致。
按本文件自己的规矩「**实际代码 > 实际环境 > 实际运行结果 > ~~记忆和旧文档~~**」——**先如实登记，再逐条处置**，不留模糊地带。

| # | 差异（发现时的样子） | 处置 | 结果 |
|---|---|---|---|
| 1 | 契约原写"`id` 必填，缺失按 `BAD_REQUEST`"，实际 `id` 为空走**列表分支** | ✅ **收尾修正**：改成按「有没有表达出要详情的意图」分流 —— `?id=`（键在、值是空）→ `BAD_REQUEST`；**完全不给这个键** → 列表 | 3.2 已写明 4 种写法的行为；4 种**实测全对** |
| 2 | `errBadRequest()` **定义了但无调用点** ⇒ `BAD_REQUEST` 永远不会出现 | ✅ **自然解决**：余力加练（`limit` 非法）+ 收尾修正（`id` 空值）给了它 **2 个真实调用点** | 1.3 的注解已更新 |
| 3 | catch 实际返回 `…请稍后再试。｜[调试] <原因>`，与 1.4 的固定文案不一致 | ✅ **收尾修正**：删掉调试后缀，改用 `errInternal()` | 内部原因仍进 `console.error` 日志，**公网看不到** |
| 4 | `index.js` 头部注释写 `GET /api/bodies/:id` | ✅ **收尾修正**：注释改成 `?id=`，并注明平台不支持通配符 | — |
| 5 | 1.3 的「HTTP」列写 400 / 404 / 500，**实际全是 `200`**（云函数没设 `statusCode`） | ⏸ **故意不动**（理由见下） | 契约已改成「设计意图 / 实际」两列 |

> 📌 **第 5 条为什么故意不做**：
> ① 本契约 **1.2** 本来就规定「**不靠 HTTP 状态码判断，一律看信封的 `ok`**」⇒ 返回 400/404 **没有任何功能收益**；
> ② 要真返回，得把响应形状改成 `{ statusCode, headers, body }` —— **有可能把现在正常的响应弄坏**，风险明显大于前四条；
> ③ ⇒ **留作独立一步**：要做时单独改、单独验、单独记录。契约已如实写成两列，**不误导**。

---

#### 5.1.1 🔴 Day 18 新发现两条（**都比上面 5 条更根本**）

##### 第 6 条：写接口有**前置依赖**，契约里此前完全没写 —— **必须 `CLOUDBASE_APIKEY`，否则写不进去**

这是 Day 18 第 2 步卡住的真正原因，**不是代码写错**：

| | |
|---|---|
| 症状 | 云函数报 `permission denied for table observations`（SQLSTATE **`42501`**）；**同一个函数读 `bodies` 一路正常** |
| 根因 | `app.rdb()` 默认拿云函数自带凭证换 token，网关解析出的角色是 **`anon`**；而 `anon` 在三张表上**只有 `SELECT`** ⇒ **能读、不能写**。`cloudbase_authenticator` 是 `NOINHERIT`，纯粹按 JWT 里的 `role` 字段 `SET ROLE` |
| 解法 | 三个应用角色各有唯一来源：`anon` ← Publishable Key ／ `authenticated` ← Access Token ／ **`service_role` ← API Key**。<br>云函数用 **`service_role`**：`cloudbase.init({ env, accessKey: process.env.CLOUDBASE_APIKEY })`。<br>官方文档给的**方式二**就是"用 API Key、通过**环境变量**注入" |
| SDK 现成钩子 | `getClientCredential()` 开头「有 `accessKey` 就直接返回」⇒ **传个 `accessKey` 即可，数据访问代码一行不用改** |
| 配置入口 | 控制台 → **函数管理 → 点函数名 `api` → 函数配置 → 环境配置 → 「API Key 设置」开关**（自动注入 `CLOUDBASE_APIKEY` + `CLOUDBASE_APIKEY_ID`）<br>⚠️ 别手填 key/value（要拼对大小写和下划线，容易静默失败） |
| ⚠️ 安全 | Key 是 `service_role`（**不过期 · `BYPASSRLS` · 严禁前端**）⇒ **只存在云函数环境变量里，绝不进仓库**。`.env` / 连接串永不入库 |

**⇒ 结论：`POST /api/observations` 的可用前提 = 云函数配了 `CLOUDBASE_APIKEY`。** 这条是**部署依赖**，不是接口形状的一部分，但**不写下来，换环境重部署时一定会再踩一次**。

##### 第 7 条：🔴🔴 **CloudBase HTTP 网关不把路由信息传给云函数** ⇒ **路径分流在本环境做不到**

Day 18 第 4 步实测（用"响应反射探针"查出，因为**本环境 CLS 日志未开**、`tcb fn log` 报 `topic not exist`）：

| 字段 | 公网到达云函数时的值 | 能否用来分流 |
|---|---|---|
| `path` | **恒为 `"/"`** —— `/api/bodies` 与 `/api/observations` **一模一样** | ❌ **不能** |
| `queryStringParameters` | ✅ 原样透传（`?id=earth` 照常工作） | ✅ 可以 |
| `httpMethod` | ✅ 正常 | ✅ 可以 |
| `body` | ✅ 正常 | ✅ 可以 |
| `requestContext` | 只有 `appId` / `envId` / `requestId` / `uin`，**没有路径** | ❌ 不能 |

⇒ 网关**纯按路由把请求分发到同一个函数，但不把"是哪个路由来的"传下去**。

**这解释了 `GET /api/observations` 为什么返回 bodies 列表**：
云函数只能按「有没有 `id`」分流 ⇒ 该请求落进列表分支。**不是忘了判断，是判断不出来。**

**为什么这个坑最难查**（以后别再踩）：
`fn invoke` 时**手动给 event 塞 `path` 是生效的** ⇒ 离线单测全绿；**一到公网就静默失效、且没有任何报错**。
属"本地测过、云端失效"一族，与 **1.3/5.1-5「别靠 HTTP 状态码判断」** 同源。

**处置（Day 18 拍板 = 方案 b）**：
- ✅ **如实登记现状** —— 即 **3.4.6** 与本节这条；`GET /api/observations` **会返回 bodies 列表**，属**已知行为**
- ⛔ **删掉了**代码里两次尝试的路径门禁 —— 留着就是"看着有用、实际是死代码"的陷阱
  （`lastPathSegment()` 降级为**只用于日志**，注释里写明原因）
- ⏭ **真正要做（Day 19+ 独立一步）**：让网关把路由信息放进 **query 或 header**（路由的 `path_passthrough` 之类参数），函数再据此分流；**或**干脆给 `observations` 加一个**真读接口**，路径歧义自然消失
- ✅ **方法门禁仍有效**（`PUT /api/bodies` → `只支持 GET 和 POST。`）—— 它只看 `httpMethod`，**不看 `path`**

##### ⚠️ 顺带登记录用到的两条脚手架事实（都不是契约内容，但不记会重复摸索）

| 项 | 事实 |
|---|---|
| 云函数日志 | **本环境 CLS 日志未开**，`tcb fn log api` 报 `[SearchClsLog] topic not exist` ⇒ 排查**不能依赖日志**。本次改用**响应反射探针**（临时把 `event` 字段塞进响应体）绕开 |
| 改环境变量 | `tcb fn env` **只有 `pull`、没有 `set`**。要改走通用 API：<br>`tcb api scf UpdateFunctionConfiguration --api-version 2018-04-16 --body '<json>'`<br>⚠️ 参数是 **`--body`**（不是 `--params`）；**`Environment.Variables` 必须是数组** `[{Key,Value}]`（对象形式报 `array-type` 错）；<br>⚠️ **更新时必须把 `CLOUDBASE_APIKEY` / `CLOUDBASE_APIKEY_ID` 一起带上**，否则会被清空 |

> 📌 **改代码的代价如实记**：这几条一改，按规矩必须**重新部署 + 重跑全部验证**，不能只跑改动的那条。
> 本次重跑了 **14 个 `fn invoke` 分支 + 11 项公网 curl + 前端图鉴探针**。
> ⇒ 一次改完更划算，**建议 Day 17 收尾时或 Day 18 一起做**。

---

## 六、变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-10-02（Day 15） | 初稿。登记 `GET /api/health`（已实现）+ `GET /api/bodies` / `GET /api/bodies/:id`（占位）。定下响应信封与错误码表 |
| v0.1.1 | 2026-10-02（Day 15） | **核对后修订 4 处**（都是"写的时候凭印象、对的时候发现不对"）：<br>① 1.1 基础路径改成本环境实测域名（旧稿写成 CloudBase 旧版格式 `service.tcloudbase.com`）<br>② 3.1 列表接口删掉 `diameterKm` / `orbitalPeriodDays`（逐行核对 `catalog.js` 的 `buildCard()`，卡片只用 5 个字段）<br>③ 3.1 `q` 参数补上 `id` 也参与搜索（依据 `filter.js` 第 71 行）<br>④ 3.2 补上哈雷彗星独有 4 个字段 `extentRaw` / `orbitalPeriodRaw` / `perihelionAu` / `aphelionAu`（初稿标题写了"月球和哈雷"、正文只给了月球）|
| **v0.2** | 2026-10-02（Day 16） | **新增「四、数据模型」整节**（表结构、外键、15 条约束、表↔接口字段映射、验证方法）；原「四、边界」「五、变更记录」顺延为五、六。<br>① 头部状态从"尚未实现/不建表"改为"表结构已落地"；契约版本 v0.1.1 → **v0.2**<br>② 新增 4.1–4.8 共 8 小节（4.7 是 Day 17 写接口时的**字段映射依据**）<br>③「零」节补上 **Day 16 回执**：建表已做，但"接口有没有实际收益"的判断**答案没变**，留 Day 17 再确认<br>④ 边界表删掉"PostgreSQL 建表 DDL"行（已做），改为"把接口接进前端（Day 17）"<br>⑤ 记录一处**当天发现并修掉的缺陷**：`name_en` 的唯一约束**设计有、实现没建**（注释写了"唯一"却没写 `UNIQUE`），已补 `uq_bodies_name_en` 并重跑全部验证 |
| **v0.3** | 2026-10-03（Day 17） | **两个读接口从"占位"变"已实现"，并补上落地时才暴露的四件事**：<br>① 头部状态、版本、已实现/未实现两行全部改写（业务接口 0 → 2）<br>② 🔴 **3.2 路径形状改了：`/api/bodies/:id` → `/api/bodies?id=<id>`** —— 平台 HTTP 网关不接受通配符（`wildcard /* is not supported`），路径参数**配不出路由**。云函数里两条通道都留着，公网只有 `?id=` 能用<br>③ 3.1 / 3.2 各补一节 **Day 17 公网实测**（11 条、`?type=moon`、`?q=halley` 命中 id、`?id=moon` 双来源拼接、`?id=nosuch` 原文报错）<br>④ **新增 3.3「前端接进哪儿了、为什么只接一处」** —— 只接图鉴；详情页**故意不接**（Day 14 那个"手还停在屏幕上"的教训），并写明"改库只有图鉴会变"这条实测口径<br>⑤「零」节补 **Day 17 回执**：结论**变了** —— 收益是「内容可不改前端就更新」，**不是速度**<br>⑥「五」节边界表更新：接前端/CORS 两条标 ✅（网关自带 CORS，实测可用），新增"`INTERNAL` 调试后缀"与"分页"两条<br>⑦ 登记一处**临时偏差待决**：`index.js` 的 catch 里带着 `｜[调试] …`，与 1.4 的固定文案不一致<br>⑧ **新增 5.1「代码与契约的已知差异」**（4 条，未改代码等拍板）—— 其中第 1 条是**我写这份契约时写错、回代码核对才发现的**：原写"`id` 缺失按 `BAD_REQUEST` 处理"，实际 `id` 为空走的是**列表分支**；并据此在 1.3 标注 `BAD_REQUEST` 为**预留码**（代码里无调用点） |
| **v0.3.1** | 2026-10-03（Day 17） | **余力加练：给列表加条数上限 `?limit=N`**（实现在 `parseLimit()`）。<br>① 3.1 参数表加 `limit` 行 + 一整个说明块（三条规则、`total` 语义、"为什么用正则不用 `Number()`"）<br>② 3.1 补 **`limit` 实测表**（`fn invoke` 与公网两处都跑，结果一致；含 4 种非法值全部 `BAD_REQUEST`）<br>③ 3.1 补一句：**公网网关会原样透传 query 参数**<br>④ 🔴 **1.3 错误码表改成「契约里的 HTTP / 实际 HTTP」两列** —— 实测三个分支**实际全是 `200`**（云函数没设 `statusCode`）；并说明这与 1.2「不靠状态码判断」的设计一致，**对前端零影响**<br>⑤ `BAD_REQUEST` 的注解更新：余力加练让它**有了第一个真实调用点**（`limit` 非法），不再是纯预留码<br>⑥ §五「分页」行更新：确认**只做 `limit`，不做分页**<br>⑦ 5.1 新增**第 5 条**：HTTP 状态码一律 200 的差异登记<br>⑧ 附：本次改动**动了云函数代码**，因此按规矩**重跑了全部 14 个分支**（8 个 limit 用例 + 6 个旧分支回归），全过 |
| **v0.3.2** | 2026-10-03（Day 17） | **收尾修正：把 5.1 登记的前 4 条代码差异一次修掉**（第 5 条故意留）。<br>① 🔴 **3.2 的行为变了**：`?id=`（给了键、值是空）**从"返回列表"改成 `BAD_REQUEST`**；**完全不给 `id` 键**仍然返回列表（图鉴在用的就是它）。判据写成「有没有表达出要详情的意图」，并给出 4 种写法的对照表<br>② 3.2 实测表新增 3 行：`?id=` 空值、`/api/bodies/`、**路径通道 `/api/bodies/earth` 可用**<br>③ 1.3 的 `BAD_REQUEST` 注解更新为**最终形态**（2 个真实调用点：`limit` 非法、`id` 空值）<br>④ §五「`INTERNAL` 调试后缀」行改为 ✅ **已修**<br>⑤ **5.1 从"待拍板"改成"发现 → 同日全部处置完毕"**，逐条写清处置与结果；第 5 条（HTTP 状态码）写明**为什么故意不做**<br>⑥ 云函数 `index.js`：`resolveId()` → **`resolveRequest()`**（返回 list / detail / bad 三态）、catch 改用 `errInternal()`、头部注释订正<br>⑦ 按规矩**重新部署 + 重跑全部验证**：14 个 `fn invoke` 分支 + 11 项公网 curl + 前端图鉴探针，全过 |
| **v0.4** | 2026-10-04（Day 18） | **新增「3.4 写接口」整节 + 第 3 张表 `observations`**（开这一节之前，契约里**根本没有 POST 的形状**）。<br>① 🔴 **先记一处"清单不成立"**：清单说"实现**契约中登记的** POST 接口"，而契约当时只写着"写接口仍未实现、留 Day 18 再议" —— **没有形状可依**。Day 17 的 GET 有形状，今天没有 ⇒ 第 0 步先补契约<br>② **三项拍板**（记在 3.4.1）：新建 `observations` 表 ／ **解锁写、不解锁读**（不新增读接口，读回只用 SQL）／ 重复用 `BAD_REQUEST`（**不引入 `CONFLICT`**）<br>③ 3.4.2 定下请求体 4 字段（`bodyId` / `observedOn` / `status` 必填，`note` 可选）、成功响应**回吐 6 个字段**、**7 种错误场景 + 中文 message 原文**（含"**一次列出全部缺失字段**"）<br>④ 3.4.3 定**防重复 = 数据库唯一约束 `uq_observations_body_date (body_id, observed_on)` 兜底 + 捕获 SQLSTATE `23505`**，明确**不用"先查后插"当唯一手段**（有竞态窗口）；⚠️ 同时登记一处**未验证项**：SDK 是否回传 SQLSTATE / 约束名<br>⑤ 3.4.4 记 `observations` 结构（6 列）+ **约束 15 → 20 条**；并说明**为什么不加"日期不能是未来"的 CHECK**（会废掉 `planned` 状态，且让测试结果随当天日期变）<br>⑥ 3.4.5 落 **三条验收命令 + SQL 读回**（第 4 步回填实测）<br>⑦ 3.4.6 明确**不做的五件事**（读接口 / `PATCH` / `DELETE` / 批量写入 / 用户列 / 接前端）<br>⑧ 🔴 **结构选择登记为"零重编号"**：写接口挂在 **§三.4**，而不是另起一整节 —— 另起要把 `四 / 五 / 六` 全部下移一位，连带 `4.1–4.8` 八个小节与 `5.1` 一起改号，而**改号本身就是引入不一致的机会**（本文件此前就栽过"凭印象写文档"）。§三 标题相应改为「接口：读（Day 17）与写（Day 18）」<br>⑨ 头部改写：状态行 / 数据库行（加 `observations`）/ 契约版本 / 已实现·未实现两行；§五 边界表的「观测记录」「写接口」两行改为**半解锁 / 部分解锁** |

| **v0.4.1** | 2026-10-05（Day 18） | **写接口落地后回填实测 + 补两条"契约里根本没有、但不知道就做不成"的事实**。<br>① 头部：状态行「写接口 Day 18 契约已定、代码待落地」→ **「已实现、已部署、已在公网验证」**；已实现行补 `POST /api/observations` ✅<br>② **3.4.5 回填实测**：三条命令的公网真实返回 + SQL 读回原文 + **两个交叉验证点**（响应 `id` 与库里 `id` 一字不差；`createdAt` UTC ↔ 库 UTC+8 相差正好 8 小时 ⇒ 证明 `created_at` 是**数据库**生成的）<br>③ 3.4.5 补**三点与预期不同**：HTTP 全 `200` ／ 重复复用 `BAD_REQUEST` ／ 示例日期统一为 `2026-10-05`；并给 **`curl.exe` 与 PowerShell 两种命令**（⚠️ 本机 PowerShell 里 `curl` 是 `Invoke-WebRequest` 的 **Alias**，直接粘 `curl` 会报参数错）<br>④ 🔴 **3.4.3 未验证项整条结案** —— SDK **确实**把 code 传上来了，**但带平台前缀 `DATABASE_`**（权限错回 `DATABASE_42501`，不是裸 `42501`）⇒ 判断必须改成「**包含** 23505」而非全等；旧的 `=== '23505'` **在云上静默失效**<br>⑤ 🔴🔴 **新增 5.1.1 第 6 条**：**写接口的前置依赖 —— 云函数必须配 `CLOUDBASE_APIKEY`**（`anon` 只有 SELECT ⇒ 能读不能写）。此前契约**完全没写这条**，换环境重部署一定再踩<br>⑥ 🔴🔴 **新增 5.1.1 第 7 条**：**CloudBase HTTP 网关不把路由信息传给云函数**（`path` 恒为 `"/"`，`/api/bodies` 与 `/api/observations` 在函数里**无法区分**）⇒ 这解释了 `GET /api/observations` 为什么返回 bodies 列表：**不是忘了判断，是判断不出来**。**处置 = 方案 b：如实登记现状**（Day 18 拍板）；代码里两次尝试的路径门禁**已删除**（留着是"看着有用、实际是死代码"的陷阱），`lastPathSegment()` 降级为只用于日志<br>⑦ 3.4.6 的「`GET /api/observations` 不做」一行补上**现状警告**（该 URL 现在会返回 bodies 列表 + `ok:true`）<br>⑧ 顺带登记两条脚手架事实：**本环境 CLS 日志未开**（`tcb fn log` 报 `topic not exist`，排查改用"响应反射探针"）／**改环境变量**要走 `tcb api scf UpdateFunctionConfiguration`（参数是 `--body`、`Variables` 必须是数组、**更新时必须带上原有 Key 否则清空**）<br>⑨ 按规矩**重新部署 + 重跑全部验证**：离线单测 **51/51**（原「路径门禁」11 条改写成「钉住现状」6 条，故意用 `path:"/"` 这个**公网真实形状**当输入）+ **公网 7 条**全过（POST 正常/重复/缺字段 · GET 列表/详情/health · PUT 被拒） |

> 🔴 **这份契约的"事实来源"优先级**（以后改它时按这个顺序核对，别凭印象）：
> 1. **实际代码**（`src/data/bodies.js` 的字段、`catalog.js`/`filter.js` 真正读了什么）
> 2. **实际环境**（`tcb domains ls` / `tcb env list` 的输出）
> 3. **实际运行结果**（`curl` 打一次真实地址）
> 4. ~~记忆和旧文档~~ —— **最不可信**，Day 15 的 4 处错误全部来自这里
