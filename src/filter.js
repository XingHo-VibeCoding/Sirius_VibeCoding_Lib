/* ============================================================
 * src/filter.js —— 天体目录的筛选（Day 12）
 * ------------------------------------------------------------
 * 为什么独立成文件：
 *   catalog.js 管「怎么把天体画成卡片」，这里管「哪些天体该被画出来」。
 *   两件事，分开放 —— 改筛选逻辑不用碰渲染，改卡片长相不用碰筛选。
 *
 * 它不自己读数据，而是等 catalog.js 铺好目录后发来的 catalog:ready 事件。
 * 这样"目录上显示的"和"筛选拿到的"必然是同一份，也不用把数据读两遍。
 *
 * 筛选的动作 = 把过滤后的数组交给 window.renderCatalog 重新画一遍，
 * 所以架构上没有新增第二条渲染路径。
 *
 * ---- 三种状态（Day 12 的验收标准）----
 *   有结果   ：点「行星」                  → 8 张卡片，计数「共 8 个」
 *   无结果   ：「行星」+ 搜「月」          → 0 张，data-state="no-match"
 *   清空恢复 ：点「全部」或「清空筛选」    → 11 张卡片，计数「共 11 个」
 *
 * ---- 两个刻意的决定 ----
 * 1. 「筛出 0 个」用的是新状态 no-match，**不复用 empty**。
 *    因为 empty 说的是"数据源本身就没有资料"（用户无事可做），
 *    no-match 说的是"这次筛选没命中"（清空就能恢复，所以给按钮）。
 *    判据还是 Day 8 那条：用户做点什么，有没有用。
 * 2. renderCatalog 在 0 个时会把计数留空 —— 那是给 empty 用的。
 *    筛选态下「共 0 个」是要紧的信息，所以这里补上。
 * ============================================================ */

(function () {
  'use strict';

  /* 类型标签。和 catalog.js 里的 TYPE_SHORT 是同一套说法 ——
     这里再抄一份而不是互相引用：两个模块各自独立，
     少一条隐式依赖就少一个"改了这边忘了那边"的机会。 */
  const TYPE_ZH = {
    star: '恒星',
    planet: '行星',
    moon: '卫星',
    comet: '彗星',
    region: '区域'
  };

  /* 类型按钮的排列顺序。用固定顺序而不是"数据里出现的顺序"：
     否则顺序会随数据变，用户每次看到的按钮位置都不一样。 */
  const TYPE_ORDER = ['star', 'planet', 'moon', 'comet', 'region'];

  const ALL = 'all';

  /* 筛不出东西时说的话。
     和 catalog.js 的 MESSAGES.empty（"暂时没有可显示的天体资料。"）**刻意不同**：
     那句说的是"这里本来就没东西"，这句说的是"你这次的条件没命中"。 */
  const NO_MATCH_TEXT = '没有符合条件的天体。';

  let allBodies = [];   // 筛选的原料（来自 catalog:ready）
  let curType = ALL;
  let curKeyword = '';

  function $(id) {
    return document.getElementById(id);
  }

  /* ---------- 判定一条数据符不符合当前条件 ---------- */
  function matches(body, type, keyword) {
    if (type !== ALL && body.type !== type) {
      return false;
    }
    if (!keyword) {
      return true;
    }
    /* 中文名、英文名、id 都能搜到：
       用户可能记得"木星"，也可能记得"Jupiter"。 */
    const hay = [body.nameZh, body.nameEn, body.id].filter(Boolean).join(' ').toLowerCase();
    return hay.indexOf(keyword) !== -1;
  }

  function filterBodies(list, type, keyword) {
    return list.filter(function (b) {
      return matches(b, type, keyword);
    });
  }

  /* 当前是不是"筛选态"。用来决定 0 个结果时要不要补计数。 */
  function isFiltering() {
    return curType !== ALL || curKeyword !== '';
  }

  /* ---------- 改状态：只动 data-state 属性 ----------
     沿用 catalog.js 定的机制（属性 + CSS 决定长相），不另造一套。
     这里只是多引入一个取值 no-match；
     其余状态（loading / empty / error / success）的文案仍归 catalog.js 管。 */
  function setBodyState(state, text) {
    const box = $('catalog-body');
    if (!box) {
      return;
    }
    box.setAttribute('data-state', state);
    // 和 catalog.js 一致：只在等候时标"忙"
    box.setAttribute('aria-busy', state === 'loading' ? 'true' : 'false');

    const msgText = $('catalog-msg-text');
    if (msgText) {
      msgText.textContent = text || '';
    }
  }

  /* ---------- 按数据生成类型按钮 ---------- */
  function buildTypeButtons(list) {
    const box = $('filter-types');
    if (!box) {
      return;
    }

    /* 只列出**数据里真实出现过**的类型：
       万一某个类型的最后一个天体哪天被删了，按钮也跟着消失，
       不会留下一个点了没反应的死按钮。 */
    const used = {};
    list.forEach(function (b) {
      if (b.type) {
        used[b.type] = true;
      }
    });

    const types = TYPE_ORDER.filter(function (t) {
      return used[t];
    });

    while (box.firstChild) {
      box.removeChild(box.firstChild);
    }

    [ALL].concat(types).forEach(function (type) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'btn btn-filter';
      btn.setAttribute('data-filter-type', type);
      btn.textContent = type === ALL ? '全部' : (TYPE_ZH[type] || type);
      box.appendChild(btn);
    });
  }

  /* ---------- 把选中态同步到按钮上 ----------
     用 aria-pressed 而不是 .on 类：它一个属性同时干了
     "告诉读屏这是个按下的开关"和"驱动视觉"两件事。
     （.btn.on 是调控区在用的写法，那边没有开关语义，两边各按各的来。） */
  function syncButtons() {
    const box = $('filter-types');
    if (!box) {
      return;
    }
    const btns = box.querySelectorAll('.btn-filter');
    for (let i = 0; i < btns.length; i++) {
      const type = btns[i].getAttribute('data-filter-type');
      btns[i].setAttribute('aria-pressed', type === curType ? 'true' : 'false');
    }
  }

  /* ---------- 真正干活：筛 → 画 → 更新状态与计数 ---------- */
  function apply() {
    const result = filterBodies(allBodies, curType, curKeyword);

    // 复用 catalog.js 的渲染 —— 它本来就接受一个数组
    if (typeof window.renderCatalog === 'function') {
      window.renderCatalog(result);
    }

    if (!result.length) {
      setBodyState('no-match', NO_MATCH_TEXT);
    } else {
      setBodyState('success', '');
    }

    /* 计数。
       有结果时 renderCatalog 已经写好了「共 N 个」，不用管；
       0 个的时候它会把计数留空（那是给"数据源本身为空"用的），
       但"筛选后剩 0 个"是用户需要看到的结果，所以补上。
       —— 注意只在**筛选态**补：数据源本身为空时保持留空，
          否则会出现"没有资料"配"共 0 个"的重复话。 */
    if (!result.length && isFiltering()) {
      const count = $('catalog-count');
      if (count) {
        count.textContent = '共 0 个';
      }
    }

    syncButtons();
  }

  /* ---------- 清空：回到"什么都没筛"的起点 ---------- */
  function clearFilter() {
    curType = ALL;
    curKeyword = '';
    const input = $('filter-search');
    if (input) {
      input.value = '';
    }
    apply();
  }

  /* ---------- 接上界面 ---------- */
  function init(list) {
    allBodies = list || [];

    const bar = $('catalog-filter');
    const box = $('filter-types');
    const input = $('filter-search');
    const clearBtn = $('catalog-clear');

    if (!bar || !box || !input) {
      return;
    }

    buildTypeButtons(allBodies);
    syncButtons();

    /* 点类型：事件委托，只在按钮组上挂一个监听（和 catalog.js、
       scene2d.js 同一个思路）—— 以后类型变多也不用重新绑定。 */
    box.addEventListener('click', function (ev) {
      const btn = ev.target && ev.target.closest ? ev.target.closest('.btn-filter') : null;
      if (!btn) {
        return;
      }
      curType = btn.getAttribute('data-filter-type');
      apply();
    });

    /* 边打边筛。用 input 而不是 change：
       change 要等输入框失去焦点才触发，用户会以为"没反应"。 */
    input.addEventListener('input', function () {
      curKeyword = input.value.trim().toLowerCase();
      apply();
    });

    if (clearBtn) {
      clearBtn.addEventListener('click', clearFilter);
    }

    /* 数据到位了，筛选条才露面 */
    bar.hidden = false;

    /* 再应用一次当前条件。
       —— 首次进来时条件就是"全部 + 空词"，等于什么都没筛，是幂等的；
       但如果将来目录重载（比如出错后点了「重新加载」），
       这一步会让筛选状态跟着新数据重算，不会出现
       "按钮还亮在「行星」上，列表却是全部"的错位。 */
    apply();
  }

  /* ---------- 入口 ----------
     不自己读数据：catalog.js 铺完目录会发 catalog:ready，里面带着它用的那份数据。
     本文件排在 catalog.js 之后加载，所以这个监听器一定先于事件注册。 */
  document.addEventListener('catalog:ready', function (ev) {
    init(ev.detail && ev.detail.bodies);
  });
})();
