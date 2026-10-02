# API 契约（api-contract.md）

> **状态：表结构已落地（Day 16），业务接口仍未实现。**
> Day 15 定了接口"长什么样"；Day 16 把数据库的 2 张表真的建出来并灌了数据（见 **四、数据模型**）。
> 这份文件是 **Day 16–20 建表和写接口的唯一依据** —— 后面写接口时以它为准，不再临时改主意。

| | |
|---|---|
| 项目 | 重走太阳系（可交互的 2D/3D 太阳系科普网页） |
| 前端形态 | **原生 HTML + JS，无构建步骤**（`index.html` + `src/*.js`） |
| 后端平台 | **腾讯云 CloudBase（云开发）** 免费体验环境 |
| 数据库 | **PostgreSQL** —— `sources` 4 行 / `bodies` 11 行，共 15 条约束（见 **四、数据模型**） |
| 契约版本 | **v0.2**（Day 15 占位 v0.1.1 → Day 16 补数据模型） |
| 已实现 | `GET /api/health` ✅ ｜ **两张表已建好且已灌数据** ✅ |
| 未实现 | `GET /api/bodies`、`GET /api/bodies/:id` —— 仍是**占位**，Day 17 起写 |

---

## 零、先说清楚一件事：这两个接口**当前没有实际收益**

⚠️ **必须如实写在最前面，不能假装它们是必需品。**

今天登记的 `GET /api/bodies` 和 `GET /api/bodies/:id`，**数据现在就在前端** ——
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

| code | HTTP | 含义 | 前端该怎么表现 |
|---|---|---|---|
| `BAD_REQUEST` | 400 | 参数不合法（如 id 为空） | 显示错误态 + 重试按钮 |
| `NOT_FOUND` | 404 | 资源不存在（如 id 查不到） | 显示**空**态（重试没用，不给按钮） |
| `INTERNAL` | 500 | 服务端自己坏了 | 显示错误态 + 重试按钮 |

> ⚠️ 上表最后两列的区分**沿用 Day 8 定的判据**：
> **空 = 用户重试也没用（不给按钮）；错误 = 重试有用（给按钮）**。
> 三视图（探索 / 图鉴 / 详情）必须说同一句话，不能串台。

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

## 三、占位接口（**Day 17–20 实现，至今只登记**）

> 📌 **Day 16 没有实现它们** —— 那天只建了表（见四）。这里的形状仍是 Day 15 定的占位。

### 3.1 `GET /api/bodies` —— 天体列表

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

---

### 3.2 `GET /api/bodies/:id` —— 单个天体详情

**对应页面**：详情视图（`#/body/:id`）的资料卡。

| 项 | 内容 |
|---|---|
| 路径 | `/api/bodies/:id` |
| 方法 | `GET` |
| 路径参数 | `id` —— 天体标识，如 `earth` / `jupiter` / `halley` |

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

---

## 四、数据模型（Day 16 建的表）

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

### 4.1 两张表各存什么

| 表 | 存什么 | 行数 |
|---|---|---|
| `sources` | **数据来源**：来源编号 / 显示名 / 网址 | **4** |
| `bodies` | **天体**：每个天体的身份、尺寸与轨道、相对地球、外观、来源 | **11** |

**关联字段：`bodies.source_id` → `sources.id`**（外键）

> 📌 **为什么要有两张表**：8 个行星的数据来自**同一份** NASA 资料。
> 把网址直接写进 `bodies` 的每一行 = 同一个长网址重复 8 遍，改一次要改 8 处。
> 存"编号"、由编号去 `sources` 表查 ⇒ **只写一份、只改一处**。

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

### 4.5 约束清单（**共 15 条**，Day 16 实测）

| 种类 | 条数 | 明细 |
|---|---|---|
| 主键 | 2 | `bodies.id` · `sources.id` |
| 外键 | 3 | `source_id`→`sources` · `source_extra_id`→`sources` · `parent_id`→**`bodies` 自己**（全部 `ON DELETE RESTRICT`）|
| 唯一 | 2 | `uq_bodies_name_en` · `uq_bodies_sort_order` |
| 检查 | 8 | `type` 取值 · `source_status` 取值 · `diameter_km > 0` · `distance_from_sun_km >= 0` · `orbital_period_days > 0` · `eccentricity ∈ [0,1)` · `sort_order > 0` · `parent_id <> id` |

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

### 4.7 表 ↔ 接口字段的映射（Day 17 实现接口时用）

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

### 4.8 怎么验证它是对的（Day 16 实测）

不是"SELECT 出来看着没错"，而是**逐值断言**：

| 检查 | 做法 | 实测结果 |
|---|---|---|
| 数据与代码是否一致 | 从云端 dump 全量 → 与 `src/data/bodies.js` **逐字段对拍** | **318 条断言 / 0 处差异** |
| 约束是否真在拦 | **故意插坏数据**，看被哪条约束拒绝 | **6 / 6 全被拒**，报出的约束名与预测一字不差 |
| 脚本能否重复执行 | `schema.sql` / `seed.sql` 各连跑两次 | 两次结果一致（幂等） |
| 生成器是否可复现 | 连跑两次比对 sha256 | 完全相同 |

---

## 五、Day 17–20 会碰、但**至今不登记**的东西

如实列出边界，避免以后以为漏了：

| 项 | 为什么还不写 |
|---|---|
| 用户系统 / 登录 | 页面当前**没有用户概念**，硬加等于虚构 |
| 「收藏天体」「观测记录」 | 这是**方案 B** 才有的接口。Day 15 拍板走**方案 A**（从现有内容推），所以不登记 |
| **把接口接进前端** | Day 17 的活。Day 16 **只建了表，前端一个字都没改** |
| CORS 跨域配置 | Day 20；前端还没接接口，不存在跨域问题 |
| 写接口（POST/PUT/DELETE） | 页面当前**没有用户能改的数据**，没有写需求 |

---

## 六、变更记录

| 版本 | 日期 | 变更 |
|---|---|---|
| v0.1 | 2026-10-02（Day 15） | 初稿。登记 `GET /api/health`（已实现）+ `GET /api/bodies` / `GET /api/bodies/:id`（占位）。定下响应信封与错误码表 |
| v0.1.1 | 2026-10-02（Day 15） | **核对后修订 4 处**（都是"写的时候凭印象、对的时候发现不对"）：<br>① 1.1 基础路径改成本环境实测域名（旧稿写成 CloudBase 旧版格式 `service.tcloudbase.com`）<br>② 3.1 列表接口删掉 `diameterKm` / `orbitalPeriodDays`（逐行核对 `catalog.js` 的 `buildCard()`，卡片只用 5 个字段）<br>③ 3.1 `q` 参数补上 `id` 也参与搜索（依据 `filter.js` 第 71 行）<br>④ 3.2 补上哈雷彗星独有 4 个字段 `extentRaw` / `orbitalPeriodRaw` / `perihelionAu` / `aphelionAu`（初稿标题写了"月球和哈雷"、正文只给了月球）|
| **v0.2** | 2026-10-02（Day 16） | **新增「四、数据模型」整节**（表结构、外键、15 条约束、表↔接口字段映射、验证方法）；原「四、边界」「五、变更记录」顺延为五、六。<br>① 头部状态从"尚未实现/不建表"改为"表结构已落地"；契约版本 v0.1.1 → **v0.2**<br>② 新增 4.1–4.8 共 8 小节（4.7 是 Day 17 写接口时的**字段映射依据**）<br>③「零」节补上 **Day 16 回执**：建表已做，但"接口有没有实际收益"的判断**答案没变**，留 Day 17 再确认<br>④ 边界表删掉"PostgreSQL 建表 DDL"行（已做），改为"把接口接进前端（Day 17）"<br>⑤ 记录一处**当天发现并修掉的缺陷**：`name_en` 的唯一约束**设计有、实现没建**（注释写了"唯一"却没写 `UNIQUE`），已补 `uq_bodies_name_en` 并重跑全部验证 |

> 🔴 **这份契约的"事实来源"优先级**（以后改它时按这个顺序核对，别凭印象）：
> 1. **实际代码**（`src/data/bodies.js` 的字段、`catalog.js`/`filter.js` 真正读了什么）
> 2. **实际环境**（`tcb domains ls` / `tcb env list` 的输出）
> 3. **实际运行结果**（`curl` 打一次真实地址）
> 4. ~~记忆和旧文档~~ —— **最不可信**，Day 15 的 4 处错误全部来自这里
