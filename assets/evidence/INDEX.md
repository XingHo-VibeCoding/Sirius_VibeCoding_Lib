# 交付证据索引

> 这一目录是**给验收看的图**，不是代码的一部分。全部由脚本自动拍摄，可一键重跑。
> ⚠️ 截图只是"那一刻的现象"；**关键数值**同时写进了本文档与 `crud/run-summary.json`，两者可互相核对。

## 怎么重跑

| 批次 | 脚本 | 命令 |
|---|---|---|
| `mobile/`（前三行） | `cdp-shot2.mjs` | `node cdp-shot2.mjs "http://127.0.0.1:8081/#/explore" <本目录>/mobile 390 844 mobile explore` |
| `mobile/body-saturn-3d-*` | `cdp-3d.mjs` | `node cdp-3d.mjs "http://127.0.0.1:8081/#/body/saturn" <本目录>/mobile 390 844 mobile body-saturn-3d` |
| `crud/` | `public-crud-evidence.mjs` | `node public-crud-evidence.mjs`（⚠️ 会**真写公网数据库**，跑完自动删干净、精确回到跑前条数） |

- 前两个脚本在 `C:\Users\<你>\.workbuddy\tmp\solar-qa\`（Day 7 / Day 13 的产物）；`public-crud-evidence.mjs` 在 `…\tmp\day28-evidence\`。
- ⚠️ **拍 `mobile/` 前必须先起本地静态服务**：`python -m http.server 8081 --bind 127.0.0.1`（**8080 通常被占**）。
- ⚠️ 为什么 `mobile/` 走**本地**而不是公网：移动端截图要证明的是**响应式与交互**，与部署在哪无关；且公网有平台"风险提醒"中间页会吃掉 query、改写 hash。**"公网地址"这个证据由真机截图承担**。

## `mobile/` —— 移动端 390×844 @2x

| 文件 | 拍的是什么 | 支撑附录 J 哪一项 |
|---|---|---|
| `explore-viewport.png` / `explore-full.png` | 探索视图：2D 主图 + 时间流速 / 轨道比例 两组调控 | 前端页面与交互 |
| `catalog-viewport.png` / `catalog-full.png` | 图鉴：11 张卡片 + 类型 5 按钮 + 搜索框 | 前端页面与交互 |
| `body-saturn-viewport.png` / `body-saturn-full.png` | 详情视图：土星资料卡（直径 **120,536 km** ／ 公转 **29.4 年** ／ 相对地球 **9.45 倍**） | 前端页面与交互 |
| `body-saturn-3d-saturn.png` | **3D 特写**：带环土星，可拖动旋转 | 前端页面与交互 |
| `body-saturn-3d-sun.png` | 3D 特写（另一个天体，证明不只土星能开） | 前端页面与交互 |
| `body-saturn-3d-fallback.png` | **故意挡掉 `three.min.js`** 后：给出可读提示、资料卡照常、**不白屏** | Skill 与测试（故意失败） |
| `status-viewport.png` / `status-full.png` | 检查台首屏：`✅ 服务在跑` ／ `✅ 读到 11 条（total = 11）` | 云函数与 API |
| `explore-error-viewport.png` / `explore-error-full.png` | **接口失败态**：底部兜底提示条出现、2D 主图照常渲染、页脚「检查台」入口**未被遮住** | 前端页面与交互（反馈状态） |

**拍摄时量到的数**（不是估计）：五组**横向溢出全部 0 px**、无越界元素；`cdp-3d.mjs` 的 3D 移动端验收 **26 通过 / 0 失败**（含拖动 rotY 变化 4.17、滚轮缩放 1→0.935、Esc 可关、第二次打开仅 15 ms、六个天体全部能开）。

## `crud/` —— 公网「读 → 写 → **真刷新** → 改 → 删」

| 文件 | 拍的是什么 |
|---|---|
| `01-patch-after.png` | PATCH 后：`#edit-line` 里「改之前」与「改之后」并排对照 |
| `01b-after-reload.png` | ⭐ **真 `Page.reload()` 之后**：那条仍在列表里、显示的是改后的值 ⇒ **持久化的直接证据** |
| `02-delete-after.png` | DELETE 后：`✅ 读到 0 条（total = 0）` ＋ 结果回吐了被删那一行（可核对删对了） |
| `run-summary.json` | 那一次运行：测试记录 uuid ／ 跑前条数（`baseN`）／ 断言统计（**PASS 61 · FAIL 0**）／ 三张图名单 |

- **可追溯性**：`run-summary.json` 记着那一次运行所用测试记录的 uuid，三张图里出现的应当都是它。
  ⚠️ **核对该看 json，不要靠肉眼比 uuid**（只要重跑一次 uuid 就会变）。
- ⚠️ `01b` 断言的"刷新"是**真重载文档**（`Page.reload({ignoreCache:true})`），不是点按钮重新读 —— 这是 Day 28 专门补的一步。
- ⚠️ 这三张图**只截检查台的卡片④**（脚本会把视口临时拉高再滚到卡片顶部），**不含页头** ⇒ 不受副标题文案改动影响。
- ⚠️ 图里的记录是**测试数据**（`neptune` / `2026-12-31`，备注写着"改之前·原始备注"），**不是真实观测记录**；跑完数据库精确回到跑前条数（**无副作用**）。
