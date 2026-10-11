#!/usr/bin/env bash
# ============================================================
# verify-project · scripts/verify.sh
# 发布前检查 第 1–10 项（不需要浏览器）
# ------------------------------------------------------------
# 【怎么跑】在自己的终端里（Windows 上是 Git Bash）：
#     bash .workbuddy/skills/verify-project/scripts/verify.sh
#   或者从项目根目录：
#     bash .workbuddy/skills/verify-project/scripts/verify.sh
#   退出码：全 PASS = 0；有 FAIL = 1；只有未执行 = 0（但会提醒）。
#
# 【为什么脚本自己找项目根目录】
#   ROOT 默认 = 脚本位置往上数 4 层（scripts → verify-project → skills → .workbuddy → 仓库）。
#   ⚠️ 但仍必须**做一次自检**：根目录里得有 index.html + cloudbaserc.json，
#      否则说明脚本被拷到别处跑了 —— 那种情况下所有读数都是废的，直接退出。
#      （Day 23 教训：`ROOT="${BASH_SOURCE[0]%/*}/.."` 这种自定位型脚本被拷走会静默扫错目录。）
#   要指到别的目录：PROJECT_ROOT=/path/to/repo bash verify.sh
#
# 【可调的环境变量】
#   PROJECT_ROOT   项目根目录（默认按脚本位置推）
#   COPY_DIR       静态托管发布副本目录（默认 ~/.workbuddy/tmp/solar-tcb）
#   STATIC_BASE    公网静态托管域名
#   GATEWAY_BASE   公网 API 网关域名
#   SKIP_NET=1     跳过所有联网项（第 6/7/8 项）—— 离线时用，那几项记「未执行」
#
# 【三态纪律】结果只取三种：PASS / FAIL / 未执行。
#   联网项拿不到数据时记「未执行」，**不记 FAIL** ——
#   "网断了" 和 "东西坏了" 是两件事，混在一起会让这个脚本变得不可信。
# ============================================================

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PROJECT_ROOT:-$(cd "$SCRIPT_DIR/../../../.." && pwd)}"
COPY_DIR="${COPY_DIR:-$HOME/.workbuddy/tmp/solar-tcb}"
STATIC_BASE="${STATIC_BASE:-https://solar-system-d3g10b341a8d66aa6-1483420860.tcloudbaseapp.com}"
GATEWAY_BASE="${GATEWAY_BASE:-https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com}"
SKIP_NET="${SKIP_NET:-0}"

# ⚠️ --noproxy：本机跑时 http_proxy/https_proxy 可能指向 127.0.0.1，
#    那样连本地地址都会被塞进代理。只把回环地址排除掉，公网照走。
CURL_OPTS="-sS -m 25 --noproxy 127.0.0.1,localhost"

# ------------------------------------------------------------
# 静态托管的**白名单**（14 个运行文件）
# ⚠️ 为什么写死在脚本里：这是"发布时该传哪些文件"的**规格**，
#    它本来就该是一份人工维护的清单 —— 从目录里扫出来的东西没法判"漏没漏"。
# ------------------------------------------------------------
WHITELIST="index.html
src/api.js
src/catalog.js
src/controls.js
src/data/bodies.js
src/fallback.js
src/filter.js
src/focus3d.js
src/router.js
src/scene2d.js
src/states.js
src/status.js
styles/main.css
vendor/three.min.js"

PASS=0; FAIL=0; SKIP=0
FAILED_LIST=""
SKIPPED_LIST=""
# ⚠️ 这里**故意不用 mktemp -d**：本机 Git Bash 下它返回的是
#    "C:\Users\33198\AppData\Local\Temp/tmp.XXXX" 这种**反斜杠混排**路径，
#    于是 md5sum 会在输出行首加一个转义前缀 `\`（文件名含反斜杠时的自保行为），
#    `awk '{print $1}'` 就把那个 `\` 一起捞进来 ⇒ **所有哈希比对全部假红**。
#    （Day 25 实测：14 个文件明明逐字节相同，却报 0/14 一致。）
TMP="${TMPDIR:-/tmp}/verify-project-$$"
mkdir -p "$TMP" 2>/dev/null

ok()   { PASS=$((PASS + 1));      printf '  \033[32mPASS\033[0m  %s\n' "$1"; }
bad()  { FAIL=$((FAIL + 1)); FAILED_LIST="$FAILED_LIST
    · $1"; printf '  \033[31mFAIL\033[0m  %s\n' "$1"; }
skip() { SKIP=$((SKIP + 1)); SKIPPED_LIST="$SKIPPED_LIST
    · $1"; printf '  \033[33m未执行\033[0m %s\n' "$1"; }
dim()  { printf '        %s\n' "$1"; }
step() { printf '\n\033[36m%s\033[0m\n' "$1"; }

# ⚠️ 用 `md5sum < file`（从标准输入读）而不是 `md5sum file`：
#    前者输出的文件名恒为 `-`，**永远不会**因为路径里有反斜杠而加转义前缀。
md5_of() { [ -f "$1" ] || { printf 'MISSING'; return; }; md5sum < "$1" 2>/dev/null | awk '{print $1}'; }

# ============================================================
printf '\033[1m发布前检查 · 第 1–10 项\033[0m\n'
printf '项目根目录：%s\n' "$ROOT"
printf '发布副本  ：%s\n' "$COPY_DIR"
printf '公网静态  ：%s\n' "$STATIC_BASE"
printf '公网网关  ：%s\n' "$GATEWAY_BASE"
# ============================================================

# ------------------------------------------------------------
# 前置自检：根目录对不对
# ------------------------------------------------------------
if [ ! -f "$ROOT/index.html" ] || [ ! -f "$ROOT/cloudbaserc.json" ]; then
  printf '\n\033[31m🔴 项目根目录自检未通过\033[0m：%s 里没有 index.html / cloudbaserc.json。\n' "$ROOT"
  printf '   脚本可能被拷到别处运行了 —— 下面所有读数都会是错的，直接停下。\n'
  printf '   要指定目录：PROJECT_ROOT=/你的/项目目录 bash verify.sh\n'
  exit 2
fi

# ============================================================
step '① 密钥扫描（复用 tests/security-scan.sh，6 项）'
# 判据：退出码 0，即 6 项全过。
# ⚠️ 不自己重写一遍扫描规则 —— 复用已有的那条，免得两套规则各说各话。
if [ -f "$ROOT/tests/security-scan.sh" ]; then
  SCAN_OUT="$(cd "$ROOT" && bash tests/security-scan.sh 2>&1)"
  SCAN_RC=$?
  SCAN_SUM="$(printf '%s\n' "$SCAN_OUT" | grep -E '结果' | tail -1 | tr -d '\r')"
  if [ "$SCAN_RC" = "0" ]; then
    ok "密钥扫描全过 —— ${SCAN_SUM:-（没读到汇总行）}"
  else
    bad "密钥扫描未通过（退出码 $SCAN_RC）—— ${SCAN_SUM:-（没读到汇总行）}"
    printf '%s\n' "$SCAN_OUT" | grep -E '🔴' | head -6 | while IFS= read -r l; do dim "$(printf '%s' "$l" | tr -d '\r')"; done
  fi
else
  bad "找不到 tests/security-scan.sh（密钥扫描无法执行）"
fi

# ============================================================
step '② 发布副本洁净（副本里没有密钥特征词）'
# 判据：副本所有文件里，密钥特征词命中 0 处。
# ⚠️ 副本是"要整个传到公网"的那一份 —— 它脏了，等于把密钥挂到网上。
PAT_SECRET='-----BEGIN [A-Z ]*PRIVATE KEY-----|AKID[A-Za-z0-9]{16,}|sk-[A-Za-z0-9]{20,}|gh[opsu]_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}|postgres(ql)?://[^:[:space:]]+:[^@[:space:]]+@'
if [ -d "$COPY_DIR" ]; then
  COPY_N="$(find "$COPY_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')"
  SEC_N="$(grep -rlE -I "$PAT_SECRET" "$COPY_DIR" 2>/dev/null | wc -l | tr -d ' ')"
  if [ "$SEC_N" = "0" ]; then
    ok "发布副本洁净：$COPY_N 个文件，0 处密钥特征词"
  else
    bad "发布副本里有 $SEC_N 个文件含密钥特征词"
    grep -rlE -I "$PAT_SECRET" "$COPY_DIR" 2>/dev/null | head -6 | while IFS= read -r l; do dim "$l"; done
  fi
else
  bad "发布副本不存在：$COPY_DIR（先按白名单重新生成一份）"
fi

# ============================================================
step '③ 无调试残留 · 无写死路径'
# 判据：运行文件（index.html / src / styles）里 0 处命中。
# ⚠️ 写死路径这条尤其要查：把 D:\AI部_... 这类绝对路径带进前端，
#    换台电脑就白屏，而且报错信息里只会说"文件找不到"，很难倒推。
PAT_DEBUG='debugger|console\.(log|debug)\(|[A-Za-z]:\\[Uu]sers|/d/AI|D:\\AI'
DBG_N=0
DBG_DETAIL=""
for f in "$ROOT/index.html" "$ROOT/styles/main.css"; do
  [ -f "$f" ] || continue
  n="$(grep -cE -I "$PAT_DEBUG" "$f" 2>/dev/null | tr -d ' ')"
  [ "${n:-0}" -gt 0 ] && { DBG_N=$((DBG_N + n)); DBG_DETAIL="$DBG_DETAIL ${f#$ROOT/}($n)"; }
done
if [ -d "$ROOT/src" ]; then
  n="$(grep -rcE -I "$PAT_DEBUG" "$ROOT/src" 2>/dev/null | awk -F: '$2>0{s+=$2} END{print s+0}')"
  DBG_N=$((DBG_N + n))
fi
if [ "$DBG_N" = "0" ]; then
  ok "无调试残留 / 无写死路径：0 处"
else
  bad "有 $DBG_N 处调试残留或写死路径${DBG_DETAIL}"
fi

# ③b 伪块注释：**bash 没有块注释**。写了 `/* …… */`，bash 会把 `/*` 当 glob，
#    展开成 `/LICENSE.txt /bin /cmd …` 然后**当命令执行**，报一堆 command not found，
#    而脚本还继续往下跑 —— 是个**静默的错**。（Day 25 写本 Skill 时实测踩到，
#    追了 `bash -x` 才定位。）⇒ 行首出现 `/*` 或 `*/` 一律报错。
FAKE_C="$(grep -rnE '^[[:space:]]*(/\*|\*/)' "$ROOT/.workbuddy/skills" "$ROOT/tests" --include='*.sh' 2>/dev/null || true)"
if [ -z "$FAKE_C" ]; then
  ok "③b 脚本里没有伪块注释（行首 /* 或 */）：0 处"
else
  bad "③b 有 .sh 用了非法的块注释（bash 会把 /* 当 glob 展开后当命令执行）"
  printf '%s\n' "$FAKE_C" | head -4 | while IFS= read -r l; do dim "$(printf '%s' "$l" | sed "s|$ROOT/||")"; done
fi

# ============================================================
step '④ 文件对账（发布白名单 + 目录登记）'
# ④a 白名单里的文件在仓库都存在
MISS_IN_REPO=""
while IFS= read -r f; do
  [ -n "$f" ] || continue
  [ -f "$ROOT/$f" ] || MISS_IN_REPO="$MISS_IN_REPO $f"
done <<< "$WHITELIST"
if [ -z "$MISS_IN_REPO" ]; then
  ok "④a 白名单文件在仓库里齐全：14 / 14"
else
  bad "④a 白名单里有文件在仓库中不存在：$MISS_IN_REPO"
fi

# ④b 副本里的文件**恰好等于**白名单（多了 = 夹带，少了 = 漏传）
if [ -d "$COPY_DIR" ]; then
  COPY_LIST="$(cd "$COPY_DIR" && find . -type f 2>/dev/null | sed 's|^\./||' | sort | tr -d '\r')"
  WANT_LIST="$(printf '%s\n' "$WHITELIST" | sort)"
  EXTRA="$(diff <(printf '%s\n' "$WANT_LIST") <(printf '%s\n' "$COPY_LIST") | grep '^>' | sed 's|^> ||' | tr '\n' ' ')"
  LOST="$(diff <(printf '%s\n' "$WANT_LIST") <(printf '%s\n' "$COPY_LIST") | grep '^<' | sed 's|^< ||' | tr '\n' ' ')"
  CN="$(printf '%s\n' "$COPY_LIST" | grep -c . | tr -d ' ')"
  if [ -z "$EXTRA" ] && [ -z "$LOST" ]; then
    ok "④b 副本 = 白名单：$CN 个文件，不多不少"
  else
    [ -n "$EXTRA" ] && bad "④b 副本里夹带了白名单外的文件：$EXTRA"
    [ -n "$LOST" ] && bad "④b 副本漏了白名单里的文件：$LOST"
  fi
else
  bad "④b 副本不存在，无法对账：$COPY_DIR"
fi

# ④c 仓库顶层条目 + 每个 Skill 目录，都必须在 TECH_DESIGN.md 第 2 节的目录树里登记
#     （规则八.2：不允许存在第 2 节之外的目录 —— 这条就是它的检查手段）
SEC2="$(sed -n '/^## 2\. 项目结构/,/^## 3\./p' "$ROOT/TECH_DESIGN.md" 2>/dev/null)"
UNREG=""
for e in $(cd "$ROOT" && ls -A 2>/dev/null | grep -vE '^\.git$' | grep -vE '\.genie$' | grep -vE '^node_modules$'); do
  esc="$(printf '%s' "$e" | sed 's/[.[\*^$]/\\&/g')"
  printf '%s\n' "$SEC2" | grep -qE "(^|[^A-Za-z0-9_.-])$esc(/|[^A-Za-z0-9_.-]|$)" || UNREG="$UNREG $e"
done
UNREG_SK=""
for d in "$ROOT"/.workbuddy/skills/*/; do
  [ -d "$d" ] || continue
  n="$(basename "$d")"
  printf '%s\n' "$SEC2" | grep -qF "$n/" || UNREG_SK="$UNREG_SK $n"
done
if [ -z "$UNREG" ] && [ -z "$UNREG_SK" ]; then
  ok "④c TECH_DESIGN.md 第 2 节登记齐全（顶层条目 + Skill 目录）"
else
  [ -n "$UNREG" ] && bad "④c 顶层条目没登记进 TECH_DESIGN.md 第 2 节：$UNREG"
  [ -n "$UNREG_SK" ] && bad "④c Skill 目录没登记进 TECH_DESIGN.md 第 2 节：$UNREG_SK"
fi

# ============================================================
step '⑤ 副本 = 仓库（逐文件 md5）'
# 判据：14 / 14 一致。
# ⚠️ 这条查的是"改了代码忘了重新生成副本" —— 副本是发布源，
#    它一过时，后面第 6 项（公网=副本）也一起变成假证据。
if [ -d "$COPY_DIR" ]; then
  S5=0; T5=0; D5=""
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    T5=$((T5 + 1))
    if [ -f "$ROOT/$f" ] && [ -f "$COPY_DIR/$f" ]; then
      if [ "$(md5_of "$ROOT/$f")" = "$(md5_of "$COPY_DIR/$f")" ]; then S5=$((S5 + 1)); else D5="$D5 $f"; fi
    else
      D5="$D5 $f(缺)"
    fi
  done <<< "$WHITELIST"
  if [ "$S5" = "$T5" ]; then
    ok "副本与仓库逐字节一致：$S5 / $T5"
  else
    bad "副本与仓库不一致：$S5 / $T5 一致，以下不同：$D5"
  fi
else
  bad "副本不存在，无法比较：$COPY_DIR"
fi

# ============================================================
step '⑥ 公网 = 副本（逐文件 md5）'
# 判据：14 / 14 一致。
# ⚠️ 这是全脚本**最值钱**的一条，因为它抓的是"改了代码没重新部署"——
#    这个错**本地一切正常、公网全是旧的**，只靠看本地文件永远发现不了。
# ⚠️ 加 ?t=时间戳 绕开 CDN 缓存，否则会读到上一版。
if [ "$SKIP_NET" = "1" ]; then
  skip '⑥ 公网 = 副本（SKIP_NET=1，本次跳过）'
else
  PROBE="$(curl $CURL_OPTS -o /dev/null -w '%{http_code}' "$STATIC_BASE/index.html?t=0" 2>/dev/null)"
  if [ -z "$PROBE" ] || [ "$PROBE" = "000" ]; then
    skip '⑥ 公网 = 副本（公网取不到 ⇒ 网络不通，不等于「东西坏了」）'
  else
    TS="$(date +%s)"
    S6=0; T6=0; D6=""
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      T6=$((T6 + 1))
      mkdir -p "$TMP/pub/$(dirname "$f")" 2>/dev/null
      CODE="$(curl $CURL_OPTS -o "$TMP/pub/$f" -w '%{http_code}' "$STATIC_BASE/$f?t=$TS" 2>/dev/null)"
      if [ "$CODE" = "200" ] && [ -f "$TMP/pub/$f" ] && [ "$(md5_of "$TMP/pub/$f")" = "$(md5_of "$COPY_DIR/$f" 2>/dev/null)" ]; then
        S6=$((S6 + 1))
      else
        D6="$D6 $f(HTTP $CODE)"
      fi
    done <<< "$WHITELIST"
    if [ "$S6" = "$T6" ]; then
      ok "公网与副本逐字节一致：$S6 / $T6"
    else
      bad "公网与副本不一致：$S6 / $T6 一致，以下不同：$D6"
      dim '⇒ 多半是"改了代码没重新发布静态托管"。重新跑一遍宿主部署命令再验。'
    fi
  fi
fi

# ============================================================
step '⑦ 跨域：网关白名单不是 *'
# 判据三条同时成立：① 白名单域名 → 回 access-control-allow-origin
#                    ② 陌生域名   → **不回**这个头
#                    ③ 任何情况下都不是 *
# ⚠️ 必须带 Origin 头去问 —— 不带的话网关什么都不回，
#    那样读出来是"没有 CORS 头"，会被误判成"没配置"（Day 25 亲身踩到）。
if [ "$SKIP_NET" = "1" ]; then
  skip '⑦ 跨域检查（SKIP_NET=1，本次跳过）'
else
  ORIGIN_OK="http://127.0.0.1:8081"
  HDR_LAN="$(curl $CURL_OPTS -o /dev/null -D - -H "Origin: $ORIGIN_OK" "$GATEWAY_BASE/api/health" 2>/dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)"
  HDR_SELF="$(curl $CURL_OPTS -o /dev/null -D - -H "Origin: $STATIC_BASE" "$GATEWAY_BASE/api/health" 2>/dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)"
  HDR_EVIL="$(curl $CURL_OPTS -o /dev/null -D - -H "Origin: https://evil.example.com" "$GATEWAY_BASE/api/health" 2>/dev/null | tr -d '\r' | grep -i '^access-control-allow-origin:' | head -1)"
  if [ -z "$HDR_LAN" ] && [ -z "$HDR_EVIL" ]; then
    skip '⑦ 跨域检查（网关没回应，网络不通）'
  else
    BAD7=""
    case "$HDR_LAN"  in *"$ORIGIN_OK"*) ;; *) BAD7="$BAD7 本地源没被放行";; esac
    case "$HDR_SELF" in *"$STATIC_BASE"*) ;; *) BAD7="$BAD7 静态托管域名没被放行";; esac
    [ -n "$HDR_EVIL" ] && BAD7="$BAD7 陌生域名竟然被放行"
    case "$HDR_LAN$HDR_SELF$HDR_EVIL" in *'*'*) BAD7="$BAD7 出现了通配符 *";; esac
    if [ -z "$BAD7" ]; then
      ok "跨域白名单正常：放行本地源与托管域名、陌生域名不回、无 *"
      dim "本地源 → ${HDR_LAN:-（空）}"
      dim "陌生源 → ${HDR_EVIL:-（空，正确）}"
    else
      bad "跨域白名单异常：$BAD7"
      dim "本地源 → ${HDR_LAN:-（空）}｜托管域名 → ${HDR_SELF:-（空）}｜陌生源 → ${HDR_EVIL:-（空）}"
    fi
  fi
fi

# ============================================================
step '⑧ 接口契约（形状 + 条数 + 错误分支）'
# 判据：/api/bodies 回 ok:true / total=11 / items 11 条；
#       ?id= 空值 与 ?limit=abc 都回 ok:false + BAD_REQUEST；?id=nosuch 回 NOT_FOUND。
# ⚠️ 一律看信封里的 ok，**不看 HTTP 状态码** ——
#    本项目云函数只返信封、没设 statusCode，该报 400/404 的公网也是 200。
if [ "$SKIP_NET" = "1" ]; then
  skip '⑧ 接口契约（SKIP_NET=1，本次跳过）'
else
  R8="$(curl $CURL_OPTS "$GATEWAY_BASE/api/bodies" 2>/dev/null)"
  if [ -z "$R8" ]; then
    skip '⑧ 接口契约（网关没回应，网络不通）'
  else
    OK8="$(printf '%s' "$R8" | grep -o '"ok":[a-z]*' | head -1 | cut -d: -f2)"
    TOTAL8="$(printf '%s' "$R8" | grep -o '"total":[0-9]*' | head -1 | cut -d: -f2)"
    IDS8="$(printf '%s' "$R8" | grep -o '"id":"[^"]*"' | wc -l | tr -d ' ')"
    B8=""
    [ "$OK8" = "true" ] || B8="$B8 ok值=$OK8"
    [ "$TOTAL8" = "11" ] || B8="$B8 total=$TOTAL8"
    [ "$IDS8" = "11" ] || B8="$B8 items含id=$IDS8 条"
    if [ -z "$B8" ]; then
      ok "接口契约正常：ok=true · total=11 · items 11 条"
    else
      bad "接口契约异常：$B8"
    fi

    # --- 错误分支：坏输入必须**报错**，不能默默忽略 ---
    E1="$(curl $CURL_OPTS "$GATEWAY_BASE/api/bodies?id=" 2>/dev/null)"
    E2="$(curl $CURL_OPTS "$GATEWAY_BASE/api/bodies?limit=abc" 2>/dev/null)"
    E3="$(curl $CURL_OPTS "$GATEWAY_BASE/api/bodies?id=nosuch" 2>/dev/null)"
    C1="$(printf '%s' "$E1" | grep -o '"code":"[A-Z_]*"' | head -1 | cut -d'"' -f4)"
    C2="$(printf '%s' "$E2" | grep -o '"code":"[A-Z_]*"' | head -1 | cut -d'"' -f4)"
    C3="$(printf '%s' "$E3" | grep -o '"code":"[A-Z_]*"' | head -1 | cut -d'"' -f4)"
    B8E=""
    [ "$C1" = "BAD_REQUEST" ] || B8E="$B8E ?id=空→$C1"
    [ "$C2" = "BAD_REQUEST" ] || B8E="$B8E ?limit=abc→$C2"
    [ "$C3" = "NOT_FOUND" ]   || B8E="$B8E ?id=nosuch→$C3"
    if [ -z "$B8E" ]; then
      ok "错误分支正常：?id=空→BAD_REQUEST · ?limit=abc→BAD_REQUEST · ?id=nosuch→NOT_FOUND"
    else
      bad "错误分支异常：$B8E"
    fi
  fi
fi

# ============================================================
step '⑨ 唯一冲突的错误码用「包含」判，不用全等'
# 判据：源码里**代码行**（非注释）出现 23505 的地方，必须用 indexOf/includes 这类包含判，
#       且不得出现 === '23505' / == '23505' 这种全等。
#       同时要求"至少有一处代码行" —— 否则这条检查是空的（永远绿）。
# ⚠️ 云上错误码是 DATABASE_23505（**带前缀**）⇒ 全等会在线上静默失效，
#    本地却看着好好的。这是本项目最容易复发的一条。
#
# ⚠️ 剥注释必须**真剥**：Day 25 第一版只挡了"以 * 或 // 开头的行"，
#    结果被**块注释的收尾行**（`…… */`，行首是正文不是 *）骗了 ——
#    那两行里写着"用**包含 23505**判"，明明是对的做法，却被当成反例报红。
#    ⇒ 用一个逐字符状态机（跟踪 /* */ 与 //）来剥，才不会看走眼。
STRIP_AWK='
BEGIN { inblk = 0 }
{
  line = $0; out = ""; i = 1
  while (i <= length(line)) {
    d = substr(line, i, 2)
    if (inblk) { if (d == "*/") { inblk = 0; i += 2 } else { i += 1 } }
    else {
      # ⚠️ "//" 只有在**前面不是冒号**时才算注释 —— 否则 http:// 会被当成注释起点
      if (d == "/*") { inblk = 1; i += 2 }
      else if (d == "//" && substr(line, i - 1, 1) != ":") { break }
      else { out = out substr(line, i, 1); i += 1 }
    }
  }
  if (out ~ /23505/) print FNR ": " out
}'
CODE9=""
STRIP_COUNT=0
while IFS= read -r jf; do
  [ -n "$jf" ] || continue
  STRIP_COUNT=$((STRIP_COUNT + 1))
  part="$(awk "$STRIP_AWK" "$jf" 2>/dev/null)"
  [ -n "$part" ] || continue
  CODE9="$CODE9$(printf '%s\n' "$part" | while IFS= read -r ln; do printf '%s:%s\n' "${jf#$ROOT/}" "$ln"; done)
"
done < <(find "$ROOT/cloudfunctions" -name '*.js' -not -path '*/node_modules/*' 2>/dev/null | sort)
CODE9="$(printf '%s\n' "$CODE9" | grep -v '^$' || true)"

if [ -z "$CODE9" ]; then
  bad "代码里完全没有 23505 的判据 —— 要么删了、要么换了写法，先人工确认（避免空断言）"
  dim "已扫描 $STRIP_COUNT 个云函数 js 文件（已剥注释）"
else
  EQ9="$(printf '%s\n' "$CODE9" | grep -E "(===|==|!==|!=)[[:space:]]*['\"]23505['\"]" || true)"
  NC9="$(printf '%s\n' "$CODE9" | grep -vE 'indexOf\(|includes\(' || true)"
  N9="$(printf '%s\n' "$CODE9" | grep -c . | tr -d ' ')"
  if [ -z "$EQ9" ] && [ -z "$NC9" ]; then
    ok "23505 判据正常：剥注释后剩 $N9 处代码行，全用「包含」判，无全等"
    printf '%s\n' "$CODE9" | head -3 | while IFS= read -r l; do dim "$l"; done
  else
    [ -n "$EQ9" ] && bad "出现了全等比较（线上会失效）：$(printf '%s' "$EQ9" | head -2 | tr '\n' ' ')"
    [ -n "$NC9" ] && bad "有 $(printf '%s\n' "$NC9" | grep -c . | tr -d ' ') 处判据没用「包含」判：$(printf '%s' "$NC9" | head -2 | tr '\n' ' ')"
  fi
fi

# ============================================================
step '⑩ 环境变量没内联（密钥不进代码）'
# 判据：cloudbaserc.json 里每个 envVariables 都是空对象 {}；
#       且 .env.example 模板存在（说明约定过"密钥走环境变量"）。
# ⚠️ 空 {} 是对的：值应当在**控制台**注入，不进仓库。
if [ ! -f "$ROOT/cloudbaserc.json" ]; then
  bad "找不到 cloudbaserc.json"
else
  ENV_ALL="$(grep -cE '"envVariables"' "$ROOT/cloudbaserc.json" | tr -d ' ')"
  ENV_BAD="$(grep -nE '"envVariables"' "$ROOT/cloudbaserc.json" 2>/dev/null \
    | grep -vE '"envVariables"[[:space:]]*:[[:space:]]*\{[[:space:]]*\}[[:space:]]*,?[[:space:]]*$' || true)"
  if [ -n "$ENV_BAD" ]; then
    bad "有 envVariables 不是空的（密钥可能被写进仓库）："
    printf '%s\n' "$ENV_BAD" | while IFS= read -r l; do dim "$l"; done
  elif [ "${ENV_ALL:-0}" -lt 1 ]; then
    bad "cloudbaserc.json 里没有任何 envVariables 字段 —— 检查方式可能已失效，人工确认"
  else
    ok "环境变量未内联：$ENV_ALL 处 envVariables 全为空 {}"
  fi
  if [ -f "$ROOT/.env.example" ]; then
    ok "存在 .env.example 模板（密钥走环境变量的约定还在）"
  else
    bad "找不到 .env.example —— 密钥约定可能被删了"
  fi
fi

# ============================================================
printf '\n\033[1m════════════════ 第 1–10 项 汇总 ════════════════\033[0m\n'
printf '  PASS %s ｜ FAIL %s ｜ 未执行 %s\n' "$PASS" "$FAIL" "$SKIP"
[ -n "$FAILED_LIST" ] && { printf '\n\033[31m🔴 未通过：\033[0m%s\n' "$FAILED_LIST"; }
[ -n "$SKIPPED_LIST" ] && { printf '\n\033[33m🟡 未执行（不算通过，也不算失败）：\033[0m%s\n' "$SKIPPED_LIST"; }
printf '\n第 11–13 项（浏览器行为）请跑：\n'
printf '  node .workbuddy/skills/verify-project/scripts/verify-ui.mjs\n'

rm -rf "$TMP" 2>/dev/null
[ "$FAIL" -gt 0 ] && exit 1
exit 0
