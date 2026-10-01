/* ============================================================
 * src/router.js —— hash 路由（Day 13 新增）
 * ------------------------------------------------------------
 * 职责只有一件：**把地址栏里的 hash 翻译成"现在该显示哪个视图"**，
 * 并把结果写到 <body data-view="...">。谁显示谁隐藏，全由 CSS 读这个属性决定
 * —— 和 Day 8 的页面四态（data-page-state）是同一个套路：
 * 状态只有一个来源，就不会出现"标签亮着、内容却是另一个"。
 *
 * 路径表（TECH_DESIGN.md 第 12.1 节）：
 *   #/explore      探索（默认）—— 2D 主图 + 调控区
 *   #/catalog      图鉴        —— 天体目录 + 筛选
 *   #/body/:id     详情        —— 单颗天体的资料（:id 如 sun / halley）
 *
 * 三条规矩：
 *   1. 认不出的路径 → 一律落到探索，**绝不出现"三个视图都不显示"的白屏**
 *   2. `#/body` 后面没跟 id → 退到图鉴（没有内容可给）
 *   3. id 不存在不算路由错误 —— 地址是用户自己输的，交给详情视图显示"空"态
 *
 * 详情视图的四种状态（Day 13 第 3 步，判据见 TECH_DESIGN.md 第 12.3 节）：
 *   loading  正在读取这个天体的资料…         进详情先亮，真实等待约 0.3 秒
 *   success  该天体四项数据 + 对比条
 *   empty    数据源为空 →「暂时没有可显示的天体资料。」（与另两视图同句）
 *            id 找不到 →「没有找到「××」这个天体。」+「回到图鉴」
 *   error    数据层坏了 / 渲染函数缺失 → 报错 +「重新加载」
 *   ⚠️ 判"数据层坏没坏"必须用 states.js 借来的 dataVerdict()，顺序上**先于**找 id ——
 *      反过来的话数据取不到时详情会把"错误"说成"空"，三视图当场串台。
 *
 * 为什么自己写、不上路由库：
 *   三个静态视图、一条 hash 规则，用不到库的百分之一。
 *   而库带来的"构建 / 依赖 / 版本"问题，恰恰是这个项目最容易卡住的地方。
 *   （清单也写明：路由库的进阶用法今日不做，够用就好。）
 * ============================================================ */

(function () {
  'use strict';

  const DEFAULT_VIEW = 'explore';
  const ID_VIEW = 'body';                              // 唯一需要 :id 的视图
  const KNOWN_VIEWS = ['explore', 'catalog', ID_VIEW];

  let current = { view: '', id: '' };
  /* 「返回」要回哪儿。从一级视图点进详情时记下来，
     这样刷新后（内存清空）也不会退到站外 —— 见 goBack()。 */
  let cameFrom = '';

  /* ---------- 1. 解析：把 hash 变成 {view, id} ---------- */

  function parse(hash) {
    const raw = String(hash || '').replace(/^#\/?/, '');      // "#/body/sun" → "body/sun"
    const parts = raw.split('/').filter(function (s) { return s !== ''; });
    const head = (parts[0] || '').toLowerCase();

    // 认不出的（含空 hash、手输错的路径）一律回默认视图
    if (KNOWN_VIEWS.indexOf(head) < 0) {
      return { view: DEFAULT_VIEW, id: '' };
    }
    return {
      view: head,
      id: parts[1] ? decodeURIComponent(parts[1]) : ''
    };
  }

  /* ---------- 2. 跳转：改地址，剩下的交给 hashchange ---------- */

  function go(view, id) {
    const next = '#/' + view + (id ? '/' + encodeURIComponent(id) : '');
    if (window.location.hash === next) {
      apply(parse(next));      // 地址没变（比如重复点同一个标签）也要保证画面一致
      return;
    }
    window.location.hash = next;
  }

  /* ---------- 3. 落地：真正切视图的地方 ---------- */

  function apply(next) {
    if (next.view === current.view && next.id === current.id) {
      return;                  // 没变就不动，免得把滚动位置也重置掉
    }

    // 进详情前记下来路（只在"一级 → 二级"时记，避免详情之间互相跳时记乱）
    if (next.view === ID_VIEW && current.view && current.view !== ID_VIEW) {
      cameFrom = current.view;
    }

    current = next;
    document.body.setAttribute('data-view', next.view);
    if (next.view === ID_VIEW) {
      document.body.setAttribute('data-body-id', next.id);
    }

    syncNav(next.view);

    if (next.view === ID_VIEW) {
      renderBody(next.id);
    } else {
      /* 离开详情时把还没走完的那次"读取"作废。
         不作废也不会画错（视图已经藏了），但会白改一次 #body-state；
         下次进来又立刻覆盖成 loading，状态层会闪一下没意义的值。 */
      clearTimeout(bodyTimer);
    }

    /* 换视图滚回顶部。
       不滚的话，从图鉴（可能已经滚到第三屏）切到探索，会停在半截，
       看上去像"只切了一半"。 */
    window.scrollTo(0, 0);
  }

  /* ---------- 4. 导航标签的选中态 ---------- */

  function syncNav(view) {
    const tabs = document.querySelectorAll('.view-tab');
    for (let i = 0; i < tabs.length; i++) {
      const tab = tabs[i];
      /* 用 href 判断属于哪个视图，而不是另写一个 data- 属性 ——
         导航链接的地址本来就是它管哪个视图的唯一定义，两处写迟早会不一致。
         详情是二级视图，所以两个一级标签都不点亮。 */
      if (tab.getAttribute('href') === '#/' + view) {
        tab.setAttribute('aria-current', 'page');
      } else {
        tab.removeAttribute('aria-current');
      }
    }
  }

  /* ---------- 5. 详情视图：找数据 → 交给主图模块渲染 ---------- */

  function findBody(id) {
    const list = window.SOLAR_BODIES || [];
    for (let i = 0; i < list.length; i++) {
      if (list[i].id === id) {
        return list[i];
      }
    }
    return null;
  }

  /* 「数据层自己坏了没有」的判据**只有一处定义** —— src/states.js 的
     dataVerdict()，这里只是借来用。
     为什么不在这儿再写一遍 if (!window.SOLAR_BODIES)：
     两套判据迟早会写岔，然后就出现"探索说错误、详情说空"这种串台。
     万一 states.js 没加载出来，就当作"数据层没问题"继续按 id 去找
     —— 绝不在这里补一份判据。 */
  function dataVerdict() {
    if (window.pageState && typeof window.pageState.dataVerdict === 'function') {
      return window.pageState.dataVerdict();
    }
    return null;
  }

  const ERR_TEXT = '这个天体的资料没能读取成功，点「重新加载」再试一次。';

  /* 进详情先亮"加载中"，等一小会儿再去读。
     为什么要等：这一版的数据就在内存里，同步渲染的话 loading 只存在 0 帧、
     肉眼永远看不到 —— 那状态表里详情这一行就等于白写。
     （和 src/catalog.js 那 420ms 同一个理由：让状态真实存在。）
     顺带它还起了个作用：点卡片之后到内容出现之间有个交代，不是"点了没反应"。

     ⚠️ 每次进来都要先清掉上一个计时器。地址连切时（#/body/sun → #/body/mars）
     前一次那 300ms 还没走完，不清的话它回来会把上一个天体的内容盖上去。 */
  const BODY_LOAD_MS = 300;
  let bodyTimer = 0;

  function renderBody(id) {
    setBodyState('loading', '正在读取这个天体的资料…');
    clearTimeout(bodyTimer);
    bodyTimer = setTimeout(function () { showBody(id); }, BODY_LOAD_MS);
  }

  function showBody(id) {
    /* ---------- 第一关：数据层自己坏了没有 ----------
       坏了就是"错误"，和探索/图鉴说同一件事。
       这一步必须在"找不找得到这个 id"之前 —— 否则数据文件取不到时，
       findBody() 一样返回 null，详情页会把"错误"说成"空"
       （"没有找到这个天体"），三个视图当场串台。 */
    const verdict = dataVerdict();
    if (verdict === 'error') {
      setBodyState('error', ERR_TEXT);
      return;
    }
    /* 数据源是空的 —— 也用探索/图鉴那一句，让三屏看到的结论一致。
       （表里详情 empty 行写的是"没有找到××"，那句留给"地址里那个 id 不存在"
       这种用户自己输错的情形，见下。） */
    if (verdict === 'empty') {
      setBodyState('empty', '暂时没有可显示的天体资料。');
      return;
    }

    /* ---------- 第二关：这个 id 找得到吗 ----------
       找不到不算"出错了"。地址里的 id 是用户自己输的（或旧链接），
       改一下就能解决，所以走"空"那套：说清楚 + 给出口（回图鉴）。
       判据沿用 Day 8：**空 = 重试没用（不给重试按钮）**。 */
    const found = findBody(id);
    if (!found) {
      setBodyState('empty', '没有找到「' + (id || '这个') + '」这个天体。');
      return;
    }

    /* ---------- 第三关：渲染得出来吗 ----------
       内容渲染交给主图模块 —— 那套逻辑（四项数据 + 对数对比条）本来就在
       scene2d.js 里，Day 13 只是把它从"浮层"挪到"页面"，没有重写一遍。
       好处：资料卡的呈现方式永远只有一处定义。 */
    if (typeof window.renderBodyCard === 'function') {
      window.renderBodyCard(found);
      setBodyState('success', '');
    } else {
      /* 主图模块根本没加载出来（脚本文件缺失等）—— 这才是真的"错误"：
         重试有可能好，所以给「重新加载」。 */
      setBodyState('error', ERR_TEXT);
    }
  }

  /* 详情视图的状态层。和区块级状态一样：脚本只写属性，样子由 CSS 管。 */
  function setBodyState(state, text) {
    const box = document.getElementById('body-state');
    if (!box) {
      return;
    }
    box.setAttribute('data-state', state);
    const msg = document.getElementById('body-state-text');
    if (msg && text) {
      msg.textContent = text;
    }
  }

  /* ---------- 6. 「返回」---------- */

  function goBack() {
    // 有来路就回原来的视图（从图鉴进来就回图鉴，从探索进来就回探索）
    if (cameFrom && cameFrom !== ID_VIEW) {
      go(cameFrom);
      return;
    }
    /* 没有来路（直接输地址、刷新、或点的别人分享的链接）：
       回图鉴，**不退到站外** —— 用户按「返回」是想继续看，不是想离开。 */
    go('catalog');
  }

  /* ---------- 7. 接线 ---------- */

  function bind() {
    const back = document.getElementById('body-back');
    if (back) {
      back.addEventListener('click', goBack);
    }

    const retry = document.getElementById('body-state-retry');
    if (retry) {
      // 和主图的「重新加载」一致：整页重来，确保重新去取一次数据文件
      retry.addEventListener('click', function () {
        window.location.reload();
      });
    }

    const toCatalog = document.getElementById('body-state-catalog');
    if (toCatalog) {
      toCatalog.addEventListener('click', function () {
        go('catalog');
      });
    }

    const to3d = document.getElementById('body-view-3d');
    if (to3d) {
      /* 3D 特写仍然是浮层，这里只是打开它。
         用存在性判断：3D 模块没加载 / 加载失败 / 被 ENABLE_3D 关掉时，
         详情页本身照常可看，不会整块坏掉（TECH_DESIGN 第 6 节）。 */
      to3d.addEventListener('click', function () {
        if (current.view === ID_VIEW && current.id &&
            typeof window.openFocus === 'function') {
          window.openFocus(current.id);
        }
      });
    }

    window.addEventListener('hashchange', function () {
      route();
    });

    route();
  }

  /* 入口：解析当前地址。 */
  function route() {
    const next = parse(window.location.hash);
    /* `#/body` 后面没跟 id —— 没有内容可给，退到图鉴。
       用 replace 不新增历史记录，用户按返回不会卡在这一步。 */
    if (next.view === ID_VIEW && !next.id) {
      window.location.replace('#/catalog');
      return;
    }
    apply(next);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }

  window.router = {
    go: go,
    current: function () { return { view: current.view, id: current.id }; }
  };
})();
