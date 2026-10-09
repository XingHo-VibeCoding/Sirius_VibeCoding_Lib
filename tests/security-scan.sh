#!/usr/bin/env bash
# ============================================================
# tests/security-scan.sh —— 项目安全自查（Day 23 · 板块①）
# ============================================================
# 【怎么跑】
#   在自己的终端里（Windows 上是 Git Bash）：
#     bash tests/security-scan.sh
#   跑完看最后那行「结果：N 项通过 ／ M 项未通过」。
#   退出码：全通过 = 0；有未通过 = 1。
#
# 【为什么是 .sh 而不是 .cjs】
#   ⚠️ 已实测：本项目所在的沙箱环境里 **Node 无法创建任何子进程**
#      （spawn git / spawn cmd.exe / 连 spawn 一个**不存在**的文件都回 EBUSY，
#        而不是 ENOENT ⇒ 说明它在"创建进程"那一步就被挡了，根本没走到查文件那一步）。
#      这个脚本必须反复调 git，所以 Node 版在这里**跑不起来、也就无法被验证**。
#      ⇒ 换成纯 bash + git + grep，零子进程嵌套，哪儿都能跑。
#
# 【它检查什么】（6 项，对应清单的「密钥排查」+「忽略规则检查」）
#   1 密钥特征词 —— 工作区里有没有像密钥的字符串
#   2 凭据文件   —— 项目里有没有真实的 .env / *.pem / *.key
#   3 忽略规则   —— .gitignore 有没有挡住上面这些（用 git check-ignore 实测，不看注释）
#   4 历史文件   —— Git 历史里**曾经**出现过 .env 类文件吗（含已删除的）
#   5 历史内容   —— Git 历史里**曾经**提交过密钥特征词吗
#   6 配置内联   —— envVariables 是不是空的、代码是不是只用 process.env 读密钥
#
# 【⭐ 扫描范围的判据：不是"硬盘上有什么"，而是"什么会进仓库"】
#   git ls-files -co --exclude-standard
#     c = 已追踪的   o = 未追踪的   --exclude-standard = 跳掉 .gitignore 里的
#   ⇒ 正好等于「会被提交的文件」。
#   ⚠️ 为什么不用 grep -r / find：那会把 .workbuddy/memory/*.md 一起扫进来，
#      而那里是**讨论密钥的文档**（写着「tcb fn detail 把 eyJ… 明文打出来了」这类句子）。
#      命中的是**文字**不是密钥 ⇒ 这一项永远不为 0，也就永远证明不了任何事。
#      .workbuddy/* 本来就被 .gitignore 排除、不上仓库，不扫它才是对的。
#
# 【🔴 为什么不打印命中的原文】
#   万一日后真扫出密钥，把原文打到终端 = 又多泄漏一处。
#   （Day 18 已经踩过一次：tcb fn detail 把 CLOUDBASE_APIKEY 整串明文打进了终端。）
#   ⇒ 命中时**只报 文件 + 行号 + 处数**，原文一律不打印。
# ============================================================

set -u

# 用参数展开取脚本所在目录，再回到仓库根。
# ⚠️ 刻意不用 dirname —— 本机 bash 的 PATH 里没有 coreutils，dirname/head/ls 都调不到。
ROOT="$(cd "${BASH_SOURCE[0]%/*}/.." && pwd)"
cd "$ROOT" || exit 1

PASS=0
FAIL=0
FAILED_LIST=""

ok()  { PASS=$((PASS + 1)); printf '\n✅ 通过  %s\n' "$1"; }
bad() {
  FAIL=$((FAIL + 1))
  FAILED_LIST="$FAILED_LIST
    · $1"
  printf '\n🔴 未通过  %s\n' "$1"
}

# ---------------------------------------------------------------
# 特征词规则
#
# ⚠️ 这里写的是**值的特征**，不是"变量名"。
#    别把 CLOUDBASE_APIKEY 这种**名字**写进规则 —— 它在代码和文档里本来就该出现，
#    写进去只会让这一项永远过不了，最后只能靠"忽略某些文件"假装通过。
#
# 分强弱两组，是为了**历史扫描**（检查 5）能说清"哪条规则会被 git 自己骗到"：
#   强 = 值特征，几乎不可能误命中；
#   弱 = "连续 32 位以上十六进制"，本身是好的启发式，但会和 git 自己的 SHA 撞车。
# ---------------------------------------------------------------
PAT_STRONG='eyJ[A-Za-z0-9_-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|AKID[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}|gh[opsu]_[A-Za-z0-9]{20,}'
PAT_WEAK='\b[0-9a-f]{32,}\b'
PAT_ALL="$PAT_STRONG|$PAT_WEAK"

echo '=================================================='
echo ' 项目安全自查 · 密钥与忽略规则（Day 23）'
echo '=================================================='
echo '扫描范围：git 追踪的 + 未追踪但未被忽略的（= 真的会上仓库的那批）'
echo '⚠️ 命中时只报文件和行号，不打印原文。'

# ---------------------------------------------------------------
# 检查 1：工作区密钥特征词
# ---------------------------------------------------------------
CANDIDATE=0
FILE_COUNT=0
HITS1=0
DETAIL1=""

while IFS= read -r f; do
  [ -n "$f" ] || continue
  CANDIDATE=$((CANDIDATE + 1))
  # package-lock.json 是 npm 生成物，里面的 base64 校验和最容易造成"疑似密钥"的假命中，
  # 而它内部不可能有我们自己的密钥（内容完全由 package.json 决定）⇒ 跳过，文末让人工复核。
  case "$f" in *package-lock.json) continue ;; esac
  [ -f "$f" ] || continue
  FILE_COUNT=$((FILE_COUNT + 1))
  # -I：把二进制文件当成"没有命中"，免得把 PNG 读成乱码后产生假命中
  hits="$(grep -nE -I "$PAT_ALL" -- "$f" 2>/dev/null || true)"
  if [ -n "$hits" ]; then
    n="$(printf '%s\n' "$hits" | wc -l | tr -d ' ')"
    HITS1=$((HITS1 + n))
    DETAIL1="$DETAIL1
      · $f（$n 处，原文已略）"
  fi
done < <(git ls-files -co --exclude-standard)

printf '\n候选文件 %s 个（git 追踪 + 未忽略），实际扫描 %s 个文本文件（跳过 package-lock.json 与二进制）\n' "$CANDIDATE" "$FILE_COUNT"

if [ "$HITS1" -eq 0 ]; then
  ok "检查 1／6  密钥特征词：工作区里有没有像密钥的字符串"
  echo '      命中 0 条 —— 6 条规则全部无命中'
else
  bad "检查 1／6  密钥特征词：工作区里有没有像密钥的字符串"
  printf '      命中 %s 条：%s\n' "$HITS1" "$DETAIL1"
fi

# ---------------------------------------------------------------
# 检查 2：真实凭据文件
# ⚠️ .env.example **不算**凭据文件 —— 它是模板（只有名字和说明，没有真值），本来就该进仓库。
#    判据用最简单的：名字里带 example / sample / template 的一律放行。
# ---------------------------------------------------------------
CREDS="$(find . \
  -type d \( -name .git -o -name node_modules -o -name vendor \) -prune -o \
  -type f \( -name '.env' -o -name '.env.*' -o -name '*.pem' -o -name '*.key' \) -print 2>/dev/null \
  | sed 's|^\./||' | grep -vEi 'example|sample|template' || true)"

if [ -z "$CREDS" ]; then
  ok "检查 2／6  真实凭据文件：有没有 .env / *.pem / *.key（.env.example 是模板，放行）"
  echo '      发现 0 个 —— 项目里没有真实凭据文件'
else
  bad "检查 2／6  真实凭据文件：有没有 .env / *.pem / *.key（.env.example 是模板，放行）"
  printf '%s\n' "$CREDS" | while IFS= read -r c; do printf '      · %s\n' "$c"; done
fi

# ---------------------------------------------------------------
# 检查 3：忽略规则是否真的生效
# ⭐ 判据是 git check-ignore 的**实测结果**，不是"去 .gitignore 里找有没有那一行" ——
#    注释里写了、规则写错了（路径写错、被父规则覆盖）都会骗过"看注释"这种检查。
# ---------------------------------------------------------------
IGNORE_MISS=0
IGNORE_DETAIL=""
for p in .env .env.local .env.production.local server.pem private.key; do
  if info="$(git check-ignore -v -- "$p" 2>/dev/null)"; then
    rule="$(printf '%s' "$info" | sed 's/:.*//')"
    IGNORE_DETAIL="$IGNORE_DETAIL
      ✓ 挡住   $p   ← $rule"
  else
    IGNORE_MISS=$((IGNORE_MISS + 1))
    IGNORE_DETAIL="$IGNORE_DETAIL
      ✗ 漏掉   $p   ← 没有任何规则挡住它"
  fi
done

# ⭐ 反向检查（同样重要）：有些文件**必须不被**忽略。
#    挡住真凭据是好事，但连 .env.example 一起挡掉就是坏事 ——
#    它是模板，本来就该进仓库；被挡的后果是"加了它却提交不上去"，
#    而且 **Git 不会报任何错，只会静静地不提交** —— 最难查的一类问题。
#    ⇒ 这也是为什么 .gitignore 里刻意**没有**用一句 `.env*` 了事。
for p in .env.example .env.sample; do
  if git check-ignore -q -- "$p" 2>/dev/null; then
    IGNORE_MISS=$((IGNORE_MISS + 1))
    IGNORE_DETAIL="$IGNORE_DETAIL
      ✗ 误挡   $p   ← 它是模板、必须能进仓库，却被规则挡住了"
  else
    IGNORE_DETAIL="$IGNORE_DETAIL
      ✓ 放行   $p   ← 模板，没被挡（能正常提交）"
  fi
done

if [ "$IGNORE_MISS" -eq 0 ]; then
  ok "检查 3／6  忽略规则：凭据文件挡没挡住、模板文件误没误挡（实测，不看注释）"
else
  bad "检查 3／6  忽略规则：凭据文件挡没挡住、模板文件误没误挡（实测，不看注释）"
fi
printf '%s\n' "$IGNORE_DETAIL"

# ---------------------------------------------------------------
# 检查 4：历史里出现过 .env 类文件吗
# ---------------------------------------------------------------
COMMITS="$(git rev-list --all --count)"
HIST_FILES="$(git log --all --diff-filter=A --name-only --pretty=format: \
  | grep -v '^$' | sort -u \
  | grep -Ei '(^|/)\.env|\.pem$|\.key$' | grep -vEi 'example|sample|template' || true)"

if [ -z "$HIST_FILES" ]; then
  ok "检查 4／6  Git 历史：曾经提交过 .env 类文件吗（含后来被删掉的）"
  printf '      历史提交数：%s，发现 0 个 —— 历史上从未出现过\n' "$COMMITS"
else
  bad "检查 4／6  Git 历史：曾经提交过 .env 类文件吗（含后来被删掉的）"
  printf '%s\n' "$HIST_FILES" | while IFS= read -r c; do printf '      · %s\n' "$c"; done
fi

# ---------------------------------------------------------------
# 检查 5：历史里有没有密钥特征词
#
# 🔴🔴 这里**必须**滤掉 git 自己的元数据行。
#   原因：git log -p 每段开头都是 `commit <40 位十六进制>`、`index abc..def`，
#   而弱规则正是"连续 32 位以上十六进制" ⇒ 不滤的话**每条提交都算一次命中**。
#   本项目实测：不滤 = 31 条命中（正好等于 31 条提交，一条不多一条不少）；
#              滤掉后 = 0 条。
#   这就是"检查本身写错了，却怪代码有问题"的活样本 —— 一个假警报能把整项检查废掉。
# ---------------------------------------------------------------
META='^(commit |index |diff --git |--- |\+\+\+ |@@ |new file mode |deleted file mode |old mode |new mode |similarity index |rename |copy |Binary files )'
HIST_RAW="$(git log --all -p --no-color 2>/dev/null)"
HIST_LINES="$(printf '%s\n' "$HIST_RAW" | wc -l | tr -d ' ')"
HIT_LINES="$(printf '%s\n' "$HIST_RAW" | grep -vE "$META" | grep -cE "$PAT_ALL" | tr -d ' ' || true)"
HIT_LINES="${HIT_LINES:-0}"

if [ "$HIT_LINES" = "0" ]; then
  ok "检查 5／6  Git 历史：曾经提交过密钥特征词吗"
  printf '      已扫描全部历史 diff（%s 行），已滤掉 git 元数据行\n' "$HIST_LINES"
  echo '      命中 0 条 —— 6 条规则全部无命中'
else
  bad "检查 5／6  Git 历史：曾经提交过密钥特征词吗"
  printf '      命中 %s 行（原文已略，请用 git log -p 定位）\n' "$HIT_LINES"
fi

# ---------------------------------------------------------------
# 检查 6：配置里有没有内联凭据
# ---------------------------------------------------------------
ENVV="$(grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]*"' cloudbaserc.json 2>/dev/null | sed 's/.*"\([^"]*\)"$/\1/' | tr '\n' ' ' || true)"
# 🔴 这里踩过一次坑，留个记号：
#   第一版写的是  '"envVariables"[[:space:]]*:[[:space:]]*\{[^}]*[^[:space:]{]'
#   —— 想法是"大括号里得有个非空格非大括号的字符才算非空"。
#   但 `[^}]*` **允许匹配空**，于是下一个 `[^[:space:]{]` 就去匹配了收尾的 `}`
#   ⇒ `"envVariables": {}` 这种**空对象也被判成非空**，报了一次假警报。
#   （教训：量词能匹配空的时候，"后面那个字符"到底落在哪儿必须逐字符推一遍。
#    这和检查 5 里 git SHA 那件事是同一类病：**检查本身写错，却报成代码有问题**。）
# ⇒ 改成正着写：先捞出所有带 envVariables 的行，再**排除**空 {} 那一种形状。
NONEMPTY="$(grep -nE '"envVariables"' cloudbaserc.json 2>/dev/null \
  | grep -vE '"envVariables"[[:space:]]*:[[:space:]]*\{[[:space:]]*\}[[:space:]]*,?[[:space:]]*$' || true)"

LITERAL=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  case "$f" in *.js|*.cjs|*.mjs|*.json) ;; *) continue ;; esac
  case "$f" in *package-lock.json) continue ;; esac
  [ -f "$f" ] || continue
  h="$(grep -nE -I '(accessKey|apiKey|apikey|secret|password)[[:space:]]*[:=][[:space:]]*"[^"]+"' -- "$f" 2>/dev/null \
       | grep -v 'process\.env\.' || true)"
  if [ -n "$h" ]; then
    LITERAL="$LITERAL
      · $f（$(printf '%s\n' "$h" | wc -l | tr -d ' ') 处）"
  fi
done < <(git ls-files -co --exclude-standard)

if [ -z "$NONEMPTY" ] && [ -z "$LITERAL" ]; then
  ok "检查 6／6  配置内联：envVariables 是不是空的、代码是不是只用 process.env 读密钥"
  printf '      cloudbaserc.json 里的云函数：%s\n' "$ENVV"
  echo '      各函数 envVariables 均为空 {} —— 未发现内联凭据'
  echo '      未发现把密钥写死在代码里的地方'
else
  bad "检查 6／6  配置内联：envVariables 是不是空的、代码是不是只用 process.env 读密钥"
  [ -n "$NONEMPTY" ] && printf '      非空 envVariables：%s\n' "$NONEMPTY"
  [ -n "$LITERAL" ] && printf '      字面量赋值：%s\n' "$LITERAL"
fi

# ---------------------------------------------------------------
# 汇总
# ---------------------------------------------------------------
echo
echo '=================================================='
printf ' 结果：%s 项通过 ／ %s 项未通过\n' "$PASS" "$FAIL"
if [ "$FAIL" -ne 0 ]; then
  printf ' 未通过：%s\n' "$FAILED_LIST"
fi
echo '=================================================='

# 人工复核（本脚本**故意不做**的一件事）：
#   package-lock.json 里有大量 base64 校验和，容易造成"疑似密钥"的假命中，所以上面跳过了它。
#   它内部不可能有我们自己的密钥（内容完全由 package.json 决定）；
#   真要复核可以 `git ls-files cloudfunctions/api/package-lock.json` 后人工翻一遍。

if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
