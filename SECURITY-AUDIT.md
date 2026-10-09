# SECURITY-AUDIT.md —— 安全自查清单

> **创建**：Day 23（2026-10-09）第 4 周
> **范围**（清单指定的四块）：① 硬编码密钥　② 裸报错　③ 非法输入　④ `.gitignore` 完整性
> **每条都写四件事**：查什么 · 为什么 · **怎么验证（可复制命令）** · 本次结果
>
> ⚠️ 这份清单的写法有一条硬规矩：**结论必须由命令产出，不能凭印象**。
> 理由见 `MEMORY-lessons.md` 第 31 条 —— 同一天里，"检查本身写错了却报成代码有问题"犯了两次。

---

## 0. 一键复跑

```bash
cd /d/AI部_学习打卡/VibeCoding
bash tests/security-scan.sh
```

- 退出码 `0` = 全部通过；`1` = 有未通过项。
- 它会自动跑下面「一」和「四」里的 **6 项**（密钥特征词 / 凭据文件 / 忽略规则 / 历史文件 / 历史内容 / 配置内联）。
- **"二 裸报错"和"三 非法输入"不在脚本里** —— 它们要浏览器，见各自小节的手工验证方法。

### 本次结果（2026-10-09 实测）

```
结果：6 项通过 ／ 0 项未通过     退出码 = 0
```

---

## 1. 结论摘要

| # | 检查项 | 结果 | 靠什么判 |
|---|---|---|---|
| K1 | 工作区里有没有像密钥的字符串 | ✅ PASS | `security-scan.sh` 检查 1 · 命中 0 |
| K2 | 有没有真实凭据文件（`.env` / `*.pem` / `*.key`） | ✅ PASS | 检查 2 · 发现 0 |
| K3 | 忽略规则有没有真的挡住 / 有没有误挡模板 | ✅ PASS | 检查 3 · 5 挡 + 2 放行 |
| K4 | Git 历史里有没有提交过凭据文件 | ✅ PASS | 检查 4 · 31 条提交里 0 |
| K5 | Git 历史 diff 里有没有密钥特征词 | ✅ PASS | 检查 5 · 18162 行里 0 |
| K6 | 配置里有没有内联凭据 / 代码有没有写死密钥 | ✅ PASS | 检查 6 · 仅 1 处 `process.env` |
| E1 | 未捕获 JS 异常显示人话 | ✅ PASS | 见 二·E1 |
| E2 | 3D 加载失败显示人话 | ✅ PASS | 见 二·E2 |
| E3 | 接口失败显示人话（三类错误） | ✅ PASS | 见 二·E3（14 条断言） |
| V1 | 非法输入有没有被挡在接口层 | ✅ PASS | 见 三 |
| **R1** | **那把 `service_role` 密钥要不要作废重发** | 🔴 **未执行** | **等你决定，见 五** |

⭐ **「无 FAIL」≠「全做完」**：R1 是**未执行**，不是通过 —— 它单列在第五节。

---

## 2. 一、硬编码密钥

### K1 · 工作区里有没有像密钥的字符串

**为什么**：密钥一旦进了仓库，就等于公开了 —— 仓库可能被 clone、被 fork、被当作素材抓取。

**怎么验证**

```bash
cd /d/AI部_学习打卡/VibeCoding

PAT='eyJ[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKID[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}|gh[opsu]_[A-Za-z0-9]{20,}'

git ls-files -co --exclude-standard \
  | grep -vE '^\.workbuddy|package-lock\.json' \
  | xargs -r grep -nEI "$PAT"
```

**期望**：**没有任何输出**（退出码 123 —— 别用退出码判断，看有没有输出，见第八节）。

六条规则分别抓：JWT（`eyJ` 开头）· PEM 私钥头 · 腾讯云 AKID · OpenAI 风格 `sk-` · GitHub token ·（`security-scan.sh` 里还多一条弱规则）。

**本次结果**：✅ 命中 0 条。

### K2 · 有没有真实凭据文件

```bash
find . -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) \
  -not -path './node_modules/*' -not -path '*/node_modules/*' \
  | grep -vEi 'example|sample|template'
```

**期望**：无输出。（`find` 与 `grep` 的组合由脚本检查 2 执行。）

**本次结果**：✅ 发现 0 个。

⚠️ **实测教训**：Day 23 第 3 步为验证忽略规则，用 `cp .env.example .env` 造过一个真 `.env` —— 当时这一项**立刻报了"未通过"**。⇒ **这项检查不是装饰**，它真的会在你留下残留时响。（顺手也证明了：**"造一个真凭据 → 看检查响不响 → 删掉"** 比读代码有说服力。跑完 `rm -f .env` 即恢复。）

### K3 · 忽略规则有没有真的生效

**为什么**：`.gitignore` 是**文本**，写对了不等于生效了（写错路径、模式冲突、父目录排除都会让它静默失效）。

**怎么验证**（`git check-ignore` 是**实测**，不看注释）

```bash
cd /d/AI部_学习打卡/VibeCoding

# ① 这 5 个必须被挡住 —— 期望输出 5 行，每行告诉你"被哪条规则挡的"
git check-ignore -v -- .env .env.local .env.production.local server.pem private.key

# ② 这 2 个必须没被挡（模板要能提交）—— 期望 无输出、退出码 1
git check-ignore -v -- .env.example .env.sample
```

**本次结果**：✅

```
.gitignore:8:.env	.env
.gitignore:18:.env.local	.env.local
.gitignore:19:.env.*.local	.env.production.local
.gitignore:27:*.pem	server.pem
.gitignore:28:*.key	private.key
（② 无输出，退出码 1 = 没被挡 = 能提交）
```

⭐ **② 反向那条同样重要**：只验"该挡的挡住了"，很容易写出一个把 `.env.example` 也一起挡掉的通配（如 `.env*`）—— 那会让**团队里没人拿得到模板**。这就是 `.gitignore` 里刻意一条条列、不用 `.env*` 的原因（文件里写了这条理由）。

### K4 · Git 历史里有没有提交过凭据文件

**为什么**："现在删掉了"不等于"历史里没有" —— 历史里的那一份**照样能翻出来**。所以必须**挡在进门之前**，而不是事后清理。

**怎么验证**

```bash
cd /d/AI部_学习打卡/VibeCoding
git log --all --diff-filter=A --name-only --pretty=format: \
  | grep -E '(^|/)\.env($|\.)|\.pem$|\.key$'
```

**期望**：无输出（`grep` 退出码 1）。

**本次结果**：✅ 无输出。历史提交数 **31**（含已删除的文件，`--all` 覆盖所有分支）。

### K5 · Git 历史 diff 里有没有密钥特征词

```bash
cd /d/AI部_学习打卡/VibeCoding
bash tests/security-scan.sh        # 检查 5 就是这一项
```

**本次结果**：✅ 扫描全部历史 diff **18162 行**，命中 **0 条**。

⚠️ **这一项我自己先写错过一次，值得记下来**：弱规则"连续 32 位以上十六进制"直接扫 `git log -p` ⇒ **命中 31 条，正好等于 31 条提交** —— 每条提交的 `commit <40 位 SHA>` 都被算成了疑似密钥。**滤掉 git 元数据行（`commit ` / `index ` / `diff --git` / `@@` …）后 = 0**。脚本里已就地写了这条注释。

### K6 · 配置内联 / 代码写死

```bash
cd /d/AI部_学习打卡/VibeCoding

# ① 云函数的 envVariables 必须都是空的 {} —— 期望 2 行，都是 {}
grep -n 'envVariables' cloudbaserc.json

# ② 本项目**自己的**代码里读环境变量的地方 —— 期望只有 1 行
grep -rn 'process\.env' \
  cloudfunctions/api/index.js cloudfunctions/api/repositories/ \
  cloudfunctions/health/index.js db/ src/
```

**本次结果**：✅

```
12:      "envVariables": {}
20:      "envVariables": {}

cloudfunctions/api/repositories/db.js:47:const API_KEY = process.env.CLOUDBASE_APIKEY;
```

⭐ **密钥"住"在哪 —— 三条铁律**（与 `.env.example` 里的说明一致）：

1. 真值只放两个地方：**本地 `.env`** 和 **云平台控制台**。**哪个都不进 Git。**
2. 仓库里只放 `.env.example`，**永不放真值**。
3. 🔴 **这个项目的密钥不是从 `.env` 读的** —— 云函数跑在腾讯云上，环境变量由**控制台注入**（函数配置 → 环境配置 → 「API Key 设置」开关）。在仓库里放 `.env` **不会**让线上生效。

⚠️ **别被 `grep -rn 'process.env'` 的"满屏命中"骗**：不加路径限定直接 `grep -r .`，会命中 `cloudfunctions/api/node_modules/` 里上百处第三方代码 —— 那是依赖，**已 gitignore、不上仓库**。所以上面②的命令**逐个写了目录**，不写 `.`。

---

## 3. 二、裸报错（把技术原文直接印给用户看）

**判据一句话**：**面向用户的区域说人话；技术细节一条不丢，改成进浏览器控制台**。
**检查台（`#/status`）是例外但也是同一原则** —— 它是**排查工具**，所以技术细节**保留但分层**：第一行给人看，括号里给排查的人看。

### E1 · 未捕获的 JS 异常 → `src/fallback.js`

| | |
|---|---|
| **改前** | `页面遇到一个问题：` + **`Cannot read properties of null (reading 'focus')`** + `（其他内容仍可使用）` |
| **改后** | `页面有一小块没能正常工作，其他内容仍可照常使用。（技术细节已记在浏览器控制台）`<br>+ 新增 `console.error('[fallback] …', ev.filename:lineno, ev.error)` |

**怎么验证**（浏览器里，30 秒）

1. 打开页面 → `F12` → Console
2. 粘贴并回车：`setTimeout(function () { null.x; }, 0);`
3. **期望**：页面顶部出现横幅，写的是**人话**（不含 `Cannot read` 这类字）
4. 同一时刻 Console 里应有一条 `[fallback] 未捕获的页面错误：…`

⚠️ 中文界面的控制台有**粘贴门**，要输入提示里引号内那句（「**允许粘贴**」），**不是** `allow pasting` —— 打错会报 `Unexpected identifier 'pasting'`。

### E2 · 3D 特写加载失败 → `src/focus3d.js`

| | |
|---|---|
| **改前** | `3D 特写没能加载（` + **`err.message` 原文** + `）。2D 主图和资料卡仍可正常使用。` |
| **改后** | `3D 特写这次没打开，2D 主图和资料卡照常用。（技术细节已记在浏览器控制台）`<br>+ 新增 `console.error('[focus3d] …')` |

**怎么验证**

1. `F12` → **Network** 面板 → 刷新页面 → 找到 `three.min.js` → 右键 → **Block request URL**
2. 回到页面 → 点任意一颗行星（触发 3D 特写）
3. **期望**：横幅说人话；**2D 主图和资料卡照常可用**（这是 TECH_DESIGN 第 6 节"局部失败不白屏"的承诺）
4. 🔴 **测完务必右键 → Unblock** —— DevTools 的「请求阻止」开关**会骗人**：它开着的时候页面看着基本正常，但某一块已经废掉了（见 `MEMORY-lessons.md` 第 28 条）。

### E3 · 接口失败 → `src/status.js`（检查台 4 张卡）

**"三类错误"其实不在同一层** —— 这是验收时第一件要搞清的事：

| 清单里的名字 | 真实来源 | 怎么造出来 |
|---|---|---|
| **输入错** | 后端 `BAD_REQUEST` | `?id=` 空值 · `?limit=abc` · PATCH 坏 uuid · POST 缺必填 · **卡片③ 提交一条库里已有的记录** |
| **网络错** | **前端** `NETWORK` / `TIMEOUT`（**后端从不产出这两个码**） | `?api=http://127.0.0.1:8099`（没人监听的端口） |
| **服务端错** | 后端 `INTERNAL` | 🔴 **真环境造不出来** —— 见下 |

**为什么 `INTERNAL` 造不出来（这是设计，不是缺陷）**：`cloudfunctions/api/index.js` 里**每条已知路径都各自降级**成了 `BAD_REQUEST` / `NOT_FOUND` —— 代码注释的原话是"把'你写错了'说成'服务器坏了'是错的"。只有入口那一处 `catch` 才会产出 `INTERNAL`。

**怎么验证**

```bash
# ① 接口层：8 条探针，全部应回**中文** message（HTTP 一律 200，看信封 ok 不看状态码）
#    API 变量 = src/api.js 第 27 行的 API_BASE（原样抄下来，别手打）
API='https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com'
curl -s "$API/api/bodies?id="            # BAD_REQUEST 详情接口需要给出 id，但传了空值。
curl -s "$API/api/bodies?limit=abc"      # BAD_REQUEST limit 必须是大于 0 的整数。
curl -s "$API/api/bodies?id=notaplanet"  # NOT_FOUND   没有找到「notaplanet」这个天体。
curl -s "$API/api/observations"          # 列表
```

```bash
# ② 页面层：本地起服务，用 ?api= 造网络错
cd /d/AI部_学习打卡/VibeCoding
python -m http.server 8081 --bind 127.0.0.1        # 另开一个终端；测完 Ctrl+C
```

浏览器打开：`http://127.0.0.1:8081/?api=http://127.0.0.1:8099#/status`

**期望**（卡片①②④ 共用同一套文案，所以三张卡一起变）：

```
❌ 读取数据库没成功。和服务器没连上（断网、地址不对，或者被拦住了）。
（技术细节：HTTP 没拿到 ／ Failed to fetch ／ 请求阶段就失败了（断网 / 地址不对 / 被拦截））
```

⭐ **判据是"分层"，不是"删掉"**：英文原文**不许出现在第一行**，但**必须还在括号里**。

**本次结果**：✅ 页面层 **14 条断言全过 / 0 未过**（无头 Chrome 390×844 @2x，真的点、真的提交）：

| 场景 | 屏幕上实际渲染的 |
|---|---|
| 正常态（回归） | `✅ 读到 11 条（total = 11） ／ HTTP 200` |
| 输入错 | `❌ 这条没写进去。这次请求的内容服务器不接受（参数缺了或者格式不对）。` + `（技术细节：错误码 BAD_REQUEST ／ HTTP 200 ／ 说明 …）` |
| 网络错 | `❌ 读取数据库没成功。和服务器没连上（…）。` + `（技术细节：HTTP 没拿到 ／ Failed to fetch ／ …）` |
| 服务端错 | `❌ 读取数据库没成功。服务器自己出错了，不是你的操作问题。` + `（技术细节：HTTP 200 ／ 服务暂时不可用，请稍后再试。 ／ 信封 {ok,data,error}）` |

⚠️ **"服务端错"那一格的诚实边界**：真环境造不出 `INTERNAL`，所以那一行是拿一个**逐字节复刻 `index.js` 的 `errInternal()` 输出**的本地假后端验的。
✅ 它证明 **渲染链路对**（拿到这个信封时页面显示的中文是对的）　❌ 它**不**证明 **真实异常会产出这个信封**（那只能靠读代码论证）。

```bash
# 不想跑则退出码：脚本在 tmp 目录，未入库
# C:\Users\33198\.workbuddy\tmp\day23\status-errors.mjs  +  mock-internal.mjs
```

---

## 4. 三、非法输入

**已经有的（Day 17/18/22 建的，本次复核 ✅）**

| 防线 | 位置 | 挡什么 |
|---|---|---|
| **接口层** | `cloudfunctions/api/index.js` | `?id=` 三态、`limit` 正则、`uuid` 形状、请求体逐字段校验（JSON 对象 → 缺必填 → 日期真实性 → 状态取值 → note 类型/长度 → bodyId 存在性） |
| **仓库层** | `repositories/observationsRepository.js` | 空 id **无条件拒绝**（否则不带条件的 DELETE 会清空整张表） |
| **前端** | `src/status.js` `removeRecord()` | 删除前**二次确认**（防手滑） |

⭐ 三处拦的是**三种不同来源**的错误（调用方的 bug / 用户的输入 / 人的手滑）—— 所以**缺一不可**，不能因为"接口层已经校验了"就省掉前端那个框。

**怎么验证**

```bash
#    API = src/api.js 第 27 行的 API_BASE（原样抄，别手打）
API='https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com'

# 全都应回 ok:false + 中文 message（HTTP 却是 200 —— 这是平台的形状，别按状态码判断）
curl -s "$API/api/bodies?id="
curl -s "$API/api/bodies?limit=0"
curl -s "$API/api/bodies?limit=abc"
curl -s -X PUT "$API/api/bodies"                                   # 不支持的方法
curl -s -X POST -H 'Content-Type: application/json' \
     -d '{"bodyId":"mars"}' "$API/api/observations"                # 缺必填
curl -s -X PATCH -H 'Content-Type: application/json' \
     -d '{"status":"observed"}' "$API/api/observations?id=abc"     # 坏 uuid
curl -s -X DELETE "$API/api/observations?id=00000000-0000-0000-0000-000000000000"   # 格式对但不存在
```

**本次结果**：✅ 8/8 全部回**中文** message，且**全部 HTTP 200**（再次印证：**判断成败只能看信封 `ok`**）。

⭐ **"防重复"是输入校验的一部分**：同一天同一颗星只能记一条，靠的是数据库唯一约束 `uq_observations_body_date`，应用层只负责把 SQLSTATE `23505` **翻译**成中文。验证方法：卡片③ 用**已经存在的** `(天体, 日期)` 提交一次 ⇒ 应被拒，且**库里不会有任何变化**（无副作用，实测 `total` 仍为 1）。

---

## 5. 四、`.gitignore` 完整性

见 K3（实测忽略规则）。补充三条**容易被漏掉**的：

| 项 | 现状 | 说明 |
|---|---|---|
| `.env` | ✅ 挡住（`.gitignore:8`） | 清单要求项，Day 16 就预置了 |
| `.env.local` / `.env.*.local` | ✅ 挡住（`:18` / `:19`） | Day 23 补齐 |
| `*.pem` / `*.key` | ✅ 挡住（`:27` / `:28`） | Day 23 补齐。危险在"一旦被某次 `git add .` 顺手带上，就**永久留在历史里**" |
| `.env.example` / `.env.sample` | ✅ **没被挡**（能提交） | 刻意：模板必须进仓库 |

⚠️ 刻意**不用** `.env*` 通配 —— 它会连 `.env.example` 一起挡掉。宁可多写两行。

---

## 6. 五、🔴 R1 · 密钥轮换 —— **未执行，等你决定**

**这是本次唯一没有闭环的一项，单列出来。**

**现状**：本次全部扫描**没发现任何泄漏迹象** —— 工作区 0 命中（K1）· 历史 31 条提交 0 命中（K4/K5）· 代码里只有 1 处 `process.env` 读取（K6）。

**那为什么还列出来**：

1. 云函数连库用的是 **`service_role`** 身份的 API Key —— 它能**读写整张库**；库坏了 / 被写了脏数据是不可逆的。
2. 关键判断不在代码里，而在**你看不到的地方**：那把 Key **有没有出现在终端、聊天记录、截图、别人电脑上**。**代码扫描看不到这些。**
3. 🔴 **"代码里没写" ≠ "没泄漏"** —— 这正是 `.env.example` 第 20 行那句的意思：*密钥一旦出过门，删代码是追不回来的*。

**怎么验证 / 决定**（控制台，约 3 分钟）

1. 打开 控制台 → 函数管理 → `api` → **函数配置 → 环境配置 → 「API Key 设置」**
2. 看那个开关是不是**开**着、以及 Key 的**编号**（`CLOUDBASE_APIKEY_ID`）
3. 回忆这把 Key 从创建到现在，**有没有在别处露过面**（终端回显、聊天、截图、共享屏幕）
4. 拿不准 ⇒ **按"露过"处理**（轮换的代价远小于库被写坏）

**如果决定轮换（4 步，顺序不能换）**

| 步 | 做什么 | 为什么是这个顺序 |
|---|---|---|
| ① | **先作废**旧 Key | 作废是**立刻生效**的止损；先建新的等于旧的风险还在 |
| ② | 重新生成一把 | |
| ③ | **成对更新**环境变量（Key + Key ID） | ⚠️ 只换一个会写成**半截状态**，另一项反而可能被清掉 |
| ④ | 重新部署云函数 | 环境变量变了要重新部署才生效 |

⭐ **顺序为什么是"先作废、再清理代码"**：清理代码只是止血后的包扎。密钥**一旦出过门**，它就已经在别人手里了 —— 删代码的下一秒，那把 Key 照样能用。**先让它失效，再谈清理。**

---

## 7. 六、这份清单**不覆盖**什么（诚实边界）

- ❌ **不覆盖"密钥有没有在非代码渠道泄漏"** —— 终端 / 聊天 / 截图 / 别人电脑，扫描看不到。这就是 R1 必须由**人**判断的原因。
- ❌ **不覆盖平台侧的访问控制**：云函数权限、数据库 RLS / 角色、控制台账号安全（如是否开了二次验证）。
- ❌ **不覆盖依赖漏洞**：`cloudfunctions/api/node_modules/` 里第三方包的 CVE 未扫（本次没装审计工具）。
- ❌ **不覆盖"业务逻辑安全"**：比如"谁能调用这个接口"—— 当前**没有任何鉴权**，`POST / PATCH / DELETE` 只要知道地址就能调。这是**已知的、被接受的**教学项目现状，不是遗漏。
- ❌ **`INTERNAL` 只验了渲染，没验"真异常会产出它"**（理由见 二·E3）。

---

## 8. 七、两条"会骗人"的注意（扫描范围）

### ① 扫描范围要用 `git ls-files`，**别用 `grep -r .`**

`grep -r .` 会命中两类**根本不上仓库**的文件，制造大量假命中：

| 目录 | 实测命中（六条规则 / 弱规则） | 为什么不参与 |
|---|---|---|
| `cloudfunctions/api/node_modules/` | **151** 个文件 | 第三方依赖，`.gitignore` 已挡，谁 `npm install` 都能得到一份 |
| `.workbuddy/` | 强规则 0 / **弱规则 11** 个文件 | AI 的工作记忆目录，`.gitignore` 已挡，里面是**讨论密钥的文档文字** |

⭐ **正确范围只有一处**：`git ls-files -co --exclude-standard` = 「已追踪的 + 未追踪但**没被忽略**的」= **真的会上仓库的那批**。

### ② 别用退出码判断"有没有命中"

上面那条 `git ls-files … | xargs -r grep …`，**没有命中时退出码是 `123`**（xargs 的批次语义），不是 `1`。
⇒ **看有没有输出，别读退出码。**（`security-scan.sh` 里已经把这条拍平成了可读的"命中 N 条"。）

---

## 9. 相关文档

- `.env.example` —— 环境变量模板 + 三条铁律
- `tests/security-scan.sh` —— 本节「一」「四」6 项的自动实现
- `api-contract.md` —— 接口契约（错误码 `BAD_REQUEST` / `NOT_FOUND` / `INTERNAL` 的定义）
- `WEEK3_ACCEPTANCE.md` —— 第 3 周验收存档
