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
      /* 【Day 23 改 · 这是今天最典型的一句裸报错】
         改之前是：showFallback('页面遇到一个问题：' + ev.message + '（其他内容仍可使用）')
         —— 把 JS 异常的**原文**直接拼进横幅，用户看到的是
            「Cannot read properties of null (reading 'focus')」这种句子：
              · 看不懂（那不是人话，是给开发者看的一句话）
              · 还顺手把**内部属性名 / 函数名**暴露给了所有访问者
         ⇒ 横幅只说人话；**技术细节一条都没丢**，改成记进控制台 ——
            排查的人打开 F12 照样能看到原文、文件名、行号。 */
      showFallback('页面有一小块没能正常工作，其他内容仍可照常使用。（技术细节已记在浏览器控制台）');
      if (window.console && console.error) {
        console.error('[fallback] 未捕获的页面错误：' + ev.message +
          (ev.filename ? '（' + ev.filename + ':' + ev.lineno + '）' : ''),
          ev.error || '');
      }
    }
  });
})();
