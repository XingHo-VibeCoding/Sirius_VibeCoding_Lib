/* ============================================================
 * src/catalog.js —— 天体目录（一列可点的卡片）
 * ------------------------------------------------------------
 * 为什么要有这个文件（Day 8 第 3 步）：
 *   主图是一张图，天体只是几个小圆点。对第一次打开的人（尤其是手机上），
 *   内行星的圆点只有两三个像素，"我该点哪里"并不直观。
 *   目录把 11 个天体列成卡片，给出名字和类型，点一下就等于在图上点了它一次。
 *
 * 职责（对应 PRD F2 资料卡的入口、TECH_DESIGN 第 4 节）：
 *   · 用本地数据渲染卡片列表
 *   · 处理卡片点击，转交给主图模块统一开的出口 selectBody(id)
 *   · 承担「加载中」这一种页面状态（另外三种见 src/states.js 的说明）
 *
 * 对外接口（TECH_DESIGN 第 4 节）：
 *   catalogBodies()      读数据，返回 Promise
 *   renderCatalog(bodies) 把数据画成卡片
 *   fillCatalog()         把上面两步串起来（= 真正的入口）
 * ============================================================ */

(function () {
  'use strict';

  /* ---------- 模拟异步耗时 ----------
   * 这一版的数据写死在 src/data/bodies.js 里，读它是"瞬间完成"的，
   * 页面上一帧都看不到"加载中"。而 Day 8 要做的正是四种页面状态，
   * 所以这里故意等一小会儿，让 loading 这个状态真的能被看见。
   *
   * 以后接真实接口时，只要把这段 setTimeout 换成真正的请求，
   * 调用方的写法完全不用动 —— 这就是把所有等待都包进 Promise 的好处。 */
  const LOAD_DELAY_MS = 420;

  /* 卡片上的类型标签。
     刻意写得比资料卡里短：资料卡有整行空间慢慢解释，
     卡片只有一个小角标的位置。长写法见 src/scene2d.js 的 TYPE_ZH。 */
  const TYPE_SHORT = {
    star: '恒星',
    planet: '行星',
    moon: '卫星',
    comet: '彗星',
    region: '区域'
  };

  /* 除"成功"以外三种状态各自要说的话。
     文案面向零基础：不出现"请求失败""数据异常"这类词，直接说人该做什么。
     error 那句特意指向主图区那颗按钮 —— 第 4 步之后页面上真的有一个
     「重新加载」可以点，就不该再叫用户自己去按浏览器刷新。 */
  const MESSAGES = {
    loading: '正在读取天体资料…',
    empty: '暂时没有可显示的天体资料。',
    error: '天体资料没能读取成功，点上面的「重新加载」再试一次。'
  };

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

  /* ============================================================
   * 状态切换
   * ------------------------------------------------------------
   * 只改容器上的 data-state 属性，具体长什么样由 CSS 决定
   * （styles/main.css 的 .catalog-body[data-state="..."]）。
   * 好处：状态和样子分开，改文案不用碰样式，改样子不用碰脚本。
   * ============================================================ */
  function setState(state, text) {
    const box = document.getElementById('catalog-body');
    if (!box) {
      return;
    }

    box.setAttribute('data-state', state);
    // 给读屏软件用：正在等候时标成"忙"，读完之后取消
    box.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

    const msgText = document.getElementById('catalog-msg-text');
    if (msgText) {
      const words = text !== undefined ? text : MESSAGES[state];
      msgText.textContent = words || '';
    }
  }

  /* ============================================================
   * 读数据
   * ------------------------------------------------------------
   * 永远返回 Promise，不管将来数据是从本地文件读还是从接口取，
   * 调用方的写法都一样。
   *
   * 三种结局分别对应三种状态，这也是 Day 8 要学的四态里的三种：
   *   resolve(非空数组) → 成功
   *   resolve(空数组)   → 空
   *   reject            → 错误
   * ============================================================ */
  function catalogBodies() {
    return new Promise(function (resolve, reject) {
      setTimeout(function () {
        const list = window.SOLAR_BODIES;
        if (!list) {
          reject(new Error('数据文件 src/data/bodies.js 没有加载成功'));
          return;
        }
        // 交一份副本出去：就算调用方拿去排序、删元素，也不会动到原数据
        resolve(list.slice());
      }, LOAD_DELAY_MS);
    });
  }

  /* ============================================================
   * 画卡片
   * ============================================================ */

  /* 一张卡片 = 色点 + 中文名 + 英文名 + 类型标签。
     用 <button> 而不是 <div>：键盘按 Tab 能走到、回车能触发，
     不用额外写键盘处理代码。 */
  function buildCard(body) {
    const li = h('li', 'cat-item');

    const btn = h('button', 'cat-card');
    btn.type = 'button';
    btn.setAttribute('data-body-id', body.id);

    /* 色点用数据里登记的实测色，不另外编一个
       （AGENTS.md 八.1：数据必须有出处；PRD 5.2-6：外观需与实际相符）。
       万一某个天体没登记颜色，就画一个空心圈，绝不悄悄上一个假颜色。 */
    const dot = h('span', 'cat-dot');
    const color = body.appearance && body.appearance.mainColor;
    if (color) {
      dot.style.background = color;
    } else {
      dot.classList.add('is-missing');
    }

    const names = h('span', 'cat-names');
    names.appendChild(h('span', 'cat-name-zh', body.nameZh || '未命名'));
    if (body.nameEn) {
      names.appendChild(h('span', 'cat-name-en', body.nameEn));
    }

    btn.appendChild(dot);
    btn.appendChild(names);
    btn.appendChild(h('span', 'cat-type', TYPE_SHORT[body.type] || '天体'));

    li.appendChild(btn);
    return li;
  }

  function renderCatalog(bodies) {
    const list = document.getElementById('catalog-list');
    const count = document.getElementById('catalog-count');
    if (!list) {
      return;
    }

    const items = bodies || [];

    while (list.firstChild) {
      list.removeChild(list.firstChild);
    }
    items.forEach(function (body) {
      list.appendChild(buildCard(body));
    });

    if (count) {
      count.textContent = items.length ? '共 ' + items.length + ' 个' : '';
    }
  }

  /* ============================================================
   * 把上面的东西串起来 = 真正的入口
   * ============================================================ */
  function fillCatalog() {
    setState('loading');

    return catalogBodies().then(
      function (list) {
        // 先把卡片铺好，再切状态：这样切到"成功"的那一刻，
        // 列表已经在 DOM 里了，不会出现"状态成功了但列表是空的"一闪。
        renderCatalog(list);

        if (!list.length) {
          setState('empty');
          return list;
        }

        setState('success');
        return list;
      },
      function (err) {
        setState('error');
        if (window.console && console.warn) {
          console.warn('[catalog] 天体资料读取失败：', err && err.message);
        }
        return [];
      }
    );
  }

  /* ---------- 等过渡屏让路，再开始读 ----------
   * 为什么不立刻读：过渡屏正盖着整页，这时候读完了用户也看不见，
   * "加载中"这个状态就等于白做。等它让路再读，用户才会真的看到那 0.4 秒。
   * 过渡屏自己最晚 4 秒必让路（src/states.js 的 MAX_HOLD_MS），
   * 这里再压一个 5 秒兜底，防止它因为意外一直不退。 */
  function whenIntroDone(callback) {
    const ov = document.getElementById('intro-overlay');
    if (!ov || ov.hidden) {
      callback();
      return;
    }

    let done = false;
    let timer = 0;
    let bail = 0;

    function fire() {
      if (done) {
        return;
      }
      done = true;
      clearInterval(timer);
      clearTimeout(bail);
      callback();
    }

    timer = setInterval(function () {
      if (ov.hidden || getComputedStyle(ov).visibility === 'hidden') {
        fire();
      }
    }, 100);
    bail = setTimeout(fire, 5000);
  }

  /* ---------- 点卡片 ----------
   * 事件委托：只在列表上挂一个监听，而不是给 11 张卡片各挂一个。
   * 好处是以后天体数量怎么变都不用重新绑定（和主图的点击是同一个思路）。 */
  function onListClick(ev) {
    const btn = ev.target && ev.target.closest ? ev.target.closest('.cat-card') : null;
    if (!btn) {
      return;
    }

    const id = btn.getAttribute('data-body-id');

    /* 转交给主图模块统一开的出口（TECH_DESIGN 第 4 节 selectBody）。
       用存在性判断而不是直接调：万一 scene2d.js 没加载成功，
       结果只是"卡片点了没反应"，而不是整块脚本报错、页面白屏
       —— 对应 TECH_DESIGN 第 6 节「任何一块坏掉都不能白屏」。 */
    if (typeof window.selectBody === 'function') {
      window.selectBody(id);
    }
  }

  window.catalogBodies = catalogBodies;
  window.renderCatalog = renderCatalog;
  window.fillCatalog = fillCatalog;

  document.addEventListener('DOMContentLoaded', function () {
    const list = document.getElementById('catalog-list');
    if (list) {
      list.addEventListener('click', onListClick);
    }
    whenIntroDone(fillCatalog);
  });
})();
