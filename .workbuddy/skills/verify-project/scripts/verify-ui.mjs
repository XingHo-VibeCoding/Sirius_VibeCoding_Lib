/**
 * verify-project · scripts/verify-ui.mjs
 * 发布前检查 第 11–13 项（浏览器行为：遮罩透明度 / hidden 真隐藏 / 控制台报错）
 * ============================================================
 * 零依赖：Node 22 内置全局 WebSocket，直接连 Chrome 的 CDP。
 *
 * 【用法】
 *   1) 先在项目根目录起本地服务（另开一个终端，别关）：
 *        python -m http.server 8081 --bind 127.0.0.1
 *      ⚠️ 必须 --bind 127.0.0.1；不加会把你整个项目目录对局域网公开。
 *   2) 再跑：
 *        node .workbuddy/skills/verify-project/scripts/verify-ui.mjs
 *   可选环境变量：
 *      BASE=http://127.0.0.1:8081/   被测地址（也能指向公网静态托管）
 *      WIDTHS=1440x900,390x844       要测的视口（默认桌面 + 手机两档）
 *      CHROME_PATH=...                Chrome 可执行文件路径
 *      CDP_PORT=9377                  调试端口（换了就不会撞别的脚本）
 *
 * 【为什么这三项必须开浏览器，不能 grep 代码了事】
 *   ⑪ 遮罩的"挡不挡得住"，读的是**渲染后的渐变里那两个 alpha**——
 *      `.focus-overlay` 写在 `background` 简写里是 `rgba(...,0.95)`，
 *      而 `backgroundColor` 对渐变恒为 `rgba(0,0,0,0)`，grep 也 grep 不出"实际透出多少"。
 *   ⑫ **`hidden` 属性对 ≠ 视觉隐藏**（本项目 Day 22 的坑）：
 *      `.status-form { display: flex }` 是作者样式，**优于** UA 的 `[hidden]{display:none}`
 *      ⇒ 编辑区关不掉。当时自动化查的是属性值（确实是 true），全绿，最后看截图才发现。
 *      所以判据一律读 `getComputedStyle(el).display`。
 *   ⑬ 控制台报错是"跑起来才知道"的东西，静态读代码看不见。
 *
 * 【三态纪律】PASS / FAIL / 未执行。本地服务没起、或页面根本不是我们的页面 ⇒ 记「未执行」，
 *   绝不把"没测到"说成"通过"。
 * ============================================================
 */
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const BASE = process.env.BASE || "http://127.0.0.1:8081/";
const PORT = Number(process.env.CDP_PORT || 9377);
const WIDTHS = (process.env.WIDTHS || "1440x900,390x844").split(",").map((s) => s.trim()).filter(Boolean);
const ORIGIN = new URL(BASE).origin;

/* ---------- 结果收集 ---------- */
const R = { pass: 0, fail: 0, skip: 0, fails: [], skips: [] };
const ok = (name, ev) => { R.pass++; console.log(`  \u001b[32mPASS\u001b[0m  ${name}`); ev.forEach((l) => console.log("        " + l)); };
const bad = (name, ev) => { R.fail++; R.fails.push(name); console.log(`  \u001b[31mFAIL\u001b[0m  ${name}`); ev.forEach((l) => console.log("        " + l)); };
const skip = (name, ev) => { R.skip++; R.skips.push(name); console.log(`  \u001b[33m未执行\u001b[0m ${name}`); ev.forEach((l) => console.log("        " + l)); };

/* ---------- 前置：本地服务通不通 ---------- */
async function preflight() {
  try {
    const res = await fetch(BASE, { method: "GET" });
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, why: e && e.message };
  }
}

/* ---------- Chrome + CDP ---------- */
let ws = null, msgId = 0;
const pending = new Map();
let events = [];
let phase = "init";

function send(method, params = {}) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

async function waitForTarget() {
  for (let i = 0; i < 80; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === "page" && t.webSocketDebuggerUrl);
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* 还没起来 */ }
    await sleep(250);
  }
  throw new Error("连不上 Chrome 调试端口 " + PORT);
}

async function evaluate(expression, awaitPromise = false) {
  const r = await send("Runtime.evaluate", { returnByValue: true, expression, awaitPromise });
  if (r.exceptionDetails) throw new Error("页面脚本报错: " + JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
  return r.result.value;
}

/* ---------- 过门：平台「风险提醒」中间页 ----------
   ⚠️ 本地地址不会有这道门；只有传 BASE=<公网域名> 时才会遇到。
   它带 ~1 秒倒计时 ⇒ 先等 2 秒，再用**真实鼠标事件**点（JS 的 el.click() 不生效）。 */
async function passGate() {
  const t0 = await evaluate("document.title").catch(() => "");
  if (!t0 || t0.indexOf("风险提醒") === -1) return true;
  await sleep(2000);
  const btn = await evaluate(`(() => {
    const b = [...document.querySelectorAll('button,a')].find(function (el) {
      return /确定访问/.test((el.textContent || '').trim()) && el.offsetParent !== null;
    });
    if (!b) return null;
    const r = b.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`).catch(() => null);
  if (!btn) return false;
  await send("Input.dispatchMouseEvent", { type: "mousePressed", x: btn.x, y: btn.y, button: "left", clickCount: 1 });
  await send("Input.dispatchMouseEvent", { type: "mouseReleased", x: btn.x, y: btn.y, button: "left", clickCount: 1 });
  await sleep(4000);
  const t1 = await evaluate("document.title").catch(() => "");
  return !!t1 && t1.indexOf("风险提醒") === -1;
}

/* ---------- 页面侧探针 ---------- */
const SEL = (el) => el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + (el.className && String(el.className).trim() ? "." + String(el.className).trim().split(/\s+/)[0] : "");

/** ⑪ 读 .focus-overlay 渲染后的背景渐变里每个颜色的 alpha */
async function probeOverlay() {
  return evaluate(`(() => {
    const el = document.querySelector('.focus-overlay');
    if (!el) return { found: false };
    const cs = getComputedStyle(el);
    const bi = cs.backgroundImage || '';
    const re = /rgba?\\(([^)]+)\\)/g;
    let m; const colors = [];
    while ((m = re.exec(bi))) colors.push(m[1].trim());
    const alphas = colors.map(function (c) {
      const p = c.split(',').map(function (s) { return s.trim(); });
      return p.length >= 4 ? Number(p[3]) : 1;
    });
    return { found: true, hidden: el.hasAttribute('hidden'), display: cs.display,
             position: cs.position, box: [cs.top, cs.right, cs.bottom, cs.left].join(' / '),
             zIndex: cs.zIndex, backgroundImage: bi, colors: colors, alphas: alphas };
  })()`);
}

/** ⑫ 在当前视图下，把所有"该被 hidden 收起来"的元素扫一遍，读它们**渲染后的** display
 *  范围 = <body> 的直接子元素里带 hidden 的（过渡屏 / 兜底条 / 3D 遮罩）
 *        + 当前视图容器内的 hidden 元素（#edit-form / #compare-wrap / #catalog-filter ...）
 *  ⚠️ 只查"当前可见视图"内的 —— 视图容器自己 display:none 时，
 *     它里面所有元素的 computed display 天然是 none，那样查出来全是假绿。 */
async function probeHidden(view) {
  return evaluate(`(() => {
    const sel = (el) => el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
      (el.className && String(el.className).trim() ? '.' + String(el.className).trim().split(/\\s+/)[0] : '');
    const set = new Set();
    [...document.body.children].forEach(function (el) {
      if (el.hasAttribute && el.hasAttribute('hidden')) set.add(el);
    });
    const v = document.querySelector('[data-view-for="' + ${JSON.stringify(view)} + '"]');
    if (v) v.querySelectorAll('[hidden]').forEach(function (el) { set.add(el); });
    const checked = [], bad = [];
    set.forEach(function (el) {
      if (!(el instanceof HTMLElement)) return;
      const cs = getComputedStyle(el);
      const rec = { sel: sel(el), display: cs.display, visibility: cs.visibility };
      checked.push(rec);
      /* hidden 属性的语义就是"不渲染"。display:none 与 visibility:hidden 都算隐藏。
         ⚠️ 只要还有别的 display 值（flex/block/…），就是"属性设了但没真藏住"。 */
      if (cs.display !== 'none' && cs.visibility !== 'hidden') bad.push(rec);
    });
    return { view: ${JSON.stringify(view)}, checked: checked, bad: bad };
  })()`);
}

/** 切视图：改 hash 让路由走（不整页刷新，控制台读数才不会被重置） */
async function gotoView(view, holder) {
  await evaluate(`location.hash = '#/${view}';`, false).catch(() => {});
  for (let i = 0; i < 40; i++) {
    const cur = await evaluate("document.body.getAttribute('data-view')").catch(() => null);
    const hid = await evaluate(`(() => { const v = document.querySelector('[data-view-for="' + ${JSON.stringify(holder || view)} + '"]'); return v ? getComputedStyle(v).display : 'missing'; })()`).catch(() => "missing");
    if (cur === holder || (cur === view && hid !== 'none')) return true;
    await sleep(200);
  }
  return false;
}

/* ---------- 单档宽度：跑完 11/12/13 ---------- */
async function runWidth(size) {
  const [w, h] = size.split("x").map(Number);
  console.log(`\n\u001b[36m──── 视口 ${w}×${h} ────────────────────────────────\u001b[0m`);
  const profile = join(tmpdir(), "solar-verify-" + Date.now());
  const chrome = spawn(CHROME, [
    "--headless=new", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
    `--window-size=${w},${h}`,
    /* ⚠️ 3D 用软件渲染；此时**不能**加 --disable-gpu（会连软件渲染一起关掉，页面黑屏） */
    "--enable-unsafe-swiftshader",
    "about:blank",
  ], { stdio: "ignore" });

  try {
    ws = new WebSocket(await waitForTarget());
    await new Promise((res, rej) => { ws.addEventListener("open", res); ws.addEventListener("error", rej); });
    ws.addEventListener("message", (ev) => {
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result);
      } else if (m.method) {
        events.push({ method: m.method, params: m.params, phase });
      }
    });
    await send("Page.enable"); await send("Network.enable");
    await send("Runtime.enable"); await send("Log.enable");

    phase = "load";
    await send("Page.navigate", { url: BASE });
    await sleep(2000);
    const gated = await passGate();
    if (!gated) {
      skip(`⑪⑫⑬（${size}）：公网「风险提醒」中间页没过门，本轮读数作废`, []);
      return;
    }
    if (gated) events = events.filter((e) => e.phase !== "load" || e.method === "Log.entryAdded");

    /* 等应用真的就绪（过渡屏退场：它会给自己加 hidden） */
    let ready = false;
    for (let i = 0; i < 60; i++) {
      const s = await evaluate(`(() => { const o = document.getElementById('intro-overlay'); return { state: document.body.getAttribute('data-page-state'), introHidden: o ? o.hasAttribute('hidden') : true }; })()`).catch(() => null);
      if (s && s.state && s.state !== "loading" && s.introHidden) { ready = true; break; }
      await sleep(250);
    }
    const title = await evaluate("document.title").catch(() => "");
    if (!ready || !title || title.indexOf("风险提醒") !== -1) {
      skip(`⑪⑫⑬（${size}）：页面没进到就绪态（title=「${title}」），读数不可信`, []);
      return;
    }
    await sleep(1200);

    /* ============ ⑪ 遮罩透明度 ============ */
    phase = "overlay";
    const ov = await probeOverlay();
    if (!ov.found) {
      bad(`⑪ 遮罩 alpha（${size}）：找不到 .focus-overlay`, []);
    } else {
      const allOne = ov.alphas.length > 0 && ov.alphas.every((a) => a === 1);
      const ev = [
        `background-image 里取到 ${ov.colors.length} 个颜色：${ov.colors.join(' ｜ ')}`,
        `对应 alpha：${ov.alphas.join(' ｜ ')}　（判据：**全部 = 1**）`,
        `定位：position=${ov.position} · top/right/bottom/left=${ov.box} · z-index=${ov.zIndex}`,
        `当前状态：hidden=${ov.hidden} · display=${ov.display}`,
      ];
      if (allOne) ok(`⑪ 遮罩 alpha 全为 1（${ov.alphas.length} 个），详情页文字不会透上来（${size}）`, ev);
      else bad(`⑪ 遮罩 alpha 有 ${ov.alphas.filter((a) => a !== 1).length} 个不是 1 —— 下层内容会透出来（${size}）`, ev);
    }

    /* ============ ⑫ hidden 真的隐藏（逐视图扫） ============ */
    phase = "hidden";
    const VIEWS = [["explore", "explore"], ["catalog", "catalog"], ["body/earth", "body"], ["status", "status"]];
    const allChecked = [], allBad = [];
    let editFormNote = "（本次没走到检查台视图）";
    for (const [hash, holder] of VIEWS) {
      await gotoView(hash, holder);
      await sleep(hash === "status" ? 1500 : 700);
      const s = await probeHidden(holder);
      allChecked.push(...s.checked.map((r) => ({ ...r, view: holder })));
      allBad.push(...s.bad.map((r) => ({ ...r, view: holder })));
      if (holder === "status") {
        const f = await evaluate(`(() => {
          const el = document.getElementById('edit-form');
          if (!el) return { found: false };
          const cs = getComputedStyle(el);
          return { found: true, hidden: el.hasAttribute('hidden'), display: cs.display };
        })()`).catch(() => ({ found: false }));
        editFormNote = !f.found ? "🔴 找不到 #edit-form"
          : (!f.hidden ? "⚠️ #edit-form 此刻不是 hidden 状态（这条哨兵本轮不成立，无法证明）"
            : (f.display === 'none' ? "✅ #edit-form 带 hidden 时 display=none（Day 22 那个坑没复发）"
              : `🔴 #edit-form 带 hidden 但 display=${f.display} —— Day 22 的坑复发了`));
      }
    }
    const evHidden = [
      `本轮共检查 ${allChecked.length} 个「带 hidden 属性」的元素（逐视图切换后测）`,
      ...allChecked.slice(0, 12).map((r) => `${r.view.padEnd(8)} ${r.sel} → display=${r.display}`),
      `关键哨兵：${editFormNote}`,
    ];
    if (allChecked.length === 0) {
      skip(`⑫ hidden 真隐藏（${size}）：没扫到任何带 hidden 的元素 —— 这条检查本轮是空的，不算通过`, evHidden);
    } else if (allBad.length === 0 && editFormNote.indexOf('🔴') === -1) {
      ok(`⑫ 带 hidden 的元素全部真的收起来了（${allChecked.length} 个，0 个漏网）（${size}）`, evHidden);
    } else {
      bad(`⑫ 有 ${allBad.length} 个元素带 hidden 却没真隐藏（${size}）`, [
        ...allBad.map((r) => `${r.view} ${r.sel} → display=${r.display} · visibility=${r.visibility}`),
        ...evHidden,
      ]);
    }

    /* ============ ⑬ 控制台报错 ============ */
    phase = "console";
    await sleep(800);
    const isSameOrigin = (u) => { try { return !!u && new URL(u).origin === ORIGIN; } catch { return false; } };
    const logErrs = events.filter((e) => e.method === "Log.entryAdded" && e.params.entry.level === "error")
      .map((e) => ({ text: e.params.entry.text, url: e.params.entry.url || "", src: e.params.entry.source, phase: e.phase }));
    const consoleErrs = events.filter((e) => e.method === "Runtime.consoleAPICalled" && e.params.type === "error")
      .map((e) => ({ text: (e.params.args || []).map((a) => a.value || a.description || a.type).join(" ").slice(0, 160), phase: e.phase }));
    const exceptions = events.filter((e) => e.method === "Runtime.exceptionThrown")
      .map((e) => ({ text: e.params.exceptionDetails.text, phase: e.phase }));

    /* ⚠️ 分流：与页面**同源**的资源失败、脚本异常、console.error 才算"页面自己报错"。
       指向外部接口域名的失败单列 —— 那反映的是"接口通不通"（环境），
       不是"页面写错了"，混在一起会让红黄不分。 */
    const pageErrs = [
      ...logErrs.filter((e) => e.src !== "console-api" && (e.url === "" || isSameOrigin(e.url))).map((e) => `[资源] ${e.text} ${e.url}`),
      ...consoleErrs.map((e) => `[console.error] ${e.text}`),
      ...exceptions.map((e) => `[未捕获异常] ${e.text}`),
    ];
    const extErrs = logErrs.filter((e) => e.src !== "console-api" && e.url && !isSameOrigin(e.url)).map((e) => `[外部接口] ${e.text} ${e.url}`);

    const evConsole = [
      `同源错误 ${pageErrs.length} 条 ／ 外部接口失败 ${extErrs.length} 条 ／ 事件总数 ${events.length}`,
      ...pageErrs.slice(0, 8).map((t) => `🔴 ${t}`),
      ...(extErrs.length ? [`⚠️ 以下属外部接口（环境）问题，不计入本项判定：`, ...extErrs.slice(0, 4).map((t) => `　${t}`)] : []),
    ];
    if (pageErrs.length === 0) ok(`⑬ 控制台 0 条页面自身报错（${size}）`, evConsole);
    else bad(`⑬ 控制台有 ${pageErrs.length} 条页面自身报错（${size}）`, evConsole);

  } finally {
    try { ws && ws.close(); } catch { /* ignore */ }
    chrome.kill();
    ws = null;
  }
}

/* ---------- 主流程 ---------- */
console.log("\u001b[1m发布前检查 · 第 11–13 项（浏览器行为）\u001b[0m");
console.log(`被测地址：${BASE}`);
console.log(`视口    ：${WIDTHS.join(" , ")}`);

const pre = await preflight();
if (!pre.ok) {
  console.log(`\n\u001b[33m未执行\u001b[0m：${BASE} 连不上（${pre.why}）。`);
  console.log("  先在**另一个终端**里起本地服务（窗口别关），再跑本脚本：");
  console.log("    cd /d D:\\AI部_学习打卡\\VibeCoding");
  console.log("    python -m http.server 8081 --bind 127.0.0.1");
  console.log("  ⚠️ --bind 127.0.0.1 不要省 —— 不加会把整个项目目录对局域网公开。");
  process.exit(0);
}
if (pre.status !== 200) {
  console.log(`\n\u001b[33m未执行\u001b[0m：${BASE} 返回 HTTP ${pre.status}，不是我们的页面，读数不可信。`);
  process.exit(0);
}

try {
  for (const size of WIDTHS) {
    events = [];
    await runWidth(size);
  }
} catch (e) {
  console.log(`\n\u001b[31m脚本自身出错\u001b[0m：${e.message}`);
  R.fail++;
  R.fails.push("脚本自身出错：" + e.message);
}

console.log("\n\u001b[1m════════════════ 第 11–13 项 汇总 ════════════════\u001b[0m");
console.log(`  PASS ${R.pass} ｜ FAIL ${R.fail} ｜ 未执行 ${R.skip}`);
if (R.fails.length) console.log("\n\u001b[31m🔴 未通过：\u001b[0m\n    · " + R.fails.join("\n    · "));
if (R.skips.length) console.log("\n\u001b[33m🟡 未执行（不算通过，也不算失败）：\u001b[0m\n    · " + R.skips.join("\n    · "));
process.exit(R.fail > 0 ? 1 : 0);
