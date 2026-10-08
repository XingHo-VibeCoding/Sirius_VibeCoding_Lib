/* ============================================================
 * src/status.js —— 检查台（Day 20 新增）
 * ------------------------------------------------------------
 * 这是一个**给开发和验收用的**页面，路径是 #/status。
 * 它**不对外**：顶部导航里没有入口，只能手动输地址打开
 * （运维页不该混进产品导航里）。
 *
 * 它回答四个问题：
 *   ① 服务活着没有              → GET    /api/health
 *   ② 数据库里到底有什么         → GET    /api/bodies
 *   ③ 写一条能不能写进数据库     → POST   /api/observations
 *   ④ 写进去的能不能改、能不能删 → PATCH  /api/observations?id=
 *                                  DELETE /api/observations?id=
 *
 * 页头另有一个「最后更新」时间戳（Day 20 余力加练）：
 * 记录这一屏结果最后一次刷新的时刻，见下方 stampUpdated()。
 *
 * ⭐ Day 22 板块③ 步骤 3：卡片④ 是**跟着读接口一起来的**。
 *   在此之前（Day 18 拍板"只解锁写侧"）检查台只能盲写：写进去了什么看不见，
 *   要删一条还得自己去数据库里抄 uuid。有了 GET /api/observations，
 *   卡片④ 才第一次能"**先看到要改哪条，再动手**"。
 *   ⚠️ 连带影响：原来这里写过一句"observations 没有读接口"，那句已**过期**，
 *      HTML 里对应的说明也一起改掉了（注释与代码必须同步，Day 17 起定的规矩）。
 *
 * 【为什么自己写请求函数，不用 src/api.js】
 *   src/api.js 是 Day 17 的取数层，但它带一条"取不到就回退到页面自带数据"的兜底逻辑。
 *   那条逻辑对**图鉴**是对的（不能让用户看到白屏），
 *   对**检查台**恰恰是错的 —— 检查台要看的正是"接口到底通不通"，
 *   一兜底就把真相盖住了：接口明明挂了，检查台却显示一切正常。
 *   ⇒ 这里自己写请求，只借 SolarApi.base 那个地址（不复制地址字符串）。
 *
 * 【判据纪律（沿用 Day 17/18 的教训）】
 *   云函数只返信封、不设 HTTP 状态码 ⇒ 公网三种结果**全是 200**。
 *   所以这里**同时显示 HTTP 状态和信封里的 ok**，让人自己看清两者的区别。
 * ============================================================ */

(function () {
  'use strict';

  /* 超时上限（Day 20 从 8 秒放宽到 15 秒）。
     ⚠️ 8 秒实测偏紧：云函数**冷启动**时第一次请求可能超过 8 秒 ⇒ 会被误判成"没通"，
        页面上看起来像**服务挂了**，其实只是"还没睡醒"。
        （Day 20 实拍：函数空闲 3.5 小时后，14:49 那次两张卡片都报了 ❌；两分钟后自己就好了。）
     但也不能不设上限：路由没配好 / 网络不通时 fetch 会挂很久，
     检查台会一直停在"正在检查…"，看上去像页面卡死。 */
  const TIMEOUT_MS = 15000;
  function withTimeout() {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = ctrl
      ? setTimeout(function () { ctrl.abort(); }, TIMEOUT_MS)
      : 0;
    return { ctrl: ctrl, timer: timer };
  }

  /* 接口地址：从 src/api.js 借（那边是唯一的定义处，不在这里再抄一遍）。 */
  function apiBase() {
    return (window.SolarApi && window.SolarApi.base) || '';
  }

  /**
   * 发一个请求，**把原始响应尽可能完整地带回来**。
   * 不抛错、不兜底 —— 成功失败都返回一个对象，交给界面如实展示。
   * @returns {Promise<{http:number|null, ok:boolean, data:any, error:any, raw:string, note:string}>}
   */
  async function call(path, init) {
    const t = withTimeout();
    try {
      const res = await fetch(apiBase() + path, Object.assign({
        headers: { Accept: 'application/json' },
        signal: t.ctrl ? t.ctrl.signal : undefined
      }, init || {}));

      const raw = await res.text();

      /* 服务端不保证回 JSON（网关自己出错时可能是 HTML），
         所以解析失败不当作错误，只是"没有信封可读"。 */
      let body = null;
      try {
        body = JSON.parse(raw);
      } catch (e) {
        body = null;
      }

      /* health 是唯一不走信封的接口：它返回 { ok, service }、**没有 data 字段**。
         这里按信封的形状统一成 ok/data/error，界面就不用为它写特例。 */
      const isEnvelope = body && Object.prototype.hasOwnProperty.call(body, 'data');
      return {
        http: res.status,
        ok: isEnvelope ? (body.ok === true) : !!(body && body.ok === true),
        data: isEnvelope ? body.data : (body || null),
        error: isEnvelope ? body.error : null,
        raw: raw,
        note: isEnvelope ? '信封 {ok,data,error}' : '非信封（health 的原始形状）'
      };
    } catch (e) {
      /* ⭐ 区分「我们自己的超时」和「其它请求失败」—— 两者对用户的意义完全不同：
         超时多半是云函数冷启动 / 网络慢（**再点一次往往就好**），
         其它失败才是地址错 / 断网 / 被拦。
         混成一句会让人把"没睡醒"读成"挂了"。 */
      const timedOut = !!(e && (e.name === 'AbortError' || /aborted/i.test(e.message || '')));
      return {
        http: null,
        ok: false,
        data: null,
        error: {
          code: timedOut ? 'TIMEOUT' : 'NETWORK',
          message: timedOut
            ? '超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没有收到响应'
            : ((e && e.message) || '请求没能发出去')
        },
        raw: '',
        note: timedOut ? '超时（请求发出去了，服务端没在时限内回）' : '请求阶段就失败了（断网 / 地址不对 / 被拦截）'
      };
    } finally {
      if (t.timer) { clearTimeout(t.timer); }
    }
  }

  /* 把结果渲染成一小段纯文本（用 textContent，不拼 HTML 字符串）。 */
  function setLine(el, text, kind) {
    if (!el) { return; }
    el.textContent = text;
    el.setAttribute('data-kind', kind || '');
  }

  /* 失败时的统一文案（两张"只读"卡片共用）。
     ⭐ 超时单独说 —— 它多半是"云函数还没睡醒"，跟"地址错 / 断网"不是一回事，
        而且**给得出下一步动作**（再点一次）。Day 20 实拍撞到的就是这种。
     ⚠️ 这里拼的是 textContent，别写 Markdown 星号 —— 会原样显示出来。 */
  function failText(what, r, retryLabel) {
    const code = (r.error && r.error.code) || '?';
    if (code === 'TIMEOUT') {
      return '⏱ ' + what + '超时了 —— 等了超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没等到响应。\n' +
        '（多半是云函数在冷启动，不是服务挂了。点「' + retryLabel + '」再试一次，通常第二次就秒回。）';
    }
    const msg = (r.error && r.error.message) || '(没有 message)';
    return '❌ ' + what + '没成功。HTTP ' + (r.http === null ? '（没拿到）' : r.http) +
      ' ／ ' + msg + ' ／ ' + r.note;
  }

  /* ---------- 整页的「最后更新」时间戳（Day 20 余力加练） ---------- */

  /*
   * 语义选择：**最后一次刷新尝试的时刻**，成功失败都记。
   * 为什么不记"最后成功拿到数据的时间"：检查台的用途是排查 ——
   * 刚试过一次、结果失败了，这时显示"10 分钟前"反而更误导人。
   * 记下尝试时刻，屏幕上的时间戳永远等于"这一屏结果是什么时候试出来的"。
   *
   * 触发点 = 三张卡片中任意一张刷新完成：检查一次 / 读一次 / 写入一次。
   */
  function pad2(n) { return String(n).padStart(2, '0'); }

  /* 本地时区的时间戳。
     ⚠️ 与 todayStr() 同一个坑：不能用 toISOString() —— 它按 UTC 算，
        东八区会差 8 小时（晚上跑出来是"昨天"）。 */
  function fmtStamp(d) {
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function stampUpdated() {
    const el = document.getElementById('status-updated');
    if (!el) { return; }
    el.textContent = '最后更新：' + fmtStamp(new Date());
  }

  /* ---------- 卡片 ①：服务健康 ---------- */

  async function checkHealth() {
    const line = document.getElementById('health-line');
    const btn = document.getElementById('health-check');
    if (btn) { btn.disabled = true; }
    setLine(line, '正在检查…', 'wait');

    const r = await call('/api/health');
    if (btn) { btn.disabled = false; }

    if (r.ok) {
      const svc = (r.data && r.data.service) || '(响应里没有 service)';
      setLine(line, '✅ 服务在跑。service = 「' + svc + '」 ／ HTTP ' + r.http + ' ／ ' + r.note, 'ok');
    } else {
      setLine(line, failText('服务健康检查', r, '检查一次'), 'bad');
    }
    stampUpdated();
  }

  /* ---------- 卡片 ②：数据库真实数据 ---------- */

  async function loadData() {
    const line = document.getElementById('data-line');
    const list = document.getElementById('data-list');
    const btn = document.getElementById('data-load');
    if (btn) { btn.disabled = true; }
    setLine(line, '正在读取…', 'wait');
    if (list) { list.textContent = ''; }

    const r = await call('/api/bodies');
    if (btn) { btn.disabled = false; }

    if (!r.ok) {
      setLine(line, failText('读取数据库', r, '读一次'), 'bad');
      stampUpdated();
      return;
    }

    const total = r.data && typeof r.data.total === 'number' ? r.data.total : '?';
    const items = (r.data && r.data.items) || [];
    setLine(line, '✅ 读到 ' + items.length + ' 条（total = ' + total + '） ／ HTTP ' + r.http, 'ok');

    if (!list) { return; }
    items.forEach(function (b) {
      const li = document.createElement('li');
      li.className = 'status-chip';
      const dot = document.createElement('span');
      dot.className = 'status-dot';
      /* 色点用数据库里那个颜色 —— 改库里的颜色，这里立刻跟着变，
         是"页面读的确实是数据库"的直接证据。 */
      dot.style.background = (b.appearance && b.appearance.mainColor) || 'transparent';
      const name = document.createElement('span');
      name.textContent = (b.nameZh || '?') + '（' + (b.id || '?') + '）';
      li.appendChild(dot);
      li.appendChild(name);
      list.appendChild(li);
    });

    stampUpdated();
  }

  /* ---------- 卡片 ③：写入测试 ---------- */

  const STATUS_LABEL = { observed: '观测到了', missed: '没看到', planned: '计划观测' };

  /* 天体下拉：用页面自带的静态列表生成（同步、必然有值）。
     ⚠️ 这里**故意不调接口** —— 下拉选项是"可从哪些里挑"，
     用同步数据能让表单立刻可用；接口那份是"数据库里现在有什么"，
     两件事分开，表单不会因为接口慢而空着。 */
  function fillBodyOptions() {
    const sel = document.getElementById('write-body');
    if (!sel) { return; }
    const list = window.SOLAR_BODIES || [];
    sel.textContent = '';
    list.forEach(function (b) {
      const o = document.createElement('option');
      o.value = b.id;
      o.textContent = (b.nameZh || b.id) + '（' + b.id + '）';
      sel.appendChild(o);
    });
  }

  /* 默认日期 = 今天（本地时区）。
     ⚠️ 不能用 toISOString() —— 它按 UTC 算，东八区晚上会少一天。 */
  function todayStr() {
    const d = new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return d.getFullYear() + '-' + m + '-' + day;
  }

  async function submitWrite(ev) {
    ev.preventDefault();
    const line = document.getElementById('write-line');
    const btn = document.getElementById('write-submit');
    if (btn) { btn.disabled = true; }
    setLine(line, '正在写入…', 'wait');

    const bodyId = document.getElementById('write-body').value;
    const observedOn = document.getElementById('write-date').value;
    const status = document.getElementById('write-status').value;
    const noteRaw = document.getElementById('write-note').value.trim();

    /* 组装请求体。note 是可选字段：空就**不带这个键**，
       与契约 3.4.2 的"可选"保持一致（别传空字符串当有值）。 */
    const payload = { bodyId: bodyId, observedOn: observedOn, status: status };
    if (noteRaw) { payload.note = noteRaw; }

    const r = await call('/api/observations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    if (btn) { btn.disabled = false; }

    const sent = JSON.stringify(payload);

    if (r.ok) {
      const saved = r.data || {};
      setLine(line,
        '✅ 写进去了。\n发出的：' + sent +
        '\n服务端回吐：id=' + (saved.id || '?') + ' ／ bodyId=' + (saved.bodyId || '?') +
        ' ／ observedOn=' + (saved.observedOn || '?') + ' ／ createdAt=' + (saved.createdAt || '?') +
        '\nHTTP ' + r.http + '（⚠️ 成功与失败都是 200，判断一律看 ok）', 'ok');
      /* 写成功不自动刷新列表 —— 列表读的是 bodies 表，
         而这次写的是 observations 表，两者无关，刷新也没变化。 */
    } else {
      const code = (r.error && r.error.code) || '?';
      const msg = (r.error && r.error.message) || '(没有 message)';
      let text;
      if (code === 'TIMEOUT') {
        /* ⚠️ 写入超时**不能**简单说成"没写进去" —— 请求已经发出去了，
           服务端可能已经落库、只是没来得及回。所以必须把话说全 + 给一个自证的办法。 */
        text = '⏱ 写入超时了 —— 等了超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没等到响应。\n' +
          '发出的：' + sent + '\n' +
          '（多半是云函数在冷启动，不是服务挂了。⚠️ 超时≠没写进去：请求已经发出去了，服务端可能已经落库。\n' +
          '想确认：用同一个日期再提交一次 —— 被判「已有观测记录」= 上次其实成功了；这次提交成功 = 上次没写进去。）';
      } else {
        text = '❌ 被拒了。\n发出的：' + sent +
          '\n错误码：' + code + '\n说明：' + msg +
          '\nHTTP ' + (r.http === null ? '（没拿到）' : r.http) +
          (code === 'BAD_REQUEST' && /已有观测记录/.test(msg)
            ? '\n（这是防重复机制在工作：同一天同一个天体只能记一条。换个日期或换个天体再试。）'
            : '');
      }
      setLine(line, text, 'bad');
    }
    stampUpdated();
  }

  /* ---------- 卡片 ④：修改 / 删除 ---------- */

  /* 正在编辑的那条记录（null = 没在编辑）。
     用**模块级变量**持有整个对象，而不是把 id 塞进 DOM 的 data- 属性再回读 ——
     后者多一道"字符串 ↔ 对象"转换，而且转错了**不会报错**，只会改错行。 */
  let editing = null;

  /* 备注的显示：让"没有备注"和"备注是空串"看起来一样（库里两者都存成 null）。 */
  function noteText(v) {
    return (v === null || v === undefined || v === '') ? '(空)' : '「' + v + '」';
  }

  /* 画一行记录。三个要点：
     · 全程 createElement + textContent，**不拼 HTML 字符串** ——
       备注是用户输入的内容，拼字符串就是自己给自己开 XSS 的门；
     · ⚠️ uuid **完整显示、不截断** —— 删之前要拿它核对"删的是不是这条"；
     · 按钮的点击用**闭包直接持有那一条记录**，不在 DOM 上挂 id 再回查。 */
  function recordRow(rec) {
    const li = document.createElement('li');
    li.className = 'status-record';

    const main = document.createElement('span');
    main.className = 'status-record-main';
    main.textContent = (rec.bodyId || '?') + ' · ' + (rec.observedOn || '?') +
      ' · ' + (STATUS_LABEL[rec.status] || rec.status || '?') +
      (rec.note ? ' · 「' + rec.note + '」' : ' · （无备注）');
    li.appendChild(main);

    const idLine = document.createElement('span');
    idLine.className = 'status-record-id';
    idLine.textContent = '(id) ' + (rec.id || '?');
    li.appendChild(idLine);

    const act = document.createElement('span');
    act.className = 'status-record-act';

    const editBtn = document.createElement('button');
    editBtn.type = 'button';
    editBtn.className = 'btn btn-small';
    editBtn.textContent = '改';
    editBtn.addEventListener('click', function () { openEdit(rec); });
    act.appendChild(editBtn);

    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.className = 'btn btn-small btn-danger';
    delBtn.textContent = '删';
    delBtn.addEventListener('click', function () { removeRecord(rec); });
    act.appendChild(delBtn);

    li.appendChild(act);
    return li;
  }

  async function loadObservations() {
    const line = document.getElementById('obs-line');
    const list = document.getElementById('obs-list');
    const btn = document.getElementById('obs-load');
    if (btn) { btn.disabled = true; }
    setLine(line, '正在读取…', 'wait');
    if (list) { list.textContent = ''; }

    const r = await call('/api/observations');
    if (btn) { btn.disabled = false; }

    if (!r.ok) {
      setLine(line, failText('读取观测记录', r, '读一次'), 'bad');
      stampUpdated();
      return;
    }

    const total = r.data && typeof r.data.total === 'number' ? r.data.total : '?';
    const items = (r.data && r.data.items) || [];
    setLine(line,
      '✅ 读到 ' + items.length + ' 条（total = ' + total + '） ／ HTTP ' + r.http +
      (items.length ? '' : '\n（表是空的 —— 先到上面的「③ 写入测试」写一条，这里才有东西可改、可删。）'), 'ok');

    if (!list) { return; }
    items.forEach(function (rec) { list.appendChild(recordRow(rec)); });

    /* ⚠️ 刷新之后，原来打开着的编辑区可能指向一条**已经不在列表里**的记录
       （最典型的就是刚被删掉的那条）⇒ 把它关掉，
       免得界面上留着一个正在编辑、其实已经不存在的对象。 */
    if (editing && !items.some(function (x) { return x.id === editing.id; })) {
      closeEdit();
    }

    stampUpdated();
  }

  /* 打开编辑区并预填当前值（"改之前"的值要看得见，否则改完没法对比）。 */
  function openEdit(rec) {
    editing = rec;
    const form = document.getElementById('edit-form');
    const target = document.getElementById('edit-target');
    const sel = document.getElementById('edit-status');
    const note = document.getElementById('edit-note');
    if (!form) { return; }

    if (target) {
      target.textContent = '正在改：' + (rec.bodyId || '?') + ' · ' + (rec.observedOn || '?') +
        '\n(id) ' + (rec.id || '?') +
        '\n（天体与日期改不了 —— 那是"记的是谁、哪一天"，要换只能删了重记。）';
    }
    if (sel) { sel.value = rec.status || 'observed'; }
    if (note) { note.value = rec.note || ''; }
    form.hidden = false;
    if (sel) { sel.focus(); }
  }

  function closeEdit() {
    editing = null;
    const form = document.getElementById('edit-form');
    if (form) { form.hidden = true; }
    const target = document.getElementById('edit-target');
    if (target) { target.textContent = ''; }
  }

  async function submitEdit(ev) {
    ev.preventDefault();
    if (!editing) { return; }

    const line = document.getElementById('edit-line');
    const btn = document.getElementById('edit-submit');
    if (btn) { btn.disabled = true; }
    setLine(line, '正在保存…', 'wait');

    const before = editing;
    const status = document.getElementById('edit-status').value;
    const noteRaw = document.getElementById('edit-note').value.trim();

    /* ⭐⭐ PATCH 与 POST 在"空值"上**语义相反**，这是全篇最容易照抄错的一处：
         POST ：note 空 ⇒ **不带这个键**（= 这个字段没有值）；
         PATCH：note 空 ⇒ **必须带这个键、值给 null**（= 把这一列清空）。
       这里若照抄 POST 的写法，"清空备注"就会**静默失败** ——
       界面回你"改好了"，库里那行备注却一动没动。
       （接口层刻意用 hasOwnProperty 判"给没给这个字段"，接的就是这个 null。） */
    const payload = { status: status, note: noteRaw ? noteRaw : null };

    const r = await call('/api/observations?id=' + encodeURIComponent(before.id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload)
    });
    if (btn) { btn.disabled = false; }

    const sent = JSON.stringify(payload);

    if (r.ok) {
      const saved = r.data || {};
      /* ⭐ 结果里把"改之前 / 改之后"**并排**写出来 ——
         验收要看的正是这个对比；只回一句"改好了"是看不出到底变没变的。 */
      setLine(line,
        '✅ 改好了。\n发出的：' + sent +
        '\n改之前：status=' + (before.status || '?') + ' ／ note=' + noteText(before.note) +
        '\n改之后：status=' + (saved.status || '?') + ' ／ note=' + noteText(saved.note) +
        '\n(id) ' + (saved.id || before.id) +
        '\nHTTP ' + r.http + '（⚠️ 成功与失败都是 200，判断一律看 ok）', 'ok');
      closeEdit();
      loadObservations();   /* 列表跟着刷新 —— 改动在列表里也看得见 */
    } else {
      setLine(line, failText('修改', r, '读一次') + '\n发出的：' + sent, 'bad');
    }
    stampUpdated();
  }

  /* 删除失败时**不能**套用 failText 的超时文案：
     那句说的是"点某个按钮再试一次"，而删除超时的正确动作是**先去列表里看一眼** ——
     请求已经发出去了，服务端可能已经删了。（与 Day 20 写入超时同一套推理。） */
  function deleteFailText(r) {
    const code = (r.error && r.error.code) || '?';
    if (code === 'TIMEOUT') {
      return '⏱ 删除超时了 —— 等了超过 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒没等到响应。\n' +
        '⚠️ 超时≠没删掉：请求已经发出去了，服务端可能已经删了。\n' +
        '想确认：点「读一次」刷新列表 —— 那条**不在**列表里 = 已经删掉了；**还在** = 没删掉，可以再删一次。';
    }
    const msg = (r.error && r.error.message) || '(没有 message)';
    return '❌ 删除没成功。HTTP ' + (r.http === null ? '（没拿到）' : r.http) +
      ' ／ ' + msg + ' ／ ' + r.note;
  }

  async function removeRecord(rec) {
    /* ⭐ 二次确认（拍板 Q6）。它不是"多一步流程"，而是**人对自己手滑的最后一道闸**：
         仓库层拦的是"我们自己写漏了 .eq() 会清空整张表"，
         接口层拦的是"调用方传来坏 id"，
         这里拦的是"手指按错了行、或者提前按了"。
       三处拦的是**三种不同来源**的错，所以缺一不可 —— 不能因为"接口层已经校验了"就省掉这个框。 */
    const label = (rec.bodyId || '?') + ' · ' + (rec.observedOn || '?') +
      ' · ' + (STATUS_LABEL[rec.status] || rec.status || '?') +
      (rec.note ? ' · 「' + rec.note + '」' : ' · （无备注）');
    /* ⚠️ confirm 是**纯文本弹窗**，文案里不要写 Markdown 的星号 —— 会原样显示出来。 */
    const sure = window.confirm(
      '确认删除这条观测记录吗？\n\n' + label + '\n(id) ' + rec.id +
      '\n\n⚠️ 这是真删（从数据库里移除），删掉之后找不回来。'
    );

    const line = document.getElementById('edit-line');
    if (!sure) {
      setLine(line, '已取消，什么都没有删。（如果你只是想改它，点那一行的「改」。）', 'wait');
      stampUpdated();
      return;
    }

    setLine(line, '正在删除…', 'wait');

    /* DELETE **不需要请求体** ⇒ 不设 Content-Type、不发 body。
       （"发一个空 JSON 体"和"什么都不发"在服务端不是一回事，别顺手抄 PATCH 那一段。） */
    const r = await call('/api/observations?id=' + encodeURIComponent(rec.id), { method: 'DELETE' });

    if (r.ok) {
      const gone = r.data || {};
      setLine(line,
        '✅ 删掉了。\n服务端回吐（= 删之前的那一行）：' +
        '\nbodyId=' + (gone.bodyId || '?') + ' ／ observedOn=' + (gone.observedOn || '?') +
        ' ／ status=' + (gone.status || '?') + ' ／ note=' + noteText(gone.note) +
        '\n(id) ' + (gone.id || rec.id) +
        '\nHTTP ' + r.http +
        '\n（接口把删掉的内容回吐回来，好让你核对删的确实是这一条；' +
        '下面列表刷新后它就不在里面了 —— 那就是"删掉了"的直接证据。）', 'ok');
      closeEdit();
      loadObservations();
    } else {
      setLine(line, deleteFailText(r), 'bad');
    }
    stampUpdated();
  }

  /* ---------- 接线 ---------- */

  function bind() {
    const h = document.getElementById('health-check');
    if (h) { h.addEventListener('click', checkHealth); }

    const d = document.getElementById('data-load');
    if (d) { d.addEventListener('click', loadData); }

    const form = document.getElementById('write-form');
    if (form) { form.addEventListener('submit', submitWrite); }

    const obsLoad = document.getElementById('obs-load');
    if (obsLoad) { obsLoad.addEventListener('click', loadObservations); }

    const editForm = document.getElementById('edit-form');
    if (editForm) { editForm.addEventListener('submit', submitEdit); }

    const editCancel = document.getElementById('edit-cancel');
    if (editCancel) { editCancel.addEventListener('click', closeEdit); }

    fillBodyOptions();
    const dateInput = document.getElementById('write-date');
    if (dateInput) { dateInput.value = todayStr(); }

    /* 进入检查台就自动跑一次前两张卡片（读操作，无副作用）。
       切换视图走 hashchange；同时补一次初次调用，覆盖"直接输地址进来"。 */
    function onEnter() {
      if (window.location.hash.indexOf('#/status') === 0) {
        checkHealth();
        loadData();
        /* 卡片④ 的读取也是**只读**（GET），和 ①② 一样进页面自动跑一次 ——
           一进来就能看到"库里现在有哪些记录"，不必先点一下才有东西看。
           （卡片③ 是写操作、有副作用，所以**不**自动跑。） */
        loadObservations();
      }
    }
    window.addEventListener('hashchange', onEnter);
    onEnter();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();
