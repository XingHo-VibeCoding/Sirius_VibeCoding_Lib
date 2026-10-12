# 重走太阳系

一个可交互的太阳系科普网页。当文字科普让人觉得晦涩难懂时，打开它——
靠图形、动画和中文引导词，一点点看懂太阳系。

> 这是「Vibe Coding 打卡」学习项目的作品，作者是**编程零基础**学员。
> 项目从需求研究、产品文档、技术设计一路做到这里，过程文档见下方「相关文档」。

---

## 怎么跑起来

### 方式一：直接双击打开（最简单）

双击项目根目录的 **`index.html`**，浏览器就会打开它。

不需要安装任何东西，不需要联网，不需要命令行。

> **为什么能这样**：这个项目没有后端、没有数据库、没有构建步骤，
> 所有数据和代码都是普通文件，随页面一起交给浏览器。
> 数据特意用 `.js` 文件而不是 `.json`，就是为了避开"双击打开时浏览器
> 拒绝读取本地 `.json`"这个坑。

### 方式二：起一个本地服务（想用 localhost 地址时）

在项目目录下打开命令行，**两行依次执行**：

```bash
# 第 1 行：切到项目目录。下面这个路径换成你自己存放项目的完整路径。
#          /d 不能省 —— 如果命令行原本停在 C 盘（C:\Users\你的名字>），
#          cmd 里跨盘符切换不加 /d 是切不过去的。
cd /d D:\AI部_学习打卡\VibeCoding

# 第 2 行：起服务。--bind 127.0.0.1 也别去掉，原因见下方第 2 条。
python -m http.server 8080 --bind 127.0.0.1
```

然后用浏览器访问 **<http://localhost:8080/>**

**怎么确认起对了**：命令行里会出现 `Serving HTTP on 127.0.0.1 port 8080`，
**而且提示符停在项目目录**（形如 `D:\...\VibeCoding>`）。两样都对，再去看浏览器。

几个必须知道的点：

1. 需要电脑上装有 Python 3。
2. **`--bind 127.0.0.1` 不要省。** 不加的话它默认绑 `0.0.0.0`（所有网卡），
   同一网络下（比如同一个 Wi-Fi）别人能通过你的局域网 IP 打开这个网页，
   看到你电脑上的**文件清单**——因为它会把"当前目录"整个当成网站根目录列出来。
   加上 `--bind 127.0.0.1` 就只有你自己的电脑能访问。
3. **如果提示 8080 被占用**，把命令里的 `8080` 换成 `8081` 再试。
4. 按 `Ctrl + C` 停止服务。
5. 浏览器里出现 `GET /favicon.ico 404` 这类日志是正常的（浏览器自动向每个网站要小图标），不用管。


---

## 现在能做什么

| 功能 | 说明 |
|---|---|
| 整体视图 | 太阳 + 八大行星沿各自椭圆轨道运行，哈雷彗星那条极扁的轨道一眼可辨 |
| 天体目录 | 11 个天体列成卡片（色点 + 中英文名 + 类型），**点卡片等于在主图上点了它一次** |
| 资料卡 | 点任意一颗天体，弹出它的**直径 / 距日平均距离 / 公转周期 / 与地球对比**四项，每项都配一条对比条 |
| 3D 特写 | 点开后同时弹出该天体的 3D 球体，可拖动旋转、滚轮缩放 |
| 调控区 · 时间流速 | 暂停 / 实时 / 演示（默认）/ 快进 |
| 调控区 · 轨道比例 | 图示比例 ↔ 真实比例（切到真实比例，会看到内行星挤成一团） |
| 调控区 · 教学对比 | 把八颗行星的公转周期并排画成条，一眼看出水星 0.24 年、海王星 163.7 年 |
| 四种页面状态 | 加载中（过渡屏）/ 成功 / 空 / 错误，四种都有各自的界面；出错时给「重新加载」按钮，空的时候不给（重试也没用） |

### 还没做的

- **引导主线（12 站）**——这是本产品最核心的差异点，尚未实现
- 主图的**缩放与平移**
- 小行星带的视觉呈现
- 月球在 2D 主图上的入口（月球绕地球运行，不画在日心图上；它的资料卡逻辑已就绪，等引导主线做到"月球"那一站时接上）

---

## 目录结构

```
VibeCoding/
├── index.html              唯一入口页面
├── AGENTS.md               项目规则（人机协作约定）
├── research.md             需求研究（Day 3）
├── PRD.md                  产品需求文档（Day 4）
├── TECH_DESIGN.md          技术设计文档（Day 5）
├── api-contract.md         接口契约（Day 15 起；v0.4.1）
├── USER_TEST.md            真机测试记录（Day 14）
├── WEEK3_ACCEPTANCE.md     第 3 周验收表 + 同伴交叉验证 + 演示提纲（Day 21）
├── SECURITY-AUDIT.md       安全自查说明与结论（Day 23）
├── CORE_FLOW_TEST.md       核心流程测试清单：检查台「读 → 写 → 刷新 → 改 → 删」（Day 24）
├── RELEASE_v1.0.md         发布清单：版本标记 / 发布前验证 / 发布步骤 / 发布后验证 / 备份方式（Day 26）
├── ROLLBACK.md             回滚手册：触发条件 / 回退步骤 / 回滚后验证（Day 26）
├── TRIAL_TASK.md           第三方试用：外行任务卡 + 记录表模板 + 预埋点登记（Day 27）
├── RESOURCE_STATUS.md      资源与到期说明：用量 / 到期 / 导出数据的检查步骤（Day 27）
├── FINAL_ACCEPTANCE.md     最终验收表与项目映射表：100 分表自查 / 能力底线对应 / 提示词改写 / 交付清单（Day 28）
├── DEMO_SCRIPT.md          演示脚本：3–5 分钟录屏的提纲 / 分镜 / 逐句提词 / 录制前准备与容错（Day 28）
├── cloudbaserc.json        CloudBase 配置：云函数清单 + 网关路由（Day 15）
├── README.md               本文件
│
├── src/
│   ├── data/
│   │   └── bodies.js       全部天体数据 + 来源标注（静态兜底数据源）
│   ├── api.js              取数层：调后端接口，拿不到时回落到上面的静态数据（Day 17）
│   ├── states.js           页面状态机（加载中 / 成功 / 空 / 错误）
│   ├── router.js           hash 路由：路径 ↔ 视图（Day 13）
│   ├── scene2d.js          2D 主图 + 点击 + 资料卡
│   ├── catalog.js          天体目录（11 张卡片，点卡片 = 点天体）
│   ├── filter.js           目录筛选：类型按钮 + 搜索框（Day 12）
│   ├── controls.js         调控区（时间流速 / 轨道比例 / 教学对比）
│   ├── focus3d.js          3D 聚焦（按需加载 Three.js）
│   ├── status.js           检查台（#/status）：服务健康 / 数据库真实数据 / 写入测试（Day 20）
│   └── fallback.js         错误兜底（任何一块坏掉都不白屏）
│
├── styles/
│   └── main.css            全部样式
│
├── cloudfunctions/         云函数（后端）
│   ├── health/
│   │   └── index.js        探活接口：只回一句「我活着」，不连数据库（Day 15）
│   └── api/                主接口函数（Day 17 读 · Day 18 写 · **Day 19 分层重构**）
│       ├── index.js        **接口层**：接请求 → 调 repository → 塑形 → 返响应
│       ├── repositories/   **数据访问层**：所有数据库操作集中在这里
│       │   ├── db.js                 建数据库连接实例（全项目唯一一处）
│       │   ├── bodiesRepository.js   天体表：listAll / existsById / findById
│       │   ├── sourcesRepository.js  来源表：urlMap
│       │   └── observationsRepository.js  观测记录表：insert
│       ├── package.json
│       └── node_modules/   （不上传，见 .gitignore）
│
├── db/                     数据库（PostgreSQL，Day 16）
│   ├── schema.sql          建表 + 约束 + 字段注释
│   ├── seed.sql            种子数据（自包含，可重复执行）
│   └── gen-seed.mjs        生成 seed.sql 的工具（实跑 bodies.js 取值）
│
├── vendor/
│   └── three.min.js        Three.js r128（本地文件，不从 CDN 引）
│
├── tests/                 可执行自检脚本
│   ├── security-scan.sh   密钥与忽略规则自查（6 项，Day 23）
│   └── observations-repo-smoke.cjs  观测记录数据访问层冒烟测试（Day 19）
│
├── .workbuddy/
│   └── skills/            检查 Skill（项目产物，随代码一起提交）
│       ├── catalog-filter-guard/  筛选交互的检查（Day 12）
│       └── verify-project/        发布前检查 13 项（Day 25）
│
└── assets/
    ├── flow-data.svg       数据流图
    ├── layers-api.svg      后端分层结构图（Day 19）
    └── evidence/           交付证据图（Day 28）：移动端截图 + 公网读写证据，见其 INDEX.md
```

> **后端为什么分两个目录**（Day 19 重构）：
> `index.js` **不认识数据库** —— 它只做「把 HTTP 请求翻译成普通变量 → 调用 repository → 把结果整形成接口字段 → 包上信封返回」。
> 所有知道表名和列名的代码都在 `repositories/` 里。
> 判据是一句话：**这段代码知不知道数据库的表名和列名？** 知道 → 数据访问层；不知道、只认接口字段 → 接口层。
> 好处很实在：换一张表、加一个字段，只动 `repositories/` 里那一个文件，接口逻辑一行都不用碰。

---

## 数据来源

**本项目禁止虚构数据。** 每一个数值都写明出处，记在 `src/data/bodies.js` 里。

| 用途 | 来源 |
|---|---|
| 主数据源（八大行星 + 月球部分字段） | [NASA Planetary Fact Sheet (Metric)](https://nssdc.gsfc.nasa.gov/planetary/factsheet/) |
| 「与地球对比」 | [Planetary Fact Sheet – Values compared to Earth](https://nssdc.gsfc.nasa.gov/planetary/factsheet/planet_table_ratio.html) |
| 太阳 | [NASA Sun Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/sunfact.html) |
| 月球 | [NASA Moon Fact Sheet](https://nssdc.gsfc.nasa.gov/planetary/factsheet/moonfact.html) |
| 哈雷彗星 | [NASA/JPL Small-Body Database (SBDB) API](https://ssd-api.jpl.nasa.gov/sbdb.api?sstr=1P) |

> **哈雷彗星不在 Planetary Fact Sheet 的覆盖范围内**，所以单独指定了 JPL 的来源。

**其他说明**：

- 天体外观（颜色、条纹、地表斑块）是**程序生成的示意图案，不是真实影像**。
  本项目不做"大型真实纹理贴图包"（见 PRD 第 7 节）。
- 轨道的**初始位置是示意值**，不代表某一天的真实星象——本项目不引入实时星历。
- 比例方面：默认的「图示比例」把各轨道拉开了；切到「真实比例」看到的内行星挤成一团，
  才是太阳系实际的样子。

---

## 发布前检查（要交作业、要发链接之前跑一遍）

改完代码之后，跑一遍这个再发出去。它检查的**不是「功能还能不能用」**，
而是**「你要交出去的，是不是你想交的那一份」**——这两件事不一样：

| 这类毛病 | 为什么传统检查抓不到 |
|---|---|
| 代码改好了，**公网还是旧的**（忘了重新发布静态托管） | 本地怎么点都对，一发链接就穿帮 |
| 发布副本**过时**了（忘了重新生成那一份） | 副本是发布源，本地看不出区别 |
| 云端错误码是 `DATABASE_23505`（带前缀），代码里写全等 `=== '23505'` | **本地全绿、线上静默失效** |
| `hidden` 属性设了，但 CSS 的 `display: flex` 把它盖掉 | 属性是对的，元素却关不掉 |

**它们全都不报错。** 所以只能逐条主动去查。

### 怎么跑

第 1–10 项（不需要浏览器），在项目目录下：

```bash
bash .workbuddy/skills/verify-project/scripts/verify.sh
```

第 11–13 项要开浏览器。先**另开一个终端**起本地服务（这个窗口别关）。
端口用 **8081**——就是「方式二」里 8080 被占用时换到的那个：

```bash
python -m http.server 8081 --bind 127.0.0.1
```

再回到原来的终端：

```bash
node .workbuddy/skills/verify-project/scripts/verify-ui.mjs
```

> `--bind 127.0.0.1` 不要省——不加的话，同一 Wi-Fi 下别人能打开这个网页，
> 看到你电脑上的**文件清单**（原因见上面「方式二」第 2 条）。
>
> 网络不通、或者本地服务没起，相关几项会记成「未执行」，**不会**记成通过。

### 检查了什么（13 项）

| 组 | 项目 |
|---|---|
| 密钥与洁净 | ① 密钥扫描 ② 发布副本洁净 ③ 无调试残留 / 无写死路径 / 无伪块注释 |
| 发布一致性 | ④ 白名单 + 目录登记 ⑤ 副本 = 仓库 ⑥ **公网 = 副本** |
| 接口与云 | ⑦ 跨域白名单 ⑧ 接口契约 + 错误分支 ⑨ **唯一冲突码用「包含」判** ⑩ 环境变量没内联 |
| 前端易回归 | ⑪ 遮罩 alpha = 1 ⑫ **`hidden` 真的隐藏** ⑬ 控制台 0 报错 |

其中 **⑤ 和 ⑥ 是故意拆成两条的**：⑤ 查「副本跟不跟得上代码」，
⑥ 查「公网跟不跟得上副本」。分开写是为了**一眼看出断在哪一环**——
⑤ 红 = 忘了生成副本；⑥ 红 = 忘了发布。

### 结果怎么读

只有三种状态，没有第四种：

- **PASS** —— 有实测值支撑
- **FAIL** —— 有实测值证明它不成立
- **未执行** —— 测不了（网络不通 / 服务没起 / 检查本轮为空）

> **「未执行」不等于「通过」。「没有 FAIL」也不等于「全做完了」。**
> 汇总那行要把 PASS / FAIL / 未执行三个数都念出来。

### 怎么证明它不会「假绿」

**全绿有两种可能**：① 东西真的是好的；② 判据是空的，根本查不出坏东西。
光看全绿分不出这两种。区分办法只有一个——**故意把 Bug 放回去，看它会不会变红**：

```bash
# 看现在处于哪种状态（干净时应全绿）
bash .workbuddy/skills/verify-project/scripts/mutation-test.sh status

# 植入「改代码但没发布」，然后跑检查 —— ⑥ 应当变红，⑤ 应当仍是绿的
bash .workbuddy/skills/verify-project/scripts/mutation-test.sh plant-6
bash .workbuddy/skills/verify-project/scripts/verify.sh

# 撤销（自动还原 + 回读核对 md5，并让 git status 自证干净）
bash .workbuddy/skills/verify-project/scripts/mutation-test.sh undo
```

可植入三种：`plant-4b`（副本夹带文件）、`plant-6`（改代码不发布）、
`plant-hidden`（去掉 `[hidden]` 兜底——就是「编辑区点了取消还关不掉」那个坑的重现）。

每一项的判据、出处和当初是怎么发现这个坑的，见
[`.workbuddy/skills/verify-project/SKILL.md`](.workbuddy/skills/verify-project/SKILL.md)。

---

## 相关文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 项目规则——人机协作怎么分工、怎么验收 |
| `research.md` | 需求研究：同类产品实证核实、本期边界 |
| `PRD.md` | 产品需求文档：功能清单、优先级、验收标准 V1–V10 |
| `TECH_DESIGN.md` | 技术设计：技术路线与取舍、项目结构、数据流、错误处理 |
| `api-contract.md` | 接口契约：响应信封、字段、错误码——接口形状的唯一依据 |
| `USER_TEST.md` | 真机测试记录：多设备实测的任务卡与结果 |
| `WEEK3_ACCEPTANCE.md` | 第 3 周验收表、同伴交叉验证记录、演示提纲 |
| `SECURITY-AUDIT.md` | 安全自查：扫描范围、6 项结论、已知风险与待办 |
| `CORE_FLOW_TEST.md` | 核心流程测试清单：检查台「读 → 写 → 刷新确认 → 改 → 删」完整链路，含三态判定纪律与回归记录表 |
| `.workbuddy/skills/verify-project/SKILL.md` | 发布前检查 Skill：13 项可执行检查与判据 |
| `RELEASE_v1.0.md` | 发布清单：版本标记、发布前验证项、发布步骤、发布后验证、代码与数据备份方式 |
| `ROLLBACK.md` | 回滚手册：触发条件、静态托管与云函数各自的回退步骤、回滚后验证、演练记录 |
| `TRIAL_TASK.md` | 第三方试用：给外行的任务卡（只说"做什么"，不说为什么）、记录表模板、4 处预埋点登记、组织者纪律、修复归档（排序 / 修复提示词 / 复验最小任务） |
| `RESOURCE_STATUS.md` | 资源与到期说明：当前用量、到期时间、导出数据的检查步骤（含"零密钥导出"与填表/结论模板） |
| `FINAL_ACCEPTANCE.md` | 最终验收表与项目映射表：附录 J 100 分表逐项自查、能力底线对应表、提示词改写与复盘、结营交付清单 |
| `DEMO_SCRIPT.md` | 演示脚本：3–5 分钟录屏的提纲、六段分镜与逐句提词、录制前准备清单、录制容错与录完自查 |
