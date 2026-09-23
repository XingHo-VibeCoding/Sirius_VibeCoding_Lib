/* ============================================================
 * src/controls.js —— 调控区（PRD F3「教学机关」）
 * ------------------------------------------------------------
 * 职责（TECH_DESIGN.md 第 4 节）：采集用户操作并回调。
 * 对外接口：initControls({ onTimeScale, onScaleMode, onCompare })
 *
 * 三块控件（对应 PRD F3 的三条）：
 *   ① 时间流速：暂停 / 实时 / 演示 / 快进
 *   ② 轨道比例：图示比例 ↔ 真实比例
 *   ③ 教学对比：把八颗行星的公转周期并排画成条
 *
 * 【边界】这个文件不碰 SVG，也不改任何天体数据。
 * 它只做两件事：按配置把按钮画出来、把点击转成回调。
 * 画面怎么变由 scene2d.js 负责 —— 两边只通过回调通信（接口约定）。
 * ============================================================ */

(function () {
  'use strict';

  const YEAR_DAYS = 365.25;

  function h(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) {
      node.className = cls;
    }
    if (text !== undefined && text !== null) {
      node.textContent = text;
    }
    return node;
  }

  function trimNum(s) {
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }

  /* ---------- ① 时间流速 ----------
   * 档位不写死在这里，从 SOLAR_CONFIG.TIME_SCALE_OPTIONS 读。
   * 想加一档"极快"，只改数据文件即可。 */
  function buildSpeed(onTimeScale) {
    const wrap = document.getElementById('ctrl-speed');
    if (!wrap) {
      return;
    }

    const config = window.SOLAR_CONFIG || {};
    const options = config.TIME_SCALE_OPTIONS || [];
    const current = config.DEFAULT_TIME_SCALE;
    const buttons = [];

    options.forEach(function (opt) {
      const btn = h('button', 'btn', opt.label);
      btn.type = 'button';
      btn.setAttribute('data-rate', String(opt.rate));
      if (opt.hint) {
        btn.title = opt.hint;
      }
      if (opt.rate === current) {
        btn.classList.add('on');
      }

      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        onTimeScale(opt.rate);
      });

      buttons.push(btn);
      wrap.appendChild(btn);
    });
  }

  /* ---------- ② 轨道比例 ---------- */
  function buildScale(onScaleMode) {
    const wrap = document.getElementById('ctrl-scale');
    if (!wrap) {
      return;
    }

    const config = window.SOLAR_CONFIG || {};
    const options = config.SCALE_MODE_OPTIONS || [];
    const current = config.SCALE_MODE_DEFAULT;
    const buttons = [];

    options.forEach(function (opt) {
      const btn = h('button', 'btn', opt.label);
      btn.type = 'button';
      btn.setAttribute('data-mode', opt.mode);
      if (opt.hint) {
        btn.title = opt.hint;
      }
      if (opt.mode === current) {
        btn.classList.add('on');
      }

      btn.addEventListener('click', function () {
        buttons.forEach(function (b) { b.classList.remove('on'); });
        btn.classList.add('on');
        onScaleMode(opt.mode);
      });

      buttons.push(btn);
      wrap.appendChild(btn);
    });
  }

  /* ---------- ③ 教学对比 ----------
   * PRD F3-③ 要的是「直观看到内外行星的公转快慢差异」。
   *
   * 这里刻意不靠"把速度调到极快"来实现：
   * 水星周期 88 天、海王星 59800 天，相差 680 倍 ——
   * 速度调到能看清水星，海王星就几乎不动；调到海王星明显在动，水星就糊成一片。
   * 所以改用「把周期本身画成条」来对比：一眼就能看出差多少，不依赖动画速度。 */
  function fillComparePanel(panel) {
    const bodies = (window.SOLAR_BODIES || []).filter(function (b) {
      return b.type === 'planet' && typeof b.orbitalPeriodDays === 'number';
    });
    if (!bodies.length) {
      return;
    }

    // 快的排前面
    const sorted = bodies.slice().sort(function (a, b) {
      return a.orbitalPeriodDays - b.orbitalPeriodDays;
    });

    const earth = sorted.filter(function (b) { return b.id === 'earth'; })[0];
    const baseDays = earth ? earth.orbitalPeriodDays : YEAR_DAYS;

    // 周期跨度太大（0.24 年 ~ 163.7 年），线性画会让水星缩成看不见，
    // 所以按「数量级」定位条的长度。
    const logs = sorted.map(function (b) {
      return Math.log10(b.orbitalPeriodDays / baseDays);
    });
    const lo = logs[0];
    const hi = logs[logs.length - 1];
    const span = (hi - lo) || 1;

    const mercury = sorted[0];

    panel.appendChild(h('h3', 'compare-title', '绕太阳一圈，各要多久'));
    panel.appendChild(h('p', 'compare-sub',
      '条越长 = 绕一圈越久 = 走得越慢。四条内行星挤在左边，外行星一路拉到右边——'
      + '这个差距就是「公转周期」。'));

    const list = h('div', 'compare-list');

    sorted.forEach(function (body, i) {
      const pct = 8 + (logs[i] - lo) / span * 92;
      const isEarth = body.id === 'earth';

      const row = h('div', 'cyc-line' + (isEarth ? ' is-earth' : ''));

      row.appendChild(h('span', 'cyc-name', body.nameZh));

      const bar = h('span', 'cyc-bar');
      const fill = h('i', 'cyc-fill');
      fill.style.width = pct.toFixed(1) + '%';
      fill.style.background = (body.appearance && body.appearance.mainColor) || '#7fa8e0';
      bar.appendChild(fill);
      row.appendChild(bar);

      // 数字精度和资料卡保持一致：
      // 不到一年用两位小数（水星 0.24 年），超过一年用一位（木星 11.9 年）
      const years = body.orbitalPeriodDays / YEAR_DAYS;
      const numText = trimNum((years >= 1 ? years.toFixed(1) : years.toFixed(2))) + ' 年';
      row.appendChild(h('span', 'cyc-num', numText));

      list.appendChild(row);
    });

    panel.appendChild(list);

    if (mercury && mercury.orbitalPeriodDays > 0) {
      const turns = Math.round(baseDays / mercury.orbitalPeriodDays);
      panel.appendChild(h('p', 'compare-foot',
        '「年」按地球的一年算。地球绕完 1 圈的时间里，' + mercury.nameZh
        + '已经绕了约 ' + turns + ' 圈。'));
    }
  }

  function buildCompare(onCompare) {
    const btn = document.getElementById('ctrl-compare');
    const panel = document.getElementById('compare-panel');
    if (!btn || !panel) {
      return;
    }

    if (!panel.childNodes.length) {
      fillComparePanel(panel);
    }

    btn.addEventListener('click', function () {
      const willOpen = panel.hidden;
      panel.hidden = !willOpen;
      btn.setAttribute('aria-expanded', String(willOpen));
      btn.classList.toggle('on', willOpen);
      onCompare(willOpen);
    });
  }

  /* ---------- 对外接口（TECH_DESIGN 第 4 节）---------- */
  function initControls(handlers) {
    const opts = handlers || {};
    const onTimeScale = opts.onTimeScale || function () {};
    const onScaleMode = opts.onScaleMode || function () {};
    const onCompare = opts.onCompare || function () {};

    buildSpeed(onTimeScale);
    buildScale(onScaleMode);
    buildCompare(onCompare);
  }

  window.initControls = initControls;

  document.addEventListener('DOMContentLoaded', function () {
    /* 默认接线：把调控区接到 2D 主图的调控接口上。
       之所以绕一层 initControls 而不是直接调 setTimeScale，
       是为了守住 TECH_DESIGN 第 4 节的接口约定 ——
       将来若换一个渲染模块，只需要改这一处接线。 */
    initControls({
      onTimeScale: function (rate) {
        window.setTimeScale(rate);
      },
      onScaleMode: function (mode) {
        window.setScaleMode(mode);
      },
      onCompare: function () {
        // 面板的展开／收起在 buildCompare 里已经做完了，
        // 这里只对"用户打开了教学对比"这件事做个通知，留给后续引导主线用。
      }
    });
  });
})();
