/* ============================================================
 * src/focus3d.js —— 3D 聚焦（天体特写）
 * ------------------------------------------------------------
 * 职责（TECH_DESIGN.md 第 4 节）：按需加载 Three.js，渲染天体特写。
 * 对外接口：openFocus(bodyId) / closeFocus()
 *
 * 【为什么按需加载】PRD 验收 V1 要求「打开页面 3 秒内看到整体图」。
 * Three.js 有 600 KB，首屏就加载会拖慢开屏，所以等用户真的点开某颗
 * 天体时才加载（TECH_DESIGN 第 1.3 节）。
 *
 * 【为什么库文件放本地】TECH_DESIGN 第 1.3 节：从 CDN 引入的话，
 * CDN 一慢或不可达页面就白屏，而 PRD 5.3 的硬底线正是「不出现白屏」。
 *
 * 【外观是示意，不是真实影像】本项目不做「大型真实纹理贴图包」
 * （PRD 第 7 节），所以球体表面是程序化生成的图案：
 * 气态行星画条纹、岩石天体画随机斑驳、地球画随机陆块。
 * 界面上会注明这一点（TECH_DESIGN 第 1.4 节风险 4 要求）。
 * ============================================================ */

(function () {
  'use strict';

  const THREE_SRC = 'vendor/three.min.js';

  let threePromise = null;    // 加载中/已加载的 Promise
  let threeFailed = false;    // 加载失败过就不再重试（避免每次点击都卡一下）

  let renderer = null;
  let scene = null;
  let camera = null;
  let pivot = null;           // 装着球体的容器：拖动时转它，而不是转球
  let sphere = null;
  let glow = null;
  let ring = null;

  let rafId = 0;
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let velX = 0;               // 拖动惯性
  let velY = 0;
  let zoom = 1;
  let currentBodyId = null;

  const BASE_CAM_Z = 3.35;    // 相机距离的初始值（真实距离由 applyZoom 算）
  const SPIN = 0.0018;        // 松手后慢慢恢复的自转速度
  const FIT_MARGIN = 1.4;     // 取景留白：1.4 = 物体大约占满画面的 71%

  /* 这颗天体需要留出多大的视野（半宽、半高）。
     球体半径固定是 1，但土星多了环：环的外径是球半径的 2.18 倍，
     如果按球取景，环会被画面裁掉。 */
  function framingFor(bodyId) {
    if (bodyId === 'saturn') {
      return { w: 2.18, h: 1.15 };
    }
    return { w: 1.0, h: 1.0 };
  }

  /* 按当前画布的宽高比，算出「正好装得下」的相机距离。
     为什么不能写死一个距离：手机屏幕又窄又高，宽高比和桌面差很多，
     写死的距离在桌面上刚好、到手机上环就出画面了。 */
  function fitDistance() {
    if (!camera) {
      return BASE_CAM_Z;
    }
    const f = framingFor(currentBodyId);
    const tanV = Math.tan((camera.fov * Math.PI / 180) / 2);
    const tanH = tanV * camera.aspect;
    return Math.max(f.h / tanV, f.w / tanH) * FIT_MARGIN;
  }

  function applyZoom() {
    if (!camera) {
      return;
    }
    camera.position.z = fitDistance() * zoom;
  }

  /* ---------- 固定种子的伪随机 ----------
     纹理用随机数生成，但如果每次打开都不一样，看起来会像"页面不稳定"。
     所以用天体 id 算一个固定种子，同一个天体每次生成的纹理都一样。 */
  function hashCode(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function seededRandom(seed) {
    let s = seed >>> 0;
    return function () {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------- 程序化纹理 ----------
     把一张 512×256 的 canvas 画成球体贴图。
     经度方向会被球面拉伸，所以斑块都画得扁一些。 */
  function makeTexture(THREE, body) {
    const W = 512;
    const H = 256;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const rand = seededRandom(hashCode(body.id));
    const base = (body.appearance && body.appearance.mainColor) || '#8e9ab5';

    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);

    const isGas = ['jupiter', 'saturn', 'uranus', 'neptune'].indexOf(body.id) >= 0;

    if (isGas) {
      /* 气态巨行星：一圈圈横向条纹（纬度带）。
         条纹要「有明有暗」才看得出来 —— 只叠白色的话，
         在淡黄色的土星上几乎分辨不出来（第一版就是这个毛病）。 */
      const bands = body.id === 'jupiter' ? 11 : 8;
      for (let y = 0; y < H; y++) {
        const t = y / H;
        const wave = Math.sin(t * Math.PI * bands) * 0.5 + 0.5;
        const jitter = (rand() - 0.5) * 0.06;
        if (wave > 0.5) {
          ctx.fillStyle = 'rgba(255,255,255,'
            + Math.max(0, 0.05 + (wave - 0.5) * 0.34 + jitter).toFixed(3) + ')';
        } else {
          ctx.fillStyle = 'rgba(0,0,0,'
            + Math.max(0, 0.03 + (0.5 - wave) * 0.24 - jitter).toFixed(3) + ')';
        }
        ctx.fillRect(0, y, W, 1);
      }
      // 木星的大红斑（示意）
      if (body.id === 'jupiter') {
        ctx.fillStyle = 'rgba(196,96,64,0.5)';
        ctx.beginPath();
        ctx.ellipse(W * 0.68, H * 0.63, 36, 16, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (body.id === 'earth') {
      /* 地球：陆地是随机斑块，不是真实海陆轮廓 —— 界面上会注明 */
      for (let i = 0; i < 110; i++) {
        const x = rand() * W;
        const y = H * 0.14 + rand() * H * 0.72;
        const rr = 7 + rand() * 26;
        ctx.fillStyle = 'rgba(78,142,86,' + (0.30 + rand() * 0.42).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 1.7, rr, (rand() - 0.5) * 0.5, 0, Math.PI * 2);
        ctx.fill();
      }
      // 两极的白
      const capTop = ctx.createLinearGradient(0, 0, 0, H * 0.16);
      capTop.addColorStop(0, 'rgba(255,255,255,0.85)');
      capTop.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = capTop;
      ctx.fillRect(0, 0, W, H * 0.16);
      const capBot = ctx.createLinearGradient(0, H, 0, H * 0.84);
      capBot.addColorStop(0, 'rgba(255,255,255,0.85)');
      capBot.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = capBot;
      ctx.fillRect(0, H * 0.84, W, H * 0.16);
    } else if (body.type === 'star') {
      /* 太阳：细密的颗粒感。
         斑块必须又小又多又淡 —— 画成大圆点会像气泡、更像月球表面，
         完全不像恒星。
         （前两版都栽在这里：第一版半径 2~12 的大圆像肥皂泡；
           第二版虽然改小了，太阳却仍走的是岩石天体分支，
           被叠了 90 个半径 3~16 的「环形山」，结果画成了月球。） */
      for (let i = 0; i < 1400; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const rr = 0.8 + rand() * 3.2;
        ctx.fillStyle = rand() > 0.45
          ? 'rgba(255,246,206,' + (0.05 + rand() * 0.14).toFixed(3) + ')'
          : 'rgba(198,138,26,' + (0.04 + rand() * 0.12).toFixed(3) + ')';
        ctx.beginPath();
        ctx.arc(x, y, rr, 0, Math.PI * 2);
        ctx.fill();
      }
    } else {
      /* 岩石天体：斑驳 + 环形山（哈雷彗星的核也是这一类） */
      const craters = body.id === 'halley' ? 26 : 90;
      for (let i = 0; i < craters; i++) {
        const x = rand() * W;
        const y = rand() * H;
        const rr = 3 + rand() * 16;
        const dark = rand() > 0.5;
        ctx.fillStyle = dark
          ? 'rgba(0,0,0,' + (0.08 + rand() * 0.20).toFixed(2) + ')'
          : 'rgba(255,255,255,' + (0.05 + rand() * 0.16).toFixed(2) + ')';
        ctx.beginPath();
        ctx.ellipse(x, y, rr * 1.4, rr, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    const tex = new THREE.CanvasTexture(cv);
    tex.anisotropy = 4;
    return tex;
  }

  /* ---------- 按需加载 Three.js ---------- */
  function loadThree() {
    if (window.THREE) {
      return Promise.resolve(window.THREE);
    }
    if (threePromise) {
      return threePromise;
    }

    threePromise = new Promise(function (resolve, reject) {
      const s = document.createElement('script');
      s.src = THREE_SRC;
      s.async = true;
      s.onload = function () {
        if (window.THREE) {
          resolve(window.THREE);
        } else {
          reject(new Error('three.min.js 加载完了，但没找到 THREE'));
        }
      };
      s.onerror = function () {
        reject(new Error('three.min.js 没能加载（文件缺失或路径不对）'));
      };
      document.head.appendChild(s);
    });

    return threePromise;
  }

  /* ---------- 场景只建一次，之后换球体 ---------- */
  function ensureScene(THREE) {
    if (renderer) {
      return;
    }

    const stage = document.getElementById('focus-stage');
    if (!stage) {
      throw new Error('页面上找不到 3D 容器');
    }

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    stage.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0, BASE_CAM_Z);

    // 光照：一主一辅。主光偏右上，让球体有明暗交界，立体感才出来。
    scene.add(new THREE.AmbientLight(0xffffff, 0.42));
    const key = new THREE.DirectionalLight(0xffffff, 1.05);
    key.position.set(2.4, 1.5, 2.7);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x7fa8e0, 0.38);
    rim.position.set(-2.4, -1.1, -1.8);
    scene.add(rim);

    pivot = new THREE.Group();
    scene.add(pivot);

    bindPointer(stage);
    window.addEventListener('resize', resize);
  }

  function disposeBody() {
    if (sphere) {
      pivot.remove(sphere);
      sphere.geometry.dispose();
      if (sphere.material.map) {
        sphere.material.map.dispose();
      }
      sphere.material.dispose();
      sphere = null;
    }
    if (glow) {
      pivot.remove(glow);
      glow.geometry.dispose();
      glow.material.dispose();
      glow = null;
    }
    if (ring) {
      pivot.remove(ring);
      ring.geometry.dispose();
      ring.material.dispose();
      ring = null;
    }
  }

  function setBody(THREE, body) {
    disposeBody();

    const isStar = body.type === 'star';
    const geo = new THREE.SphereGeometry(1, 56, 36);
    const tex = makeTexture(THREE, body);
    const mat = isStar
      // 太阳自己发光，用不受光照的材质才对
      ? new THREE.MeshBasicMaterial({ map: tex })
      : new THREE.MeshPhongMaterial({ map: tex, shininess: 5, specular: 0x1a1a1a });

    sphere = new THREE.Mesh(geo, mat);
    // 稍微歪一点，别让正上方正对着相机
    sphere.rotation.z = THREE.MathUtils.degToRad(11);
    pivot.add(sphere);

    if (isStar) {
      // 一层很淡的外壳，做出光晕的感觉
      glow = new THREE.Mesh(
        new THREE.SphereGeometry(1.26, 32, 20),
        new THREE.MeshBasicMaterial({
          color: 0xf2b230,
          transparent: true,
          opacity: 0.15,
          side: THREE.BackSide
        })
      );
      pivot.add(glow);
    }

    // 环：只给土星画。木星和天王星也有环，但极暗，画出来反而失真
    // （和 2D 主图 RING_VISIBLE_ON_2D 的取舍一致）。
    if (body.appearance && body.appearance.hasRing && body.id === 'saturn') {
      ring = new THREE.Mesh(
        new THREE.RingGeometry(1.36, 2.18, 96),
        new THREE.MeshBasicMaterial({
          color: 0xe3ce9a,
          side: THREE.DoubleSide,
          transparent: true,
          opacity: 0.7
        })
      );
      ring.rotation.x = -Math.PI / 2 + THREE.MathUtils.degToRad(17);
      ring.rotation.y = THREE.MathUtils.degToRad(-9);
      pivot.add(ring);
    }

    // 换天体时把视角重置，免得上一颗转到的角度留着
    currentBodyId = body.id;
    pivot.rotation.set(THREE.MathUtils.degToRad(14), 0, 0);
    zoom = 1;
    applyZoom();
    velX = 0;
    velY = SPIN;
  }

  function resize() {
    const stage = document.getElementById('focus-stage');
    if (!renderer || !stage) {
      return;
    }

    // 底部可能留了一块空间给资料卡（手机上资料卡在下方）。
    // 这块留白要在算高度时减掉，否则球会被资料卡挡住一半。
    const style = window.getComputedStyle(stage);
    const padBottom = parseFloat(style.paddingBottom) || 0;

    const w = stage.clientWidth;
    const h = stage.clientHeight - padBottom;
    if (!w || !h) {
      return;   // 遮罩还藏着的时候测不到尺寸，等显示出来再量
    }
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    applyZoom();   // 宽高比变了，相机距离要跟着重算，否则手机上环会出画面
  }

  /* ---------- 拖动旋转 / 滚轮缩放 ---------- */
  function bindPointer(stage) {
    stage.style.touchAction = 'none';   // 手机上别让拖动变成滚页面

    let downX = 0;
    let downY = 0;
    let moved = false;

    stage.addEventListener('pointerdown', function (ev) {
      dragging = true;
      lastX = ev.clientX;
      lastY = ev.clientY;
      downX = ev.clientX;
      downY = ev.clientY;
      moved = false;
      velX = 0;
      velY = 0;
      if (stage.setPointerCapture) {
        stage.setPointerCapture(ev.pointerId);
      }
    });

    stage.addEventListener('pointermove', function (ev) {
      if (!dragging) {
        return;
      }
      // 记一下"这一下到底是在拖还是在点"
      if (Math.abs(ev.clientX - downX) + Math.abs(ev.clientY - downY) > 6) {
        moved = true;
      }
      velY = (ev.clientX - lastX) * 0.0055;
      velX = (ev.clientY - lastY) * 0.0055;
      lastX = ev.clientX;
      lastY = ev.clientY;
    });

    function stop() {
      dragging = false;
    }
    stage.addEventListener('pointerup', stop);
    stage.addEventListener('pointercancel', stop);
    stage.addEventListener('pointerleave', stop);

    /* 点空白处 = 收起 3D。
       必须区分「点一下」和「拖完松手」：拖动结束也会触发 click，
       如果不管三七二十一就关，那每次转完球遮罩都会被顺手关掉。 */
    stage.addEventListener('click', function () {
      if (!moved) {
        closeFocus();
      }
    });

    stage.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      zoom = Math.max(0.6, Math.min(1.95, zoom * (ev.deltaY > 0 ? 1.07 : 0.935)));
      applyZoom();
    }, { passive: false });
  }

  /* ---------- 渲染循环 ---------- */
  function animate() {
    rafId = requestAnimationFrame(animate);

    if (!pivot || !renderer) {
      return;
    }

    if (dragging) {
      pivot.rotation.y += velY;
      pivot.rotation.x = Math.max(-1.2, Math.min(1.2, pivot.rotation.x + velX));
    } else {
      // 松手后的惯性：慢慢衰减，最后回到缓慢自转
      velX *= 0.93;
      velY = velY * 0.965 + SPIN * 0.035;
      pivot.rotation.y += velY;
      pivot.rotation.x = Math.max(-1.2, Math.min(1.2, pivot.rotation.x + velX));
    }

    renderer.render(scene, camera);
  }

  /* ---------- 对外接口 ---------- */

  function openFocus(bodyId) {
    const config = window.SOLAR_CONFIG || {};

    // TECH_DESIGN 第 7 节的「一键规避」开关：
    // 关掉之后页面退化成纯 2D，但资料卡照常工作。
    if (config.ENABLE_3D === false) {
      return;
    }

    if (threeFailed) {
      return;   // 之前就加载失败过，不再反复重试
    }

    const overlay = document.getElementById('focus-overlay');
    if (!overlay) {
      return;
    }

    const body = (window.SOLAR_BODIES || []).filter(function (b) {
      return b.id === bodyId;
    })[0];
    if (!body) {
      return;
    }

    loadThree().then(function (THREE) {
      ensureScene(THREE);
      setBody(THREE, body);

      const title = document.getElementById('focus-title');
      if (title) {
        title.textContent = body.nameZh + (body.nameEn ? '（' + body.nameEn + '）' : '');
      }
      const note = document.getElementById('focus-note');
      if (note) {
        note.textContent = '拖动可以转动它，滚轮可以放大缩小　·　'
          + '外观为程序生成的示意图案，不是真实影像';
      }

      overlay.hidden = false;
      resize();                 // 必须等遮罩显示之后再量尺寸
      if (!rafId) {
        animate();
      }
    }).catch(function (err) {
      threeFailed = true;
      // TECH_DESIGN 第 6 节场景 1：3D 挂了，但 2D 主图和资料卡仍要能用
      if (window.showFallback) {
        window.showFallback('3D 特写没能加载（' + err.message + '）。'
          + '2D 主图和资料卡仍可正常使用。');
      }
    });
  }

  function closeFocus() {
    const overlay = document.getElementById('focus-overlay');
    if (overlay) {
      overlay.hidden = true;
    }
    if (rafId) {
      cancelAnimationFrame(rafId);
      rafId = 0;
    }
    dragging = false;
  }

  window.openFocus = openFocus;
  window.closeFocus = closeFocus;

  /* 只读的验收接口：返回当前视角角度。
     不参与页面功能，只是让人（或验收脚本）能在控制台里确认
     "拖动到底有没有转动球体"这类肉眼不易量化的事。
     用法：打开 3D 后，在浏览器控制台输入 focus3dDebug() */
  window.focus3dDebug = function () {
    if (!pivot) {
      return null;
    }
    return {
      rotX: Number(pivot.rotation.x.toFixed(4)),
      rotY: Number(pivot.rotation.y.toFixed(4)),
      zoom: Number(zoom.toFixed(3)),
      hasCanvas: !!document.querySelector('#focus-stage canvas'),
      canvasSize: (function () {
        const c = document.querySelector('#focus-stage canvas');
        return c ? [c.width, c.height] : null;
      })()
    };
  };

  document.addEventListener('DOMContentLoaded', function () {
    const btn = document.getElementById('focus-close');
    if (btn) {
      btn.addEventListener('click', closeFocus);
    }

    // 按 Esc 关掉 3D 特写
    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape') {
        closeFocus();
      }
    });
  });

  /* ---------- 空闲预取 ----------
   * 「一开始就加载」不行：600 KB 的库会拖慢首屏，
   *   而 PRD 验收 V1 要求「打开 3 秒内看到整体图」。
   * 「纯等点击才加载」也不行：实测首次点击要 1031 ms（下载 + 解析 + 编译着色器），
   *   超过 PRD 验收 V3 的「1 秒内弹出 3D 特写」。
   *
   * 所以折中：**首屏画完之后**（load 事件之后），趁浏览器空闲悄悄把库取回来。
   * 首屏不受影响，用户点开时也不用等 —— 两边都不牺牲。
   */
  function schedulePrefetch() {
    const prefetch = function () {
      loadThree().catch(function () {
        // 预取失败不提示：用户还没点，这时弹提示只会让人莫名其妙。
        // 真点到天体时，openFocus 的 catch 会给出提示。
      });
    };

    if (typeof window.requestIdleCallback === 'function') {
      window.requestIdleCallback(prefetch, { timeout: 3000 });
    } else {
      setTimeout(prefetch, 2000);
    }
  }

  if (document.readyState === 'complete') {
    schedulePrefetch();
  } else {
    window.addEventListener('load', schedulePrefetch);
  }
})();
