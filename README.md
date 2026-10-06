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
└── assets/
    └── flow-data.svg       数据流图
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

## 相关文档

| 文件 | 内容 |
|---|---|
| `AGENTS.md` | 项目规则——人机协作怎么分工、怎么验收 |
| `research.md` | 需求研究：同类产品实证核实、本期边界 |
| `PRD.md` | 产品需求文档：功能清单、优先级、验收标准 V1–V10 |
| `TECH_DESIGN.md` | 技术设计：技术路线与取舍、项目结构、数据流、错误处理 |
