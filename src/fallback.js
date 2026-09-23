/* ============================================================
 * src/fallback.js —— 错误兜底
 * ------------------------------------------------------------
 * 职责（TECH_DESIGN.md 第 4 节）：出错时给用户可读提示。
 * 对外接口：showFallback(reason)
 *
 * 总原则（TECH_DESIGN 第 6 节）：
 *   任何一块坏掉，都不能让整个页面白屏。
 *   宁可少给一个功能，不可整页打不开。
 * ============================================================ */

(function () {
  'use strict';

  const SHOW_MS = 9000;
  let hideTimer = 0;

  function showFallback(reason) {
    let bar = document.getElementById('fallback-bar');

    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'fallback-bar';
      bar.className = 'fallback-bar';
      bar.setAttribute('role', 'status');
      document.body.appendChild(bar);
    }

    bar.textContent = String(reason || '页面有一部分没能正常加载，其他内容仍可照常使用。');
    bar.hidden = false;

    clearTimeout(hideTimer);
    hideTimer = setTimeout(function () {
      bar.hidden = true;
    }, SHOW_MS);
  }

  window.showFallback = showFallback;

  /* 顶层兜底：任何没被捕获的脚本错误，都不应该让页面变成纯白。
     （ResizeObserver 的提示在部分浏览器里会误报，这里忽略掉。） */
  window.addEventListener('error', function (ev) {
    if (ev && ev.message && !/ResizeObserver/.test(ev.message)) {
      showFallback('页面遇到一个问题：' + ev.message + '（其他内容仍可使用）');
    }
  });
})();
