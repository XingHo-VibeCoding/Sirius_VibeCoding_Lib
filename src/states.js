/* ============================================================
 * src/states.js —— 页面状态机（Day 8 新增）
 * ------------------------------------------------------------
 * 职责：管理页面的四种状态（第 2 周的学习重点），并把结果写到
 *       <body data-page-state="..."> 上，让 CSS 去驱动各区的表现。
 *
 *   loading  加载中 —— 由「过渡屏」承担：等主视图真的就绪
 *   success  成功   —— 主视图已就绪，过渡屏退场
 *   empty    空     —— 数据在，但一条内容都没有
 *   error    错误   —— 数据取不到
 *
 * 对外接口：window.pageState.current()  当前状态名
 *
 * ⚠️ 「页面级状态」和「区块级状态」是两回事，别混：
 *   这里管的是**整页**准备好了没有。
 *   而 src/catalog.js 里的 data-state 只管**目录那一块**读完了没有，
 *   它有自己的"正在读取→读到"过程（约 0.4 秒）。
 *   粒度不同，所以它们各自有各自的状态；但判据都来自同一份数据，
 *   不会出现"页面说成功、目录说失败"这种分裂。
 *
 * 为什么要有「兜底 4 秒」：
 *   PRD 5.3 硬底线是「不出现白屏、卡死、控件点不动」。
 *   过渡屏是一个全屏遮罩，万一主视图永远不就绪（脚本报错等），
 *   它会一直挡着页面 —— 那等于把整个网站挡死了。
 *   所以无论如何，最多 4 秒必定让路。
 *   （styles/main.css 里还配了一条不依赖 JS 的同类兜底。）
 * ============================================================ */

(function () {
  'use strict';

  const MIN_HOLD_MS = 1200;   // 过渡屏最短停留（用户定「约 1.2 秒」）
  const MAX_HOLD_MS = 4000;   // 兜底：绝不挡超过 4 秒
  const POLL_MS = 80;         // 就绪检测间隔
  const FADE_MS = 460;        // 与 CSS 里的淡出时长保持一致

  const overlay = document.getElementById('intro-overlay');

  let state = 'loading';
  let startedAt = Date.now();
  let pollTimer = 0;
  let finished = false;

  /* 把当前状态写到 <body> 上。
     这是整页唯一的状态出口 —— 各个区块长什么样，由 CSS 读这个属性决定
     （styles/main.css 里的 body[data-page-state="..."] 那几段）。
     好处：状态和样子分开，脚本不用去一个个改元素的显隐。 */
  function paint() {
    if (document.body) {
      document.body.setAttribute('data-page-state', state);
    }
  }

  /* 「主视图真的就绪了」怎么判断？
     不用 window.onload —— 它只代表资源下载完，不代表画好了。
     这里看 SVG 里是不是真的画出了天体，那是 src/scene2d.js 干完活的标志。 */
  function isSceneReady() {
    return !!document.querySelector('#solar-scene circle[data-body-id]');
  }

  /* 「数据层给出结论了吗？」——返回结论，或 null 表示"数据没问题，继续等主图"。
     这一版的数据写死在 src/data/bodies.js 里，是同步加载的，
     所以到 DOMContentLoaded 时，下面三种情况已经能分清了：
       SOLAR_BODIES 不存在    → 数据文件没加载成功 → error
       SOLAR_BODIES 是空数组  → 数据在，但没内容     → empty
       有内容                 → 继续等主图画出天体   → success

     让它在这里判、而不是等主图超时，是为了**让状态早点正确**：
     否则数据明明坏了，用户还要盯着过渡屏傻等 4 秒才看到提示。 */
  function dataVerdict() {
    const list = window.SOLAR_BODIES;
    if (!list) {
      return 'error';
    }
    if (Array.isArray(list) && list.length === 0) {
      return 'empty';
    }
    return null;
  }

  function finish(reason, keepState) {
    if (finished) return;
    finished = true;
    clearTimeout(pollTimer);

    // 正常情况下走完就是成功；数据层已经给出别的结论时（keepState），保持不动
    if (!keepState) {
      state = 'success';
    }
    paint();

    if (overlay) {
      overlay.classList.add('is-done');
      overlay.setAttribute('aria-hidden', 'true');
      // 等淡出走完，再彻底移出文档流，免得它悄悄挡住点击
      setTimeout(function () {
        overlay.hidden = true;
      }, FADE_MS);
    }

    if (window.console && console.info) {
      console.info('[states] → ' + state + '：' + reason +
        '（停留 ' + (Date.now() - startedAt) + ' ms）');
    }
  }

  /* 数据层已经给出结论 → 先把状态定下来，再让过渡屏照常退场。
     顺序很重要：先定状态，finish() 里的 paint() 才能把正确的值写出去。 */
  function settle(next, reason) {
    if (finished) return;
    state = next;
    finish(reason, true);
  }

  function poll() {
    if (finished) return;

    const waited = Date.now() - startedAt;

    if (waited >= MIN_HOLD_MS) {
      const verdict = dataVerdict();
      if (verdict) {
        settle(verdict, '数据层已给出结论');
        return;
      }
      if (isSceneReady()) {
        finish('主图已画出天体');
        return;
      }
    }

    if (waited >= MAX_HOLD_MS) {
      finish('兜底超时，强制让路');
      return;
    }

    pollTimer = setTimeout(poll, POLL_MS);
  }

  paint();   // 一开始就是 loading（HTML 里也写了一份，这里保证 JS 一跑就一致）

  if (!overlay) {
    // 过渡屏不在页面上（理论上不会发生）——那就没什么要管的，
    // 直接算成功，绝不能让状态卡在 loading。
    state = 'success';
    paint();
  } else {
    /* 点一下立即跳过（2026-09-23 用户追加要求）。
       为什么要它：过渡屏那 1 秒多里，用户如果立刻去点行星，点击会被遮罩吃掉，
       看起来就是"点了没反应"——这正好踩在 PRD 5.3 的硬底线上。
       所以给一个"随时能跳过"的出口。 */
    overlay.addEventListener('click', function () {
      finish('用户点击跳过');
    });

    poll();
  }

  /* ---------- 错误状态里的「重新加载」按钮（Day 8 第 4 步）----------
   * 为什么用 location.reload() 而不是"就地重读一次数据"：
   *   走到 error 状态的典型原因是**数据脚本文件本身没下载成功**。
   *   这时候在内存里再怎么读也是空的 —— 必须让浏览器重新去取那个文件。
   *   重新取文件最可靠的办法就是整页重新加载。
   * 代价：过渡屏会重放一次（约 1.2 秒）。对"出错了点重试"这个场景，
   *   重放一次反而是个正常反馈（用户能看出确实重新来了）。 */
  const retryBtn = document.getElementById('scene-state-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', function () {
      window.location.reload();
    });
  }

  window.pageState = {
    current: function () { return state; }
  };
})();
