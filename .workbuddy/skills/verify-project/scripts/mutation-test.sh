#!/usr/bin/env bash
# ============================================================
# verify-project · scripts/mutation-test.sh
# 变异测试：**故意把 Bug 放回项目里**，看检查脚本会不会变红。
# ------------------------------------------------------------
# 【为什么需要它】
#   "全绿"有两种可能：
#     (a) 东西真的是好的
#     (b) **判据是空的**，根本查不出坏东西
#   光看"全绿"分不出这两种。唯一的分辨办法就是**把坏的放进去**，
#   看它会不会变红 —— 不变红，那条断言就是废的。
#
# 【怎么跑】在自己的终端里（Windows 上是 Git Bash）：
#     bash .workbuddy/skills/verify-project/scripts/mutation-test.sh status
#     bash .workbuddy/skills/verify-project/scripts/mutation-test.sh plant-4b
#     bash .workbuddy/skills/verify-project/scripts/mutation-test.sh plant-6
#     bash .workbuddy/skills/verify-project/scripts/mutation-test.sh plant-hidden
#     bash .workbuddy/skills/verify-project/scripts/mutation-test.sh undo
#
#   典型流程（一次测一个，别叠加）：
#     plant-4b → 跑 verify.sh（应看到 ④b 红）→ undo
#     plant-6  → 跑 verify.sh（应看到 ⑥ 红，⑤ 仍绿）→ undo
#     plant-hidden → 跑 verify-ui.mjs（应看到 ⑫ 红）→ undo
#
# 【安全约定】（照 MEMORY-lessons 第 33 条）
#   改之前先 cp 备份 → 改 → 跑 → cp 恢复 → **回读核对 md5**
#   ⚠️ 备份已存在时**不覆盖** —— 否则"植入两次"会把坏版本当成原件存下来。
#   ⚠️ 只动**行级**（sed 删整行 / 追加整行），不删片段 ——
#      删片段会产出"语法看着合法"的文件，读数全废。
# ============================================================

set -u

SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="${PROJECT_ROOT:-$(cd "$SELF_DIR/../../../.." && pwd)}"
COPY_DIR="${COPY_DIR:-$HOME/.workbuddy/tmp/solar-tcb}"
BK="${TMPDIR:-/tmp}/verify-project-mutation-bak"
MARKER_FILE="$COPY_DIR/planted-extra.md"
MARKER_LINE='/* [变异测试] 这一行代表"改了一行代码但没有重新发布静态托管"。 */'

# ⚠️ 这个脚本里**只能**用 `#` 注释。
#    实测踩到：写了 JS 风格的 `/* …… */`，bash 把它当 **glob**，
#    `/*` 展开成 `/LICENSE.txt /bin /cmd /dev …` 然后**当命令执行**，
#    报出一堆"command not found"，而且脚本还继续往下跑 —— 静默的错。
#
# 白名单只留一个来源：从 verify.sh 里读出来，避免两份清单各说各话。
WHITELIST="$(sed -n '/^WHITELIST="/,/^vendor\/three\.min\.js"$/p' "$SELF_DIR/verify.sh" \
  | sed -e '1s/^WHITELIST="//' -e '$s/"$//')"
WL_N="$(printf '%s\n' "$WHITELIST" | grep -c . | tr -d ' ')"

if [ ! -f "$ROOT/index.html" ] || [ ! -f "$ROOT/cloudbaserc.json" ]; then
  printf '\033[31m🔴 项目根目录自检未通过\033[0m：%s\n' "$ROOT"; exit 2
fi
if [ "$WL_N" != "14" ]; then
  printf '\033[31m🔴 从 verify.sh 读到的白名单是 %s 个（应为 14）\033[0m —— 两边可能已经不同步，先修。\n' "$WL_N"; exit 2
fi
mkdir -p "$BK"

md5_of() { [ -f "$1" ] || { printf 'MISSING'; return; }; md5sum < "$1" 2>/dev/null | awk '{print $1}'; }

sync_copy() {
  while IFS= read -r f; do
    [ -n "$f" ] || continue
    mkdir -p "$COPY_DIR/$(dirname "$f")"
    cp "$ROOT/$f" "$COPY_DIR/$f"
  done <<< "$WHITELIST"
}

say() { printf '\n\033[36m%s\033[0m\n' "$1"; }
note() { printf '   %s\n' "$1"; }

# ------------------------------------------------------------
CMD="${1:-status}"
# ------------------------------------------------------------

case "$CMD" in

  status)
    say '当前状态'
    note "项目根目录：$ROOT"
    note "发布副本  ：$COPY_DIR"
    if [ -f "$MARKER_FILE" ]; then note '④b 变异：🔴 **已植入**（副本里有 planted-extra.md）'; else note '④b 变异：✅ 干净'; fi
    if grep -q '\[变异测试\]' "$ROOT/src/catalog.js" 2>/dev/null; then note '⑥ 变异：🔴 **已植入**（catalog.js 带标记行）'; else note '⑥ 变异：✅ 干净'; fi
    if grep -q '^\.status-form\[hidden\]' "$ROOT/styles/main.css" 2>/dev/null; then note '⑫ 变异：✅ 干净（[hidden] 兜底规则在）'; else note '⑫ 变异：🔴 **已植入**（[hidden] 兜底规则被删）'; fi
    note "副本文件数：$(find "$COPY_DIR" -type f 2>/dev/null | wc -l | tr -d ' ')（干净时应为 14）"
    ;;

  plant-4b)
    say '变异 ④b：往发布副本里夹带一个白名单外的文件'
    printf '# 变异测试：这个文件不在 14 个白名单里\n（用来验证 ④b「副本 = 白名单，不多不少」能不能查出来）\n' > "$MARKER_FILE"
    note "已写入 $MARKER_FILE"
    note "副本文件数：$(find "$COPY_DIR" -type f | wc -l | tr -d ' ')（应为 15）"
    note '⇒ 现在跑 verify.sh，应当看到：FAIL ④b 副本里夹带了白名单外的文件：planted-extra.md'
    ;;

  plant-6)
    say '变异 ⑥：改一行代码 + 重新生成副本，但**不发布**'
    if [ ! -f "$BK/catalog.js.orig" ]; then cp "$ROOT/src/catalog.js" "$BK/catalog.js.orig"; fi
    printf '\n%s\n' "$MARKER_LINE" >> "$ROOT/src/catalog.js"
    sync_copy
    note "catalog.js 现在的 md5：$(md5_of "$ROOT/src/catalog.js")"
    note "副本 catalog.js 的 md5：$(md5_of "$COPY_DIR/src/catalog.js")　（应与上面**相同** ⇒ ⑤ 会绿）"
    note '⇒ 现在跑 verify.sh，应当看到：⑤ 绿（副本跟得上代码）＋ ⑥ 红（公网跟不上副本）'
    note '   ⚠️ ⑤ 绿而 ⑥ 红，正好说明红点落在"忘了发布"这一环，不是"忘了生成副本"。'
    ;;

  plant-hidden)
    say '变异 ⑫：删掉 `.status-form[hidden] { display: none }` 这条兜底'
    if [ ! -f "$BK/main.css.orig" ]; then cp "$ROOT/styles/main.css" "$BK/main.css.orig"; fi
    sed -i '/^\.status-form\[hidden\] {/,/^}/d' "$ROOT/styles/main.css"
    note "main.css 字节数：$(wc -c < "$ROOT/styles/main.css")（改前 $(wc -c < "$BK/main.css.orig")）"
    note '⇒ 现在跑 verify-ui.mjs，应当看到：'
    note '   FAIL ⑫　status form#edit-form.status-form → display=flex'
    note '   🔴 #edit-form 带 hidden 但 display=flex —— Day 22 的坑复发了'
    note '   ⚠️ 同时 ⑬（控制台报错）**依然是绿的** —— 这个 Bug 一条报错都不产生，'
    note '      这正是它必须靠专门断言（读 computed display）才拦得住的原因。'
    note '   ⚠️ 连带：如果你顺手也跑了 verify.sh，会看到 **⑤ 也红** ——'
    note '      FAIL  副本与仓库不一致：13 / 14 一致，以下不同： styles/main.css'
    note '      这不是故障：⑫ 查的是"浏览器渲染"，可变异手段是"改一个白名单文件"，'
    note '      改了文件就躲不过文件一致性检查（⑤/⑥）。'
    note '      ⇒ 规律：**改文件类的变异，躲不过文件检查** —— 所以这一条的"其余仍绿"'
    note '        只对**浏览器三项**（⑪⑫⑬）成立，不要把 ⑤ 算进来。'
    ;;

  undo)
    say '撤销全部变异，并回读核对'
    # ① 夹带文件
    if [ -f "$MARKER_FILE" ]; then rm -f "$MARKER_FILE"; note '已删除 planted-extra.md'; else note 'planted-extra.md 本来就不在'; fi
    # ② catalog.js
    if [ -f "$BK/catalog.js.orig" ]; then
      cp "$BK/catalog.js.orig" "$ROOT/src/catalog.js"
      note "catalog.js 已还原 · md5 = $(md5_of "$ROOT/src/catalog.js")（原件 $(md5_of "$BK/catalog.js.orig")）"
      [ "$(md5_of "$ROOT/src/catalog.js")" = "$(md5_of "$BK/catalog.js.orig")" ] && note '✅ 回读一致' || note '🔴 回读不一致，手工看一下'
    else
      note '没有 catalog.js 备份（说明没植入过 ⑥ 变异）'
    fi
    # ③ main.css
    if [ -f "$BK/main.css.orig" ]; then
      cp "$BK/main.css.orig" "$ROOT/styles/main.css"
      note "main.css 已还原 · md5 = $(md5_of "$ROOT/styles/main.css")（原件 $(md5_of "$BK/main.css.orig")）"
      [ "$(md5_of "$ROOT/styles/main.css")" = "$(md5_of "$BK/main.css.orig")" ] && note '✅ 回读一致' || note '🔴 回读不一致，手工看一下'
    else
      note '没有 main.css 备份（说明没植入过 ⑫ 变异）'
    fi
    # ④ 副本回到 14 个、且跟仓库一致
    sync_copy
    note "副本文件数：$(find "$COPY_DIR" -type f | wc -l | tr -d ' ')（应为 14）"
    # ⑤ git 侧的自证
    if command -v git >/dev/null 2>&1; then
      CHANGED="$(cd "$ROOT" && git status --porcelain -- src styles | tr '\n' ' ')"
      if [ -z "$CHANGED" ]; then note '✅ git 说 src/ 与 styles/ 都没有改动（最硬的还原证据）'
      else note "⚠️ git 说这些文件还有改动，人工确认：$CHANGED"; fi
    fi
    note '⇒ 现在跑 verify.sh 与 verify-ui.mjs，都应当全绿。'
    ;;

  *)
    printf '用法：%s {status|plant-4b|plant-6|plant-hidden|undo}\n' "$(basename "$0")"
    exit 2
    ;;
esac

printf '\n'
