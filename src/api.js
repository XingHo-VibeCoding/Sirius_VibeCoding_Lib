/* ============================================================
 * src/api.js —— 取数层（Day 17 新增）
 * ------------------------------------------------------------
 * 这个文件只有一个职责：**页面要的天体数据从哪来**。
 *
 * 对外只给一个东西：
 *   window.SolarApi.fetchBodies()  →  Promise<天体数组>
 *
 * 取数顺序：
 *   ① 先问云端接口 GET /api/bodies（数据来自 PostgreSQL）
 *   ② 接口不通 / 超时 / 返回失败 → 用页面自带的 src/data/bodies.js 兜底，
 *      并在页面上闪一条提示，让用户知道这次用的是自带版本
 *
 * 【为什么失败不报错、要兜底】
 *   TECH_DESIGN.md 第 6 节：任何一块坏掉，都不能让整个页面白屏。
 *   接口取不到时，页面里本来就躺着一份完整数据，那就照常用它 ——
 *   让用户看到完整内容，比让他看到一片空白有用得多。
 *
 * 【契约依据】api-contract.md 1.2（响应信封）、3.1（列表接口的字段）
 * ============================================================ */

(function () {
  'use strict';

  /* 本项目的接口地址（Day 15 实测的 HTTP 网关域名）。
     路径 /api/bodies 在控制台「HTTP 访问服务」里配路由，指向云函数 api。 */
  const API_BASE = 'https://solar-system-d3g10b341a8d66aa6-1483420860.ap-shanghai.app.tcloudbase.com';

  /* 本地调试用的逃生口：?api=http://127.0.0.1:8099 可临时把地址指到本机。
     ⚠️ 只接受 127.0.0.1 / localhost —— 否则任何人给地址栏加个参数，
        就能让页面去请求别人的服务器（线上页面不该留这个口子）。 */
  const LOOPBACK = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/;

  function pickBase() {
    try {
      const override = new URLSearchParams(location.search).get('api');
      if (override && LOOPBACK.test(override)) {
        return override;
      }
    } catch (e) {
      /* 老浏览器没有 URLSearchParams，忽略即可 —— 不可用就不覆盖 */
    }
    return API_BASE;
  }

  const base = pickBase();

  /* 超时上限。
     ⚠️ 必须有：路由没配好、或者网络不通时，fetch 会挂很久，
        图鉴就一直停在「正在读取天体资料…」，用户以为页面坏了。
         6 秒还没回，就当作取不到，直接走兜底。

     🔴 Day 28：**这个 6 秒和检查台的 15 秒不一样，是刻意的，别"顺手统一"。**
        · 这里（`api.js`）面向**用户体感**：等太久不如早点渲染页面自带的数据，
          用户看到的是正常内容；再等下去只是"用更准的数据换更长的白等"。
        · 那里（`src/status.js` 的 `TIMEOUT_MS`）面向**诊断准确性**：
          它是排查工具，宁可多等几秒，也**不能把"慢"误报成"接口坏了"**。
        ⇒ 两个数服务于两个相反的目标，强行取同一个值必然牺牲其中一边。
        ⚠️ 6 秒确实会**偶发**误判：Day 28 重复检测 9 轮里出现过 1 次
          `GET /api/bodies` 超过 6 秒（同一时刻接口直连实测只要 0.29–0.46 秒，
          页面内连打 20 次中位 140 ms ⇒ 属低概率瞬时事件）。
          代价是**可接受**的：超时只走静态兜底，页面功能不受影响。详见
          `CORE_FLOW_TEST.md` §6 的"已知登记项"。 */
  const TIMEOUT_MS = 6000;

  /**
   * 发一个请求，并按契约 1.2 拆开信封。
   * 成功返回 data；任何失败都抛错，交给调用方决定怎么兜底。
   */
  async function requestJson(url) {
    /* AbortController 是浏览器原生的"取消请求"工具。
       这里只用它做超时，不做别的。 */
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(function () {
          ctrl.abort();
        }, TIMEOUT_MS)
      : 0;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: ctrl ? ctrl.signal : undefined
      });

      if (!res.ok) {
        throw new Error('HTTP ' + res.status);
      }

      const body = await res.json();

      /* 契约 1.2：先看信封里的 ok，**不看 HTTP 状态码** ——
         有些网关会改写状态码，靠它判断不可靠。 */
      if (!body || body.ok !== true) {
        const msg = (body && body.error && body.error.message) || '接口返回了失败';
        throw new Error(msg);
      }

      return body.data;
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }

  /**
   * 取天体列表（图鉴视图用）。
   * @returns {Promise<Array>} 天体数组；接口不通时是页面自带的那份（副本）
   */
  function fetchBodies() {
    return requestJson(base + '/api/bodies')
      .then(function (data) {
        /* 契约 3.1 成功形状是 { total, items }。
           空数组照常返回 —— 那是"空"，不是"错"。
           （Day 8 判据：空 = 用户重试也没用，不给按钮；错 = 重试有用，给按钮。） */
        return (data && data.items) || [];
      })
      .catch(function (e) {
        /* 留在控制台，方便排查"到底为什么没取到"
           （超时 / 404 / 信封 ok=false 都会走到这里，原因各不一样）。 */
        console.warn('[SolarApi] 接口取数失败：', e && e.message);

        /* ---------------- 兜底：用页面自带的静态数据 ---------------- */
        if (window.SOLAR_BODIES) {
          /* 顶上闪一条提示。用现成的 src/fallback.js ——
             它的定位正是"页面有一部分没能正常加载，其他内容仍可照常使用"。 */
          if (typeof window.showFallback === 'function') {
            window.showFallback('天体资料这次没能从云端读取，正在用页面里自带的版本。');
          }
          return window.SOLAR_BODIES.slice();
        }

        /* 云端和本地**两边都空** —— 这才是真的"错误"。
           ⚠️ 不能在这里返回空数组：那会被上层当成"空态"，
             说成"暂时没有可显示的天体资料"，把一个"重试有用"的问题
             说成"重试没用"。Day 8 的判据里这两件事必须分开。
           所以照旧把错误抛出去，让图鉴显示错误态 + 「重新加载」。 */
        throw e;
      });
  }

  window.SolarApi = {
    fetchBodies: fetchBodies,
    /* 暴露出来便于排查"页面到底在请求哪个地址" */
    base: base
  };
})();
