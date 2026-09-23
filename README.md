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

在本项目目录下打开命令行，执行：

```bash
python -m http.server 8080
```

然后用浏览器访问 **<http://localhost:8080/>**

- 需要电脑上装有 Python 3
- **如果提示 8080 被占用，把命令里的 `8080` 换成 `8081` 再试**
- 按 `Ctrl + C` 停止服务

---

## 现在能做什么

| 功能 | 说明 |
|---|---|
| 整体视图 | 太阳 + 八大行星沿各自椭圆轨道运行，哈雷彗星那条极扁的轨道一眼可辨 |
| 资料卡 | 点任意一颗天体，弹出它的**直径 / 距日平均距离 / 公转周期 / 与地球对比**四项，每项都配一条对比条 |
| 3D 特写 | 点开后同时弹出该天体的 3D 球体，可拖动旋转、滚轮缩放 |
| 调控区 · 时间流速 | 暂停 / 实时 / 演示（默认）/ 快进 |
| 调控区 · 轨道比例 | 图示比例 ↔ 真实比例（切到真实比例，会看到内行星挤成一团） |
| 调控区 · 教学对比 | 把八颗行星的公转周期并排画成条，一眼看出水星 0.24 年、海王星 163.7 年 |

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
├── README.md               本文件
│
├── src/
│   ├── data/
│   │   └── bodies.js       全部天体数据 + 来源标注（唯一数据源）
│   ├── scene2d.js          2D 主图 + 点击 + 资料卡
│   ├── controls.js         调控区（时间流速 / 轨道比例 / 教学对比）
│   ├── focus3d.js          3D 聚焦（按需加载 Three.js）
│   └── fallback.js         错误兜底（任何一块坏掉都不白屏）
│
├── styles/
│   └── main.css            全部样式
│
├── vendor/
│   └── three.min.js        Three.js r128（本地文件，不从 CDN 引）
│
└── assets/
    └── flow-data.svg       数据流图
```

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
