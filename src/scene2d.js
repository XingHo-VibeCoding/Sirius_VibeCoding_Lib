/* ============================================================
 * src/scene2d.js —— 2D 主图（用 SVG 画）＋ 点击与资料卡
 * ------------------------------------------------------------
 * 职责（TECH_DESIGN.md 第 4 节）：画轨道与天体、处理点击与缩放平移。
 * 对外接口：render2d(bodies, options)、onBodyClick(callback)
 *
 * Day 7 第 2 步：数据补齐到 11 个天体后，【尺度映射必须重做】，
 * 原因见下面 orbitRadiusPx 的说明。
 *
 * Day 7 第 3 步（本步新增）：点击天体 → 弹出资料卡。
 *   依据：PRD 3.3 F2（资料卡）、PRD 5.2-3（四项数据）、
 *         PRD 5.2-4（数字必须配图形化对比）、
 *         PRD 5.2-5（面向零基础，术语就地解释）、
 *         TECH_DESIGN 6-2 / 6-3（字段缺失显示"资料待补"、来源未确认要标出）
 *
 * 尚未实现的（留给后续步骤）：缩放平移、调控区（controls.js）、3D 聚焦（focus3d.js）。
 * ============================================================ */

(function () {
  'use strict';

  const SVG_NS = 'http://www.w3.org/2000/svg';
  const AU_KM = 149597870.7;   // 1 天文单位 = 149,597,870.7 km（定义值）

  /* ---------- 尺度映射（两种模式）----------
   * 真实距离跨度极大：
   *   · 水星 0.387 au → 海王星 30.07 au，相差约 78 倍
   *   · 哈雷彗星远日点更到 35.3 au，而且它的轨道极扁（e = 0.968）
   *
   * 两种模式的区别：
   *   illustrative（图示比例，默认）—— 对距离做幂压缩，各轨道拉开，看得清每一颗
   *   true        （真实比例）    —— 距离线性映射，不做压缩
   *
   * 真实比例下内行星会挤成很小一团（水星到火星只占整幅画面的一小块），
   * 这不是画错，恰恰是「太阳系其实非常空旷」这个教学点。
   *
   * ⚠️ 两种模式都是「图示」，都不代表真实的比例关系（PRD 第 7 节：不引入真实星历）。
   */
  const R_MIN = 80;          // 最内（水星轨道）的像素半径
  const R_MAX = 440;         // 最外（哈雷彗星远日点）的像素半径
  const DIST_POWER = 0.25;   // 幂指数：越小，外圈压得越狠
  const AU_INNER = 0.387;    // 水星平均距离（au）
  const AU_OUTER = 35.3;     // 哈雷彗星远日点（au）

  const _dInner = Math.pow(AU_INNER, DIST_POWER);
  const _dOuter = Math.pow(AU_OUTER, DIST_POWER);

  /* 当前尺度模式。由 setScaleMode() 改。 */
  let scaleMode = 'illustrative';

  function orbitRadiusPx(au) {
    const d = Math.max(au, 0);
    let v;
    if (scaleMode === 'true') {
      v = (d - AU_INNER) / (AU_OUTER - AU_INNER);
    } else {
      v = (Math.pow(d, DIST_POWER) - _dInner) / (_dOuter - _dInner);
    }
    return R_MIN + v * (R_MAX - R_MIN);
  }

  /* ---------- 动画状态（模块级，跨重绘保持）----------
   * 为什么放在函数外面：切换尺度比例时要整幅重画，
   * 如果时间基准是 render2d 里的局部变量，重画会让所有天体瞬间跳回起点。
   * 放在模块级，"已经过去了多少天"在重画前后是连续的，天体不会跳。
   */
  let timeScale = 100;        // 天/秒（暂停 = 0）
  let elapsedDays = 0;        // 累计过去了多少天
  let lastFrameAt = 0;
  let frameToken = 0;         // 让被替换掉的旧动画循环自己退出

  /* 椭圆轨道的极坐标标准式（焦点在太阳，即原点）：
     给定半长轴 a、偏心率 e，返回真近点角 nu 处「到太阳的距离」。
     用这个式子，哈雷彗星那种极扁的轨道也能被正确表达。 */
  function radiusAt(a, e, nu) {
    return a * (1 - e * e) / (1 + e * Math.cos(nu));
  }

  /* 天体圆盘半径。
     真实直径比太极端（太阳是地球的 109 倍、地球是哈雷的 1160 倍），
     所以用四次方根压缩，并压小系数，保证内行星的圆点不会互相叠住。 */
  function bodyRadiusPx(diameterKm) {
    return 2.0 + Math.pow(diameterKm, 0.25) * 0.55;
  }

  /* 哪些天体在主图上画环。木星和天王星的环极暗，画出来反而失真，
     所以只画最显著的土星环（PRD 5.2-6：外观需与实际相符）。 */
  const RING_VISIBLE_ON_2D = ['saturn'];

  function el(tag, attrs) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) {
      node.setAttribute(k, attrs[k]);
    }
    return node;
  }

  function clear(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  /* 太阳的光晕用 SVG 径向渐变来做，边缘才会自然淡出。
     用实心半透明圆会留下一圈生硬的边，看着像个灰盘子。 */
  function buildDefs(svg) {
    const defs = el('defs', {});
    const grad = el('radialGradient', { id: 'sun-glow' });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#F2B230', 'stop-opacity': '0.55' }));
    grad.appendChild(el('stop', { offset: '35%', 'stop-color': '#F2B230', 'stop-opacity': '0.20' }));
    grad.appendChild(el('stop', { offset: '70%', 'stop-color': '#F2B230', 'stop-opacity': '0.05' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#F2B230', 'stop-opacity': '0' }));
    defs.appendChild(grad);
    svg.appendChild(defs);
  }

  /* 把轨道采样成一条闭合路径。
     不能用 <ellipse>：因为像素半径是「距离」的压缩函数，
     映射之后形状已经不是标准椭圆了（哈雷彗星尤其明显）。 */
  function buildOrbitPath(a, e) {
    const SEGMENTS = 240;
    let d = '';
    for (let i = 0; i <= SEGMENTS; i++) {
      const nu = (i / SEGMENTS) * Math.PI * 2;
      const R = orbitRadiusPx(radiusAt(a, e, nu));
      d += (i === 0 ? 'M' : 'L') + (R * Math.cos(nu)).toFixed(1) + ' ' + (R * Math.sin(nu)).toFixed(1) + ' ';
    }
    return d + 'Z';
  }

  /* ============================================================
   * 资料卡（Day 7 第 3 步新增）
   * ------------------------------------------------------------
   * 为什么放在这个文件里、不新建文件：
   *   TECH_DESIGN 第 4 节把「处理点击」划归 2D 主图模块，资料卡是点击的
   *   直接响应；项目结构（TECH_DESIGN 第 2 节）里也没有资料卡这个文件。
   *   AGENTS.md 八.2 规定新文件必须落在既定目录里，所以不新建。
   * ============================================================ */

  const MISSING = '资料待补';       // TECH_DESIGN 6-2 规定的缺字段显示
  const NOT_APPLICABLE = '不适用';  // 该项对这个天体本身没有意义（如太阳的"公转周期"）

  const TYPE_ZH = {
    star: '恒星',
    planet: '行星',
    moon: '卫星（绕行星运行）',
    comet: '彗星',
    region: '区域'
  };

  /* 对比条的位置。
     天体之间的数值跨度极大（太阳直径是哈雷彗星的约 12 万倍），
     若按数值线性画，小的那个会缩成一个点什么都看不出。
     所以改用「数量级」定位：比值每差 10 倍，位置移动固定的一格。
     地球固定在正中间（50%）当参照，一目了然。

     为什么是 2.5：这个数字决定"多少倍就顶格"。
     取 2.0 时，海王星（163.7 倍）和哈雷彗星（75.8 倍）会双双被压到最右端
     看成一样长——而它们其实差了一倍多，这是实测发现的问题。
     放宽到 2.5（覆盖约 300 倍）后，两者才拉得开。 */
  const CMP_LOG_SPAN = 2.5;

  function cmpPercent(ratio) {
    if (typeof ratio !== 'number' || !isFinite(ratio) || ratio <= 0) {
      return null;
    }
    const pct = 50 + (Math.log10(ratio) / CMP_LOG_SPAN) * 50;
    return Math.max(3, Math.min(97, pct));
  }

  /* ---------- 数值格式化（中文习惯，数字太大就换单位）---------- */

  function trimZero(s) {
    return s.indexOf('.') >= 0 ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
  }

  function groupNum(n) {
    return Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }

  function formatDiameter(km) {
    return groupNum(km) + ' km';
  }

  function formatDistance(km) {
    if (km === 0) {
      return null;
    }
    if (km >= 1e8) {
      return trimZero((km / 1e8).toFixed(2)) + ' 亿 km';
    }
    if (km >= 1e4) {
      return trimZero((km / 1e4).toFixed(1)) + ' 万 km';
    }
    return groupNum(km) + ' km';
  }

  function formatPeriod(days) {
    // 超过一年就顺带换算成"年"：地球 365.2 天 →"约 1 年"，
    // 这样"绕一圈要多久"和"年"这个日常概念才对得上。
    // 位数按量级选：不到 1000 天的保留一位小数（365.2 不能被抹成 365），
    // 上千天的一律取整并加千分位（27,700 天）。
    if (days >= 365) {
      const d = days >= 1000 ? groupNum(days) : trimZero(days.toFixed(1));
      return d + ' 天（约 ' + trimZero((days / 365.25).toFixed(1)) + ' 年）';
    }
    return trimZero(days.toFixed(1)) + ' 天';
  }

  /* 倍数写法。注意 v 可能是 0.00086 这种极小值，不能直接用 toFixed(1)。 */
  function formatRatio(v) {
    if (v === 1) {
      return '1 倍（就是地球本身）';
    }
    if (v < 0.01) {
      return v.toFixed(4) + ' 倍';
    }
    return trimZero(v.toFixed(2)) + ' 倍';
  }

  /* 区分三种"没有值"：
       undefined → 字段缺失 → 「资料待补」（TECH_DESIGN 6-2）
       null      → 这一项对该天体无意义 → 「不适用」
       有值      → 倍数 */
  function ratioText(v) {
    if (v === undefined) {
      return MISSING;
    }
    if (v === null) {
      return NOT_APPLICABLE;
    }
    if (typeof v !== 'number' || !isFinite(v)) {
      return MISSING;
    }
    return formatRatio(v);
  }

  /* 按来源 URL 反查来源名称（DATA_SOURCES 在 bodies.js 里登记） */
  function sourceLabel(url) {
    const map = window.DATA_SOURCES || {};
    for (const key in map) {
      if (map[key].url === url) {
        return map[key].label;
      }
    }
    return 'NASA 官方资料';
  }

  /* ---------- 小工具：建元素 ---------- */

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

  /* 一项数据 = 标签 + 数值 + 白话解释 + （可选）对比条 */
  function buildFact(label, valueText, note, percent) {
    const box = h('div', 'fact');

    const head = h('div', 'fact-head');
    head.appendChild(h('span', 'fact-label', label));
    head.appendChild(h('span', 'fact-value', valueText));
    box.appendChild(head);

    if (note) {
      box.appendChild(h('p', 'fact-note', note));
    }

    if (typeof percent === 'number') {
      const cmp = h('div', 'cmp');
      const fill = h('i', 'cmp-fill');
      fill.style.width = percent.toFixed(1) + '%';
      cmp.appendChild(fill);
      cmp.appendChild(h('i', 'cmp-earth'));
      box.appendChild(cmp);
    }

    return box;
  }

  /* ---------- 渲染整张资料卡 ---------- */

  function renderBodyCard(body) {
    const card = document.getElementById('body-card');
    if (!card || !body) {
      return;
    }

    const isStar = body.type === 'star';
    const isMoon = !!body.parentId;               // 月球：绕地球而不是绕太阳
    const cmp = body.compareToEarth || {};

    /* ---- 标题 ---- */
    const title = document.getElementById('card-title');
    title.textContent = '';
    const dot = h('i', 'card-dot');
    dot.style.background = (body.appearance && body.appearance.mainColor) || '#8e9ab5';
    title.appendChild(dot);
    title.appendChild(h('span', null, body.nameZh));
    if (body.nameEn) {
      title.appendChild(h('span', 'card-en', body.nameEn));
    }

    document.getElementById('card-type').textContent = TYPE_ZH[body.type] || '天体';

    /* ---- 四项数据（PRD 5.2-3 硬性要求）---- */
    const facts = document.getElementById('card-facts');
    facts.textContent = '';

    // ① 直径
    const diaOk = typeof body.diameterKm === 'number' && isFinite(body.diameterKm);
    facts.appendChild(buildFact(
      '直径',
      diaOk ? formatDiameter(body.diameterKm) : MISSING,
      '从它的一边穿到另一边有多长',
      cmpPercent(cmp.diameter)
    ));

    // ② 距日平均距离
    let distValue, distNote, distPct;
    if (isStar) {
      distValue = NOT_APPLICABLE;
      distNote = '太阳就是整个太阳系的中心，谈不上"离太阳有多远"。';
      distPct = null;
    } else if (isMoon) {
      // 月球跟着地球绕太阳，算"离太阳多远"没有意义；
      // 它真正有意义的距离是"离地球多远"。
      distValue = formatDistance(body.distanceFromParentKm) || MISSING;
      distNote = '这是它离【地球】的平均距离。月球是地球的卫星，它跟着地球一起绕太阳走，'
               + '所以它到太阳的距离和地球差不多。';
      distPct = null;
    } else {
      const auVal = body.distanceFromSunKm / AU_KM;
      const auText = trimZero((auVal >= 10 ? auVal.toFixed(1) : auVal.toFixed(2)));
      distValue = (formatDistance(body.distanceFromSunKm) || MISSING)
                + '（约 ' + auText + ' 个天文单位）';
      distNote = '它离太阳有多远（行星走的是椭圆轨道，这里取平均值）。'
               + '「天文单位」是天文学里量太阳系距离的尺子——1 个天文单位就是地球到太阳的距离，约 1.5 亿公里。';
      distPct = cmpPercent(cmp.distance);
    }
    facts.appendChild(buildFact('距日平均距离', distValue, distNote, distPct));

    // ③ 公转周期
    let perValue, perNote;
    if (isStar) {
      perValue = NOT_APPLICABLE;
      perNote = '太阳不绕谁转——是别的天体都在绕着它转。';
    } else if (isMoon) {
      perValue = formatPeriod(body.orbitalPeriodDays) + '（绕地球一圈）';
      perNote = '注意：这是它绕【地球】转一圈的时间，不是绕太阳。';
    } else {
      perValue = typeof body.orbitalPeriodDays === 'number'
        ? formatPeriod(body.orbitalPeriodDays)
        : MISSING;
      perNote = '它绕太阳跑完一整圈要多久。数字越大，说明它走得越慢。';
    }
    facts.appendChild(buildFact(
      '公转周期',
      perValue,
      perNote,
      typeof body.orbitalPeriodDays === 'number' && !isStar ? cmpPercent(cmp.period) : null
    ));

    /* ---- 与地球对比（四项中的第四项）---- */
    const compare = document.getElementById('card-compare');
    compare.textContent = '';
    compare.appendChild(h('h3', null, '和地球比'));
    compare.appendChild(h('p', 'compare-hint',
      '把地球当成 1：大于 1 表示这项比地球大／远／久，小于 1 表示更小／更近／更快。'));

    const rows = [
      ['大小', cmp.diameter],
      ['离太阳的距离', isMoon ? null : cmp.distance],
      ['公转一圈的时间', cmp.period]
    ];

    rows.forEach(function (row) {
      const line = h('div', 'compare-row');
      line.appendChild(h('span', 'compare-label', row[0]));
      line.appendChild(h('span', 'compare-value', ratioText(row[1])));
      compare.appendChild(line);
    });

    if (isStar) {
      compare.appendChild(h('p', 'compare-hint',
        '太阳在"离太阳的距离"和"公转一圈的时间"上都没有意义——它就是那个中心。'));
    }
    if (isMoon) {
      compare.appendChild(h('p', 'compare-hint',
        '月球在"离太阳的距离"上不做比较：它跟着地球走，离太阳的距离和地球几乎一样。'));
    }

    /* ---- 来源标注（PRD 5.1 / 数据规则：每条数值必须能指出来源）---- */
    const src = document.getElementById('card-source');
    src.textContent = '';

    if (body.sourceStatus === 'pending') {
      // TECH_DESIGN 6-3：来源未确认的数据不允许悄悄展示
      src.appendChild(h('span', 'source-warn', '来源待确认，数值仅供参考'));
      src.appendChild(document.createElement('br'));
    }

    src.appendChild(h('span', null, '数据来源：'));
    const link = document.createElement('a');
    link.href = body.source || '#';
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = sourceLabel(body.source);
    link.title = body.source || '';
    src.appendChild(link);

    card.hidden = false;
  }

  function hideBodyCard() {
    const card = document.getElementById('body-card');
    if (card) {
      card.hidden = true;
    }
  }

  /* 对外接口：注册点击回调（TECH_DESIGN 第 4 节）。
     后续 3D 聚焦通过它接上，不需要改这个文件。 */
  let clickHandler = null;

  function onBodyClick(callback) {
    clickHandler = typeof callback === 'function' ? callback : null;
  }

  /* ---------- 调控接口（TECH_DESIGN 第 4 节）----------
     由 src/controls.js 调用。 */

  function setTimeScale(rate) {
    if (typeof rate !== 'number' || !isFinite(rate) || rate < 0) {
      return;
    }
    timeScale = rate;   // 0 = 暂停
  }

  /* 切换比例必须整幅重画——每条轨道的形状和半径都变了。
     重画不会让天体跳回起点：时间基准（elapsedDays）是模块级的，前后连续。 */
  function setScaleMode(mode) {
    if (mode !== 'illustrative' && mode !== 'true') {
      return;
    }
    if (mode === scaleMode) {
      return;
    }
    scaleMode = mode;
    if (window.SOLAR_BODIES) {
      render2d(window.SOLAR_BODIES, { mountId: 'solar-scene' });
    }
  }

  function render2d(bodies, options) {
    const opts = options || {};
    const svg = document.getElementById(opts.mountId || 'solar-scene');
    if (!svg || !bodies) {
      return;
    }

    // 坐标原点放在画布中心，太阳就在 (0,0)
    svg.setAttribute('viewBox', '-450 -450 900 900');
    clear(svg);
    buildDefs(svg);

    const movingBodies = [];
    let phaseIndex = 0;

    bodies.forEach(function (body) {
      // 绕行星转的卫星（月球）不画进日心轨道图：
      // PRD F1 的整体视图只要求「太阳 + 八大行星沿各自轨道运行」。
      // 月球的数据照样保留，供资料卡与 3D 聚焦使用。
      if (body.parentId) {
        return;
      }

      const au = body.distanceFromSunKm / AU_KM;
      const e = typeof body.eccentricity === 'number' ? body.eccentricity : 0;
      const isStar = body.type === 'star';

      // ---- 轨道线（太阳没有轨道）----
      if (!isStar && au > 0) {
        svg.appendChild(el('path', {
          d: buildOrbitPath(au, e),
          'data-orbit-for': body.id,
          fill: 'none',
          stroke: 'rgba(255,255,255,0.28)',
          'stroke-width': 1
        }));
      }

      // ---- 天体本体 ----
      const r = bodyRadiusPx(body.diameterKm);

      // 初始相位：纯粹为了让画面上的天体不要挤在同一条线上。
      // 它是示意值，不代表真实位置（PRD 第 7 节：不引入真实星历）。
      const phase = isStar ? 0 : phaseIndex++ * 0.9;

      // 土星环（画在球体下面，避免盖住球）
      let ring = null;
      if (RING_VISIBLE_ON_2D.indexOf(body.id) >= 0 && body.appearance.hasRing) {
        ring = el('ellipse', {
          cx: 0, cy: 0,
          rx: r * 2.1, ry: r * 0.72,
          fill: 'none',
          stroke: 'rgba(227,206,150,0.75)',
          'stroke-width': 1.5
        });
        svg.appendChild(ring);
      }

      const dot = el('circle', {
        r: r,
        fill: body.appearance.mainColor,
        stroke: 'rgba(255,255,255,0.35)',
        'stroke-width': 0.8,
        'data-body-id': body.id,
        style: 'cursor:pointer'
      });

      /* 透明命中圈。
         天体本身很小（手机上内行星的圆点只有两三个像素），
         直接点几乎点不中，所以在球体上面盖一个更大的透明圆专门接点击。
         半径取「球体半径 + 8，且不小于 14 像素单位」——
         再大就会让相邻的内行星彼此挡住。 */
      const hit = el('circle', {
        r: Math.max(r + 8, 14),
        fill: 'transparent',
        'pointer-events': 'all',
        'data-hit-for': body.id,
        style: 'cursor:pointer'
      });

      if (isStar) {
        // 太阳固定在中心 + 一层柔光
        dot.setAttribute('cx', 0);
        dot.setAttribute('cy', 0);
        hit.setAttribute('cx', 0);
        hit.setAttribute('cy', 0);
        svg.appendChild(el('circle', { cx: 0, cy: 0, r: r * 3, fill: 'url(#sun-glow)' }));
        svg.appendChild(dot);
        svg.appendChild(hit);
      } else {
        // 先按初始相位把位置算好，再挂上去。
        // 否则在第一帧动画执行之前，所有天体的坐标还是默认的 0，
        // 会全部堆在太阳上——若页面在后台标签页打开（requestAnimationFrame
        // 会被浏览器暂停），这个"堆在中心"的状态会一直保留。
        const x0 = orbitRadiusPx(radiusAt(au, e, phase));
        const px0 = (x0 * Math.cos(phase)).toFixed(1);
        const py0 = (x0 * Math.sin(phase)).toFixed(1);
        dot.setAttribute('cx', px0);
        dot.setAttribute('cy', py0);
        hit.setAttribute('cx', px0);
        hit.setAttribute('cy', py0);
        if (ring) {
          ring.setAttribute('cx', px0);
          ring.setAttribute('cy', py0);
        }

        svg.appendChild(dot);
        svg.appendChild(hit);
        movingBodies.push({ body: body, node: dot, hit: hit, ring: ring, a: au, e: e, phase: phase });
      }
    });

    /* ---------- 动画 ----------
     * 角速度 = 2π ÷ 公转周期。周期越长转得越慢 ——
     * 这正是 PRD F3「教学对比」想让人看见的差异，先让它自然发生。
     *
     * 简化说明：真近点角随时间均匀增加，不模拟开普勒第二定律（近日点更快）。
     * 符合 PRD 第 7 节「不引入真实星历」的边界。
     */
    const myToken = ++frameToken;

    function frame(now) {
      // 已经被新的一次渲染接管了 → 这个循环自己退出。
      // 否则每切换一次比例就会多出一个循环，速度会越跑越快。
      if (myToken !== frameToken) {
        return;
      }

      if (!lastFrameAt) {
        lastFrameAt = now;
      }
      const dt = (now - lastFrameAt) / 1000;
      lastFrameAt = now;
      elapsedDays += dt * timeScale;

      movingBodies.forEach(function (item) {
        const period = item.body.orbitalPeriodDays;
        if (!period) {
          return;
        }

        const nu = item.phase + (elapsedDays / period) * Math.PI * 2;
        const R = orbitRadiusPx(radiusAt(item.a, item.e, nu));
        const x = R * Math.cos(nu);
        const y = R * Math.sin(nu);

        item.node.setAttribute('cx', x.toFixed(1));
        item.node.setAttribute('cy', y.toFixed(1));
        item.hit.setAttribute('cx', x.toFixed(1));
        item.hit.setAttribute('cy', y.toFixed(1));

        if (item.ring) {
          item.ring.setAttribute('cx', x.toFixed(1));
          item.ring.setAttribute('cy', y.toFixed(1));
        }
      });

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);

    /* ---------- 点击交互（Day 7 第 3 步新增）----------
       用事件委托：只在 svg 上挂一个监听，而不是给每个天体各挂一个。
       好处是以后天体的数量、位置怎么变，都不用重新绑定。 */
    svg.addEventListener('click', function (ev) {
      const target = ev.target;
      const node = target && target.closest
        ? target.closest('[data-body-id],[data-hit-for]')
        : null;

      if (!node) {
        // 点到空白处 → 收起资料卡
        hideBodyCard();
        return;
      }

      const id = node.getAttribute('data-body-id') || node.getAttribute('data-hit-for');
      const found = bodies.filter(function (b) { return b.id === id; })[0];
      if (!found) {
        return;
      }

      renderBodyCard(found);

      /* 打开 3D 特写（TECH_DESIGN 第 4 节的接口名 openFocus）。
         用「存在性判断」而不是直接调：这样 3D 模块没加载、加载失败、
         或被人用 ENABLE_3D 关掉时，资料卡照常显示，页面不会整块坏掉
         —— 对应 TECH_DESIGN 第 6 节「任何一块坏掉都不能白屏」。 */
      if (typeof window.openFocus === 'function') {
        window.openFocus(found.id);
      }

      // 对外抛出点击事件（TECH_DESIGN 第 4 节接口约定）。
      if (clickHandler) {
        clickHandler(found);
      }
    });
  }

  /* 对外接口（TECH_DESIGN 第 4 节） */
  window.render2d = render2d;
  window.onBodyClick = onBodyClick;
  window.setTimeScale = setTimeScale;
  window.setScaleMode = setScaleMode;

  document.addEventListener('DOMContentLoaded', function () {
    const config = window.SOLAR_CONFIG || {};

    // 初始档位从配置读：改数据文件里的档位，页面自动跟着变
    if (typeof config.DEFAULT_TIME_SCALE === 'number') {
      timeScale = config.DEFAULT_TIME_SCALE;
    }
    if (config.SCALE_MODE_DEFAULT === 'illustrative' || config.SCALE_MODE_DEFAULT === 'true') {
      scaleMode = config.SCALE_MODE_DEFAULT;
    }

    if (window.SOLAR_BODIES) {
      render2d(window.SOLAR_BODIES, { mountId: 'solar-scene' });
    }

    const closeBtn = document.getElementById('card-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', hideBodyCard);
    }

    // 按 Esc 也能关掉资料卡（键盘操作时更顺手）
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        hideBodyCard();
      }
    });
  });
})();
