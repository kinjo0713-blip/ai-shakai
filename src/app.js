// AI社会 — 画面（地図・出来事・住民・発明・留守中のまとめ）
(function () {
  'use strict';
  const S = globalThis.AISim;
  const SAVE_KEY = 'ai-shakai-world-v1';
  const TILE = 8; // 1マスのドット数

  // ---------- 保存と読み込み ----------
  function load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const st = JSON.parse(raw);
      return st && st.version === 1 ? st : null;
    } catch (e) { return null; }
  }
  function save() {
    if (!world) return;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(world)); } catch (e) { /* 保存できない環境では、その場かぎりで動く */ }
  }
  function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* なにもしない */ } }

  // ---------- 要素 ----------
  const $ = (sel) => document.querySelector(sel);
  const el = (tag, attrs, ...kids) => {
    const n = document.createElement(tag);
    if (attrs) for (const k in attrs) {
      if (k === 'class') n.className = attrs[k];
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), attrs[k]);
      else if (attrs[k] !== false && attrs[k] != null) n.setAttribute(k, attrs[k]);
    }
    for (const k of kids.flat()) if (k != null && k !== false) n.append(k.nodeType ? k : String(k));
    return n;
  };

  let world = null;
  let tab = 'timeline';
  let showDead = false;
  let openPersonId = null;

  // ---------- ドット絵 ----------
  const PAL = {
    deep: '#2c5f96', deep2: '#336ca6', shallow: '#4c93cf', shallow2: '#64a7dc', foam: '#a9d4f0',
    sand: '#dcc68a', sand2: '#cbb276', grass: '#5d9a3e', grass2: '#6dab49', grass3: '#4f8a34',
    leaf: '#2f6b2c', leaf2: '#3d7f34', trunk: '#6b4a2b', hill: '#8f8571', hill2: '#a39a84', rock: '#6e6656',
    roof: '#9b6a35', roof2: '#7c5229', wall: '#c9a66b', door: '#4a3320',
    skin: '#e3b48a', skin2: '#c98f63', hair: '#3a2a1c', hairOld: '#cfcac0',
    fire: '#f5a33b', fire2: '#fbe17a', stone: '#7b7468', field: '#9a7a3f', field2: '#b9a24c',
  };
  const JOB_COLOR = { gather: '#5aa04a', hunt: '#a4502c', fish: '#3d7fc0', farm: '#c9a43a', child: '#e2d7b5', elder: '#8e8a83' };

  function noise(x, y, k) { let h = (x * 73856093) ^ (y * 19349663) ^ (k * 83492791); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

  function drawTile(g, t, x, y) {
    const px = x * TILE, py = y * TILE;
    const T = S.T;
    const fill = (c, dx, dy, w, h) => { g.fillStyle = c; g.fillRect(px + dx, py + dy, w, h); };
    if (t === T.DEEP) {
      fill(PAL.deep, 0, 0, 8, 8);
      if (noise(x, y, 1) < 0.35) fill(PAL.deep2, 1 + Math.floor(noise(x, y, 2) * 4), 2 + Math.floor(noise(x, y, 3) * 4), 3, 1);
    } else if (t === T.SHALLOW) {
      fill(PAL.shallow, 0, 0, 8, 8);
      if (noise(x, y, 1) < 0.5) fill(PAL.shallow2, Math.floor(noise(x, y, 2) * 5), Math.floor(noise(x, y, 3) * 7), 3, 1);
      const land = (dx, dy) => { const n = S.tileAt(world.map, x + dx, y + dy); return n !== T.DEEP && n !== T.SHALLOW; };
      if (land(0, -1)) fill(PAL.foam, 0, 0, 8, 1);
      if (land(0, 1)) fill(PAL.foam, 0, 7, 8, 1);
      if (land(-1, 0)) fill(PAL.foam, 0, 0, 1, 8);
      if (land(1, 0)) fill(PAL.foam, 7, 0, 1, 8);
    } else if (t === T.SAND) {
      fill(PAL.sand, 0, 0, 8, 8);
      for (let i = 0; i < 3; i++) fill(PAL.sand2, Math.floor(noise(x, y, 10 + i) * 8), Math.floor(noise(x, y, 20 + i) * 8), 1, 1);
    } else if (t === T.GRASS || t === T.FOREST) {
      fill(PAL.grass, 0, 0, 8, 8);
      for (let i = 0; i < 4; i++) fill(noise(x, y, 30 + i) < 0.5 ? PAL.grass2 : PAL.grass3, Math.floor(noise(x, y, 40 + i) * 8), Math.floor(noise(x, y, 50 + i) * 7), 1, 2);
      if (t === T.FOREST) {
        const ox = noise(x, y, 60) < 0.5 ? 0 : 1;
        fill(PAL.trunk, 3 + ox, 5, 2, 3);
        fill(PAL.leaf, 1 + ox, 1, 6, 4);
        fill(PAL.leaf, 2 + ox, 0, 4, 6);
        fill(PAL.leaf2, 2 + ox, 1, 2, 2);
      }
    } else if (t === T.HILL) {
      fill(PAL.hill, 0, 0, 8, 8);
      fill(PAL.hill2, 1, 1, 3, 2);
      if (noise(x, y, 70) < 0.6) { fill(PAL.rock, 4, 4, 3, 2); fill(PAL.hill2, 4, 4, 2, 1); }
    }
  }

  let baseCanvas = null;
  function buildBase() {
    baseCanvas = document.createElement('canvas');
    baseCanvas.width = world.map.w * TILE;
    baseCanvas.height = world.map.h * TILE;
    const g = baseCanvas.getContext('2d');
    for (let y = 0; y < world.map.h; y++) for (let x = 0; x < world.map.w; x++) drawTile(g, world.map.tiles[y * world.map.w + x], x, y);
  }

  // ---------- 地図の表示 ----------
  const canvas = $('#map');
  const ctx = canvas.getContext('2d');
  const cam = { x: 0, y: 0, scale: 3 }; // x,y = 画面中央に映るドット座標
  let camReady = false;

  function resize() {
    const r = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    canvas.width = Math.max(1, Math.round(r.width * dpr));
    canvas.height = Math.max(1, Math.round(r.height * dpr));
    if (!camReady && world && r.width > 0) {
      cam.x = (world.camp.x + 0.5) * TILE;
      cam.y = (world.camp.y + 0.5) * TILE;
      cam.scale = clampScale(Math.max(r.width / (34 * TILE), r.height / (24 * TILE)));
      camReady = true;
    }
  }
  const clampScale = (s) => Math.max(1, Math.min(10, Math.round(s * 2) / 2));
  function clampCam() {
    const r = canvas.getBoundingClientRect();
    const hw = r.width / 2 / cam.scale, hh = r.height / 2 / cam.scale;
    const W = world.map.w * TILE, H = world.map.h * TILE;
    cam.x = hw * 2 >= W ? W / 2 : Math.max(hw, Math.min(W - hw, cam.x));
    cam.y = hh * 2 >= H ? H / 2 : Math.max(hh, Math.min(H - hh, cam.y));
  }

  function residentPos(r, t) {
    // 1日の流れ：夜は家、朝に出かけ、昼は仕事場、夕方に帰る
    const f = t - Math.floor(t);
    const hut = r.hutId ? world.huts.find((h) => h.id === r.hutId) : null;
    const ang = r.id * 2.399;
    const home = hut
      ? { x: (hut.x + 0.5) * TILE + ((r.id % 3) - 1) * 3, y: (hut.y + 1.1) * TILE }
      : { x: (world.camp.x + 0.5) * TILE + Math.cos(ang) * 11, y: (world.camp.y + 0.5) * TILE + Math.sin(ang) * 8 };
    const sp = { x: (r.spot.x + 0.25 + noise(r.id, 1, 5) * 0.5) * TILE, y: (r.spot.y + 0.3 + noise(r.id, 2, 5) * 0.5) * TILE };
    const lerp = (a, b, k) => ({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, walking: true });
    const wob = (p) => ({ x: p.x + Math.sin(t * 900 + r.id) * 2.5, y: p.y + Math.cos(t * 700 + r.id * 3) * 1.5, walking: false });
    if (f < 0.25 || f >= 0.85) return { ...home, sleeping: f < 0.22 || f >= 0.9 };
    if (f < 0.33) return lerp(home, sp, (f - 0.25) / 0.08);
    if (f < 0.7) return wob(sp);
    if (f < 0.78) return lerp(sp, home, (f - 0.7) / 0.08);
    return wob(home);
  }

  function nightAlpha(t) {
    const f = t - Math.floor(t);
    if (f < 0.2) return 0.5;
    if (f < 0.3) return 0.5 * (1 - (f - 0.2) / 0.1);
    if (f < 0.75) return 0;
    if (f < 0.88) return 0.5 * ((f - 0.75) / 0.13);
    return 0.5;
  }

  function drawPerson(g, r, x, y, s) {
    // 1ドット = s ピクセル。体は 4×6 ドット
    const small = r.job === 'child';
    const bx = Math.round(x - 2 * s), by = Math.round(y - (small ? 4 : 6) * s);
    const px = (c, dx, dy, w, h) => { g.fillStyle = c; g.fillRect(bx + dx * s, by + dy * s, w * s, h * s); };
    const hair = r.job === 'elder' ? PAL.hairOld : PAL.hair;
    if (small) {
      px(hair, 1, 0, 2, 1); px(PAL.skin, 1, 1, 2, 1); px(JOB_COLOR.child, 0, 2, 4, 1); px(JOB_COLOR.child, 1, 3, 2, 1);
    } else {
      px(hair, 1, 0, 2, 1); px(PAL.skin, 1, 1, 2, 1); px(PAL.skin2, 2, 1, 1, 1);
      px(JOB_COLOR[r.job] || '#999', 0, 2, 4, 2); px(PAL.skin, 0, 4, 1, 1); px(PAL.skin, 3, 4, 1, 1);
      px(JOB_COLOR[r.job] || '#999', 1, 4, 2, 1); px(PAL.door, 1, 5, 1, 1); px(PAL.door, 2, 5, 1, 1);
    }
  }

  function drawHut(g, h, sx, sy, s) {
    const px = (c, dx, dy, w, hh) => { g.fillStyle = c; g.fillRect(sx + dx * s, sy + dy * s, w * s, hh * s); };
    px(PAL.wall, 1, 4, 6, 4);
    px(PAL.roof2, 0, 3, 8, 2); px(PAL.roof, 1, 2, 6, 2); px(PAL.roof, 2, 1, 4, 1); px(PAL.roof2, 3, 0, 2, 1);
    px(PAL.door, 3, 6, 2, 2);
  }

  function drawCamp(g, sx, sy, s, t) {
    const px = (c, dx, dy, w, h) => { g.fillStyle = c; g.fillRect(sx + dx * s, sy + dy * s, w * s, h * s); };
    px(PAL.stone, 1, 6, 6, 1); px(PAL.stone, 0, 5, 1, 1); px(PAL.stone, 7, 5, 1, 1);
    if (S.has(world, 'fire')) {
      const k = Math.floor(performance.now() / 180) % 3;
      px(PAL.trunk, 2, 5, 4, 1);
      px(PAL.fire, 2, 3 - (k === 1 ? 1 : 0), 4, 2 + (k === 1 ? 1 : 0));
      px(PAL.fire2, 3, 4 - (k === 2 ? 1 : 0), 2, 1 + (k === 2 ? 1 : 0));
    } else {
      px(PAL.trunk, 2, 5, 4, 1);
    }
  }

  let hitList = [];
  function render() {
    if (!world || !baseCanvas || canvas.width < 2) return;
    const cw = canvas.getBoundingClientRect().width;
    if (cw < 2) return;
    const dpr = canvas.width / cw;
    const s = cam.scale * dpr;
    const ox = canvas.width / 2 - cam.x * s, oy = canvas.height / 2 - cam.y * s;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PAL.deep;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(baseCanvas, Math.round(ox), Math.round(oy), Math.round(baseCanvas.width * s), Math.round(baseCanvas.height * s));
    const t = world.worldTime;

    // 畑（農耕のあと、拠点のまわり）
    if (S.has(world, 'farming')) {
      const farmers = S.alive(world).filter((r) => r.job === 'farm').length;
      const n = Math.min(40, 4 + farmers * 2);
      let placed = 0;
      for (let ring = 2; ring < 9 && placed < n; ring++) for (let dy = -ring; dy <= ring && placed < n; dy++) for (let dx = -ring; dx <= ring && placed < n; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
        const x = world.camp.x + dx, y = world.camp.y + dy;
        if (S.tileAt(world.map, x, y) !== S.T.GRASS || (dx + dy) % 2 === 0 || noise(x, y, 99) < 0.4) continue;
        const sx = Math.round(ox + x * TILE * s), sy = Math.round(oy + y * TILE * s), q = s;
        ctx.fillStyle = PAL.field; ctx.fillRect(sx + q, sy + q, 6 * q, 6 * q);
        ctx.fillStyle = PAL.field2; for (let i = 0; i < 3; i++) ctx.fillRect(sx + q, sy + (2 + i * 2) * q, 6 * q, q);
        placed++;
      }
    }

    // 拠点と小屋（奥から順に）
    const items = [];
    items.push({ y: (world.camp.y + 1) * TILE, draw: () => drawCamp(ctx, Math.round(ox + world.camp.x * TILE * s), Math.round(oy + world.camp.y * TILE * s), s, t) });
    for (const h of world.huts) items.push({ y: (h.y + 1) * TILE, draw: () => drawHut(ctx, h, Math.round(ox + h.x * TILE * s), Math.round(oy + h.y * TILE * s), s) });
    hitList = [];
    for (const r of S.alive(world)) {
      const p = residentPos(r, t);
      if (p.sleeping) continue;
      hitList.push({ r, x: p.x, y: p.y });
      items.push({ y: p.y, draw: () => drawPerson(ctx, r, ox + p.x * s, oy + p.y * s, s) });
    }
    items.sort((a, b) => a.y - b.y);
    for (const it of items) it.draw();

    // 夜
    const na = nightAlpha(t);
    if (na > 0) {
      ctx.fillStyle = `rgba(10, 16, 40, ${na})`;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (S.has(world, 'fire')) {
        const cx = ox + (world.camp.x + 0.5) * TILE * s, cy = oy + (world.camp.y + 0.5) * TILE * s;
        const grd = ctx.createRadialGradient(cx, cy, 0, cx, cy, 30 * s);
        grd.addColorStop(0, `rgba(255, 170, 70, ${na * 0.7})`);
        grd.addColorStop(1, 'rgba(255, 170, 70, 0)');
        ctx.fillStyle = grd;
        ctx.fillRect(cx - 30 * s, cy - 30 * s, 60 * s, 60 * s);
      }
    }

    // 名前（拡大したとき）
    if (cam.scale >= 4) {
      ctx.font = `${Math.round(10 * dpr)}px ${getComputedStyle(document.body).getPropertyValue('--font-display')}`;
      ctx.textAlign = 'center';
      for (const h of hitList) {
        const x = ox + h.x * s, y = oy + (h.y - 8) * s;
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillText(h.r.name, x + dpr, y + dpr);
        ctx.fillStyle = '#fff7e6';
        ctx.fillText(h.r.name, x, y);
      }
    }
  }

  // ---------- 地図の操作（ドラッグ・拡大・タップ） ----------
  const pointers = new Map();
  let drag = null, pinch = null;
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y, moved: 0 };
    else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), scale: cam.scale };
      drag = null;
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      cam.scale = Math.max(1, Math.min(10, pinch.scale * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d));
      clampCam();
    } else if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 4) canvas.classList.add('dragging');
      cam.x = drag.cx - dx / cam.scale;
      cam.y = drag.cy - dy / cam.scale;
      clampCam();
    }
  });
  const endPointer = (e) => {
    if (drag && drag.moved < 6 && pointers.size === 1) tapAt(e.clientX, e.clientY);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinch = null;
    if (pointers.size === 0) { drag = null; canvas.classList.remove('dragging'); cam.scale = clampScale(cam.scale); clampCam(); }
  };
  canvas.addEventListener('pointerup', endPointer);
  canvas.addEventListener('pointercancel', (e) => { pointers.delete(e.pointerId); drag = null; pinch = null; });
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    zoomBy(e.deltaY < 0 ? 0.5 : -0.5);
  }, { passive: false });
  function zoomBy(d) { cam.scale = clampScale(cam.scale + d * Math.max(1, cam.scale / 3)); clampCam(); }
  $('#zoom-in').addEventListener('click', () => zoomBy(1));
  $('#zoom-out').addEventListener('click', () => zoomBy(-1));

  function tapAt(cx, cy) {
    const r = canvas.getBoundingClientRect();
    const x = cam.x + (cx - r.left - r.width / 2) / cam.scale;
    const y = cam.y + (cy - r.top - r.height / 2) / cam.scale;
    let best = null, bd = 9;
    for (const h of hitList) {
      const d = Math.hypot(h.x - x, h.y - 3 - y);
      if (d < bd) { bd = d; best = h.r; }
    }
    if (best) openPerson(best.id);
  }

  // ---------- 上の帯 ----------
  function renderTop() {
    const pop = S.alive(world).length;
    $('#date').textContent = S.formatDate(world.day);
    $('#pop').textContent = pop;
    $('#huts').textContent = world.huts.length;
    $('#inv-count').textContent = world.inventions.length;
    $('#era').textContent = world.villageReady ? '原始 → 村へ' : '原始';
  }

  // ---------- 右のパネル ----------
  function setTab(name) {
    tab = name;
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === name));
    for (const b of document.querySelectorAll('[data-view]')) if (b.tagName === 'BUTTON') b.setAttribute('aria-selected', String(b.dataset.view === currentView));
    renderPanel();
  }
  let currentView = 'map';
  function setView(v) {
    currentView = v;
    $('.main').dataset.view = v;
    if (v !== 'map') tab = v;
    setTab(tab);
    requestAnimationFrame(resize);
  }

  function renderPanel() {
    if (!world) return;
    const body = $('#tab-body');
    const keepScroll = body.dataset.tab === tab ? body.scrollTop : 0;
    body.dataset.tab = tab;
    body.replaceChildren();
    if (tab === 'timeline') body.append(...renderTimeline());
    else if (tab === 'people') body.append(...renderPeople());
    else if (tab === 'chronicle') body.append(...renderChronicle());
    body.scrollTop = keepScroll;
  }

  // ---------- AIが書いた文章 ----------
  // ai[key] = { ... }。key は inv-<発明id> / year-<年> / era-village
  let ai = {};
  const yearOf = (day) => Math.floor(day / S.DAYS_PER_YEAR) + 1;

  function aiBadge() { return el('span', { class: 'ai-badge', title: '本物のAIが書いた文章です' }, 'AI'); }

  function aiBanner() {
    const tasks = pendingAiTasks();
    if (aiState.busy) return el('div', { class: 'ai-banner busy' }, el('span', null, aiState.note || '住民が考えています…'), el('button', { class: 'ghost', onclick: () => aiState.stop && aiState.stop() }, '止める'));
    if (!aiState.available || !tasks.length) return null;
    return el('div', { class: 'ai-banner' },
      el('span', null, `AIに語ってもらえる大事な場面が ${tasks.length} つあります`),
      el('button', { class: 'primary small', onclick: runAiTasks }, '語ってもらう'));
  }

  // ---------- タイムライン ----------
  function personHead(r, fallbackName, sub) {
    const c = el('canvas', { class: 'avatar', width: 12, height: 16 });
    if (r) drawPerson(c.getContext('2d'), r, 6, r.job === 'child' ? 12 : 14, 2);
    return el('div', { class: 'post-head' }, c,
      el('span', { class: 'who' }, r ? el('button', { class: 'name-link', onclick: () => openPerson(r.id) }, r.name) : fallbackName),
      el('span', { class: 'post-sub' }, sub));
  }

  function timelineItems() {
    const items = [];
    for (const p of (world.posts || []).slice(-160)) items.push({ day: p.day, t: p.t, type: 'post', p });
    for (const e of world.events.slice(-120)) if (e.major && e.kind !== 'invention') items.push({ day: e.day, t: 0.95, type: 'news', e });
    for (const i of world.inventions) items.push({ day: i.day, t: 0.97, type: 'invention', i });
    for (const k in ai) {
      const a = ai[k];
      if (k.startsWith('year-')) items.push({ day: (+k.slice(5)) * S.DAYS_PER_YEAR, t: 0.01, type: 'ai-news', a, year: +k.slice(5) });
      if (k.startsWith('inv-') && a.voice) { const inv = world.inventions.find((i) => 'inv-' + i.id === k); if (inv) items.push({ day: inv.day, t: 0.98, type: 'ai-voice', a, by: inv.by }); }
      if (k === 'era-village' && a.voice) items.push({ day: a.day || world.day, t: 0.99, type: 'ai-voice', a, by: a.by });
    }
    items.sort((x, y) => (y.day - x.day) || (y.t - x.t));
    return items.slice(0, 220);
  }

  function renderTimeline() {
    const ul = el('ul', { class: 'feed' });
    for (const it of timelineItems()) {
      const when = S.formatDate(it.day);
      if (it.type === 'post') {
        const r = S.byId(world, it.p.by);
        if (!r) continue;
        ul.append(el('li', { class: 'post' + (it.p.kind === 'big' ? ' big' : '') },
          personHead(r, '', `${S.ageYears(world, r) - Math.floor((world.day - it.p.day) / S.DAYS_PER_YEAR)}歳・${S.JOB_NAMES[r.job]}・${when}`),
          el('p', { class: 'post-text' }, it.p.gesture ? el('span', { class: 'gesture', title: 'まだ言葉がないため、身ぶりを書き留めたものです' }, '身ぶり') : null, it.p.text),
          el('div', { class: 'post-foot' }, `♥ ${it.p.likes}`)));
      } else if (it.type === 'news' || it.type === 'invention') {
        const text = it.type === 'news' ? it.e.text : (() => { const w = S.byId(world, it.i.by); return `${w ? w.name : '誰か'}が「${it.i.name}」を発明した`; })();
        const target = it.type === 'news' ? it.e.ids[0] : it.i.by;
        ul.append(el('li', { class: 'news' + (target ? ' clickable' : ''), onclick: target ? () => openPerson(target) : null },
          el('div', { class: 'news-head' }, el('span', { class: 'news-src' }, '世界の記録'), el('span', { class: 'post-sub' }, when)),
          el('p', { class: 'post-text' }, text)));
      } else if (it.type === 'ai-news') {
        ul.append(el('li', { class: 'news ai' },
          el('div', { class: 'news-head' }, el('span', { class: 'news-src' }, 'AI世界通信'), aiBadge(), el('span', { class: 'post-sub' }, `${it.year}年目のまとめ`)),
          el('h4', { class: 'news-title' }, it.a.headline || ''),
          el('p', { class: 'post-text' }, it.a.body || '')));
      } else if (it.type === 'ai-voice') {
        const r = S.byId(world, it.by);
        ul.append(el('li', { class: 'post big ai' },
          personHead(r, '誰か', when),
          el('p', { class: 'post-text' }, aiBadge(), it.a.voice)));
      }
    }
    if (!ul.children.length) ul.append(el('li', { class: 'empty' }, 'まだ誰も何も言っていません。住民たちは、言葉を持つ前に身ぶりで気持ちを伝えはじめます。'));
    return [aiBanner(), ul].filter(Boolean);
  }

  const barColor = (v) => (v > 60 ? 'var(--good)' : v > 30 ? 'var(--warn)' : 'var(--bad)');
  function miniBar(v) { return el('span', null, el('i', { style: `width:${Math.round(v)}%;background:${barColor(v)}` })); }

  function renderPeople() {
    const people = world.residents.filter((r) => showDead || r.alive)
      .sort((a, b) => (b.alive - a.alive) || (a.birthDay - b.birthDay));
    const head = el('div', { class: 'people-head' },
      el('span', null, `暮らしている住民 ${S.alive(world).length}人`),
      el('label', null, el('input', { type: 'checkbox', id: 'show-dead', checked: showDead ? 'checked' : null, onchange: (e) => { showDead = e.target.checked; renderPanel(); } }), '亡くなった人も表示'));
    const ul = el('ul', { class: 'people' });
    for (const r of people) {
      ul.append(el('li', { class: r.alive ? '' : 'dead', onclick: () => openPerson(r.id) },
        el('span', { class: 'swatch', style: `background:${JOB_COLOR[r.job]}` }),
        el('span', null, el('span', { class: 'nm' }, r.name), ' ', el('span', { class: 'sub' }, `${r.sex === 'm' ? '男' : '女'}・${S.ageYears(world, r)}歳・${r.alive ? S.JOB_NAMES[r.job] : '故人'}`)),
        r.alive ? el('span', { class: 'mini-bars', title: 'おなか・元気' }, miniBar(100 - r.hunger), miniBar(r.health)) : el('span', { class: 'sub' }, S.formatDate(r.deathDay).split(' ')[0])));
    }
    return [head, ul];
  }

  // ---------- 年表 ----------
  const ERAS = ['原始', '村', '町', '街', '国'];
  function renderChronicle() {
    const eraIdx = 0;
    const eraBar = el('ol', { class: 'eras', 'aria-label': '時代の歩み' },
      ...ERAS.map((n, i) => el('li', { class: i < eraIdx ? 'done' : i === eraIdx ? 'now' : '' }, el('span', null, n),
        i === eraIdx ? el('small', null, world.villageReady ? '村の入り口' : 'いまここ') : null)));

    const byYear = new Map();
    const add = (y, node) => { if (!byYear.has(y)) byYear.set(y, []); byYear.get(y).push(node); };
    for (const i of world.inventions) {
      const who = S.byId(world, i.by);
      const def = S.INVENTIONS.find((d) => d.id === i.id);
      const a = ai['inv-' + i.id];
      add(yearOf(i.day), el('li', { class: 'ch-inv' },
        el('span', { class: 'ch-mark' }, i.name),
        el('div', null,
          el('p', null, a && a.story ? [aiBadge(), a.story] : `${who ? who.name : '誰か'}が発明した。${def ? def.text : ''}`))));
    }
    for (const e of world.events) {
      if (!e.major || e.kind === 'invention' || e.kind === 'famine') continue;
      add(yearOf(e.day), el('li', null, el('span', { class: 'ch-dot' }), el('p', null, e.text)));
    }
    if (ai['era-village'] && ai['era-village'].story) add(yearOf(ai['era-village'].day || world.day), el('li', { class: 'ch-inv' }, el('span', { class: 'ch-mark' }, '村へ'), el('div', null, el('p', null, aiBadge(), ai['era-village'].story))));
    for (const k in ai) if (k.startsWith('year-')) add(+k.slice(5), el('li', { class: 'ch-news' }, el('span', { class: 'ch-dot' }), el('p', null, aiBadge(), ai[k].headline || '')));

    const years = [...byYear.keys()].sort((a, b) => b - a);
    const list = el('div', { class: 'chron' }, ...years.map((y) => el('section', null, el('h3', { class: 'ch-year' }, `${y}年目`), el('ul', null, ...byYear.get(y)))));
    const left = S.INVENTIONS.length - world.inventions.length;
    const note = el('p', { class: 'panel-note' }, left > 0 ? `まだ誰も思いついていない発明が、あと${left}つあります。` : 'この時代の発明は出そろいました。');
    return [aiBanner(), eraBar, note, list].filter(Boolean);
  }

  // ---------- 住民の紹介 ----------
  function portrait(r) {
    const c = el('canvas', { class: 'portrait', width: 12, height: 16 });
    const g = c.getContext('2d');
    drawPerson(g, r, 6, r.job === 'child' ? 12 : 14, 2);
    return c;
  }

  function openPerson(id) {
    const r = S.byId(world, id);
    if (!r) return;
    openPersonId = id;
    const partner = r.partnerId ? S.byId(world, r.partnerId) : null;
    const parents = r.parentIds.map((p) => S.byId(world, p)).filter(Boolean);
    const kids = r.childIds.map((p) => S.byId(world, p)).filter(Boolean);
    const friends = Object.entries(r.affinity).filter(([, v]) => v > 25).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k]) => S.byId(world, +k)).filter((o) => o && o.alive);
    const link = (o) => el('button', { onclick: () => openPerson(o.id) }, o.name + (o.alive ? '' : '（故人）'));
    const bar = (label, v) => el('div', { class: 'bar-row' }, el('span', null, label), el('span', { class: 'track' }, el('i', { style: `width:${Math.round(v)}%;background:${barColor(v)}` })), el('span', { class: 'num' }, Math.round(v)));

    const card = el('div', { class: 'card', role: 'dialog', 'aria-modal': 'true', 'aria-label': r.name + 'の紹介' },
      el('div', { class: 'person-top' }, portrait(r),
        el('div', null, el('h2', null, r.name),
          el('div', { class: 'meta' }, `${r.sex === 'm' ? '男' : '女'}・${S.ageYears(world, r)}歳・${r.alive ? S.JOB_NAMES[r.job] : `${S.formatDate(r.deathDay)}に${r.deathCause}で亡くなった`}`))),
      el('div', { class: 'traits' }, ...['curiosity', 'caution', 'sociability'].map((k) => el('span', null, S.traitLabel(k, r.traits[k])))),
      r.alive ? el('div', { class: 'bars' }, bar('おなか', 100 - r.hunger), bar('元気', r.health), bar('気分', r.mood)) : null,
      (partner || parents.length || kids.length) ? el('div', { class: 'bars' },
        partner ? el('div', null, el('h3', null, '連れ合い'), el('div', { class: 'links' }, link(partner))) : null,
        parents.length ? el('div', null, el('h3', null, '親'), el('div', { class: 'links' }, ...parents.map(link))) : null,
        kids.length ? el('div', null, el('h3', null, `子ども（${kids.length}人）`), el('div', { class: 'links' }, ...kids.map(link))) : null) : null,
      friends.length ? el('div', null, el('h3', null, '仲のよい相手'), el('div', { class: 'links' }, ...friends.map(link))) : null,
      (() => {
        const ps = (world.posts || []).filter((p) => p.by === r.id).slice(-4).reverse();
        return ps.length ? el('div', null, el('h3', null, 'さいきんのつぶやき'), el('ul', { class: 'memories' }, ...ps.map((p) => el('li', null, el('span', { class: 'when' }, S.formatDate(p.day)), el('span', null, (p.gesture ? '（身ぶり）' : '') + p.text))))) : null;
      })(),
      el('div', null, el('h3', null, '思い出'),
        el('ul', { class: 'memories' }, ...r.memories.slice().reverse().map((m) => el('li', null, el('span', { class: 'when' }, S.formatDate(m.day)), el('span', null, m.text))))),
      el('button', { class: 'primary', onclick: closeOverlay }, '閉じる'));
    showOverlay(card);
  }

  // ---------- 重なる画面 ----------
  function showOverlay(content) {
    const o = $('#overlay');
    o.replaceChildren(content);
    o.hidden = false;
    const btn = content.querySelector && content.querySelector('.primary');
    if (btn) btn.focus({ preventScroll: true });
  }
  function closeOverlay() { $('#overlay').hidden = true; $('#overlay').replaceChildren(); openPersonId = null; }
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay' && !$('#overlay').querySelector('.loading')) closeOverlay(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden && !$('#overlay').querySelector('.loading')) closeOverlay(); });

  function showSummary(sum, isNew) {
    if (isNew) {
      showOverlay(el('div', { class: 'card' },
        el('h2', null, '何もない土地に、10人の住民が現れました'),
        el('p', { class: 'lead' }, 'ここはAIの住民だけが暮らす世界です。あなたは観察者として、彼らが火を見つけ、道具を作り、やがて村を築いていくのを眺めます。'),
        el('ul', null,
          el('li', null, '現実の1日で、この世界では3か月が過ぎます。'),
          el('li', null, 'アプリを閉じているあいだも、時間は流れ続けます。次に開いたとき、その間の出来事をまとめてお知らせします。'),
          el('li', null, '地図の住民をタップすると、その人の紹介が見られます。')),
        el('button', { class: 'primary', onclick: closeOverlay }, '世界を見る')));
      return;
    }
    if (sum.days < 1) { closeOverlay(); return; }
    const popDiff = sum.popAfter - sum.popBefore;
    showOverlay(el('div', { class: 'card' },
      el('h2', null, `留守のあいだに、${S.formatSpan(sum.days)}が過ぎました`),
      el('p', { class: 'lead' }, `${S.formatDate(sum.fromDay)} から ${S.formatDate(sum.toDay)} まで`),
      el('dl', { class: 'figures' },
        el('div', null, el('dt', null, '住民'), el('dd', null, `${sum.popAfter}人`), el('dt', null, popDiff === 0 ? '変わらず' : popDiff > 0 ? `${popDiff}人増えた` : `${-popDiff}人減った`)),
        el('div', null, el('dt', null, '生まれた'), el('dd', null, `${sum.births}人`)),
        el('div', null, el('dt', null, '亡くなった'), el('dd', null, `${sum.deaths}人`))),
      sum.newInventions.length ? el('div', null, el('h3', null, '新しい発明'), el('ul', null, ...sum.newInventions.map((i) => { const w = S.byId(world, i.by); return el('li', null, `「${i.name}」（${w ? w.name : '誰か'}、${Math.floor(i.day / S.DAYS_PER_YEAR) + 1}年目）`); }))) : null,
      sum.highlights.length ? el('div', null, el('h3', null, '大きな出来事'), el('ul', null, ...sum.highlights.map((e) => el('li', null, e.text)))) : null,
      sum.skippedDays > 0 ? el('p', { class: 'lead' }, `とても長い留守だったので、最近の100年ぶんだけを計算しました。`) : null,
      el('button', { class: 'primary', onclick: closeOverlay }, '世界を見る')));
  }

  function showSettings() {
    const card = el('div', { class: 'card' },
      el('h2', null, 'この世界について'),
      el('ul', null,
        el('li', null, '現実の1日で、世界では3か月（90日）が過ぎます。世界の1年は360日です。'),
        el('li', null, `世界が始まってから ${S.formatSpan(world.day)} が経ちました。`),
        el('li', null, shared.db ? 'この世界は claude.ai に保存され、スマホでもパソコンでも同じ世界が見られます。' : 'この世界はこの端末のブラウザに保存されています。claude.ai で開くと、ほかの端末とも同じ世界になります。'),
        el('li', null, 'ふだんの暮らしは決まりごとで動きます。発明や村の誕生、1年のまとめなど大事な場面だけ、本物のAI（Claude）が考えます。AIはあなたのClaudeの利用枠を少し使います。')),
      el('div', { class: 'row' },
        el('button', { class: 'danger', onclick: (e) => {
          const b = e.currentTarget;
          if (b.dataset.armed) { clearSave(); closeOverlay(); startNew(); return; }
          b.dataset.armed = '1'; b.textContent = 'もう一度押すと、今の世界は消えます';
        } }, '世界をはじめからやり直す'),
        el('button', { class: 'primary', onclick: closeOverlay }, '閉じる')));
    showOverlay(card);
  }
  $('#about').addEventListener('click', showSettings);

  // ---------- 時間を進める ----------
  let lastDay = -1;
  let busy = false;
  function tick() {
    if (world && !busy) {
      const before = world.day;
      S.advanceTo(world, Date.now());
      if (world.day !== before) {
        scheduleSharedWrite(false);
        renderTop();
        if (currentView !== 'map' || window.innerWidth > 820) renderPanel();
      }
      if (world.day !== lastDay) { lastDay = world.day; }
      render();
    }
    requestAnimationFrame(tick);
  }

  function loadingScreen() {
    showOverlay(el('div', { class: 'loading' }, el('div', null, '世界を進めています…'), el('div', { class: 'bar' }, el('i'))));
  }

  // 留守中の時間をまとめて計算し、まとめを見せる
  function catchUp(first) {
    busy = true;
    loadingScreen();
    setTimeout(() => {
      const sum = S.advanceTo(world, Date.now());
      if (first) afterLoad(); else { renderTop(); renderPanel(); }
      save();
      busy = false;
      scheduleSharedWrite(true);
      showSummary(sum, false);
    }, 60);
  }

  // ---------- 共有の保存（claude.ai で開いたとき、スマホとパソコンで同じ世界を見る） ----------
  const shared = { db: null, device: Math.random().toString(36).slice(2), remoteDay: -1, writing: false, timer: null, lastWrite: 0 };
  const PEOPLE_CHUNK = 45;
  const clone = (o) => JSON.parse(JSON.stringify(o));

  async function readShared(db) {
    const c = await db.doc('world/core').get();
    if (!c.exists) return null;
    const core = clone(c.data());
    const n = core.peopleChunks || 0;
    const parts = await Promise.all([db.doc('world/events').get(), db.doc('world/posts').get(), ...Array.from({ length: n }, (_, i) => db.doc('world/people' + i).get())]);
    const list = (snap) => (snap.exists ? clone(snap.data().list || []) : []);
    const st = { ...core, events: list(parts[0]), posts: list(parts[1]), residents: parts.slice(2).flatMap(list) };
    delete st.peopleChunks; delete st.writer;
    return st.version === 1 && st.residents.length ? st : null;
  }

  async function writeShared() {
    if (!shared.db || !world || shared.writing || busy) return;
    if (world.day < shared.remoteDay) return; // 先に進んでいる端末がある
    shared.writing = true;
    try {
      const { residents, events, posts, ...core } = world;
      const chunks = [];
      for (let i = 0; i < residents.length; i += PEOPLE_CHUNK) chunks.push(residents.slice(i, i + PEOPLE_CHUNK));
      for (let i = 0; i < chunks.length; i++) await shared.db.doc('world/people' + i).set({ list: chunks[i] });
      await shared.db.doc('world/events').set({ list: events.slice(-500) });
      await shared.db.doc('world/posts').set({ list: (posts || []).slice(-400) });
      await shared.db.doc('world/core').set({ ...core, peopleChunks: chunks.length, writer: shared.device });
      shared.remoteDay = world.day;
      shared.lastWrite = Date.now();
    } catch (e) {
      console.warn('共有の保存に失敗しました', e && e.code);
    } finally {
      shared.writing = false;
    }
  }
  function scheduleSharedWrite(now) {
    if (!shared.db) return;
    clearTimeout(shared.timer);
    const wait = now ? 0 : Math.max(0, 5 * 60000 - (Date.now() - shared.lastWrite));
    shared.timer = setTimeout(writeShared, wait);
  }

  function subscribeShared(db) {
    db.doc('world/core').onSnapshot(async (snap) => {
      if (!snap.exists || snap.metadata.hasPendingWrites) return;
      const d = snap.data();
      shared.remoteDay = Math.max(shared.remoteDay, d.day || 0);
      if (d.writer === shared.device || !world) return;
      const otherWorld = d.seed !== world.seed && d.createdAt > world.createdAt;
      if (otherWorld || (d.seed === world.seed && d.day > world.day + 1)) {
        try {
          const remote = await readShared(db);
          if (remote) { enterWorld(remote, otherWorld); }
        } catch (e) { /* 次の更新を待つ */ }
      }
    }, () => {});
    db.doc('world/ai').onSnapshot((snap) => {
      if (!snap.exists || !world) return;
      const d = snap.data();
      if (d.seed !== world.seed) return;
      ai = clone(d.texts || {});
      saveAiLocal();
      renderPanel();
    }, () => {});
  }

  // ---------- AI（大事な場面だけ、本物のAIが考える） ----------
  const AI_KEY = 'ai-shakai-ai-v1';
  const aiState = { sample: null, available: false, busy: false, note: '', stop: null };
  function loadAiLocal() {
    try { const d = JSON.parse(localStorage.getItem(AI_KEY) || 'null'); ai = d && world && d.seed === world.seed ? d.texts : {}; } catch (e) { ai = {}; }
  }
  function saveAiLocal() { try { localStorage.setItem(AI_KEY, JSON.stringify({ seed: world.seed, texts: ai })); } catch (e) { /* なにもしない */ } }
  async function saveAi(key, val) {
    ai[key] = val;
    saveAiLocal();
    if (!shared.db) return;
    const ref = shared.db.doc('world/ai');
    try {
      const cur = await ref.get();
      if (cur.exists && cur.data().seed === world.seed) await ref.update({ texts: { [key]: val } });
      else await ref.set({ seed: world.seed, texts: { [key]: val } });
    } catch (e) { console.warn('AIの文章を共有できませんでした', e && e.code); }
  }

  function pendingAiTasks() {
    if (!world) return [];
    const t = [];
    for (const i of world.inventions.slice(-3)) if (!ai['inv-' + i.id]) t.push({ key: 'inv-' + i.id, kind: 'inv', inv: i });
    if (world.villageReady && !ai['era-village']) t.push({ key: 'era-village', kind: 'era' });
    const done = Math.floor(world.day / S.DAYS_PER_YEAR);
    for (let y = done; y >= Math.max(1, done - 1); y--) {
      if (ai['year-' + y]) continue;
      if (world.events.some((e) => yearOf(e.day) === y && e.kind !== 'year')) t.push({ key: 'year-' + y, kind: 'year', year: y });
    }
    return t.slice(0, 4);
  }

  function describePerson(r) {
    if (!r) return '（記録が残っていない人）';
    const tr = ['curiosity', 'caution', 'sociability'].map((k) => S.traitLabel(k, r.traits[k])).join('・');
    const mem = r.memories.slice(-5).map((m) => m.text).join(' / ');
    return `${r.name}（${r.sex === 'm' ? '男' : '女'}、${S.ageYears(world, r)}歳、${S.JOB_NAMES[r.job]}、性格: ${tr}）。最近の出来事: ${mem}`;
  }

  function worldContext() {
    return [
      'あなたは、AIの住民だけが暮らす架空の世界の語り部です。人間は一人もいません。',
      `世界: 「名もなき土地」。時代: 原始${world.villageReady ? '（村になりかけている）' : ''}。いまは${S.formatDate(world.day)}。住民${S.alive(world).length}人。`,
      `これまでの発明: ${world.inventions.map((i) => i.name).join('、') || 'まだない'}。`,
      S.has(world, 'words') ? '住民は言葉を話す。' : '住民はまだ言葉を持たず、身ぶりと声で気持ちを伝える。',
      '書き方: やさしい日本語。実在の人物・企業・国・現代の道具は出さない。暴力や不安をあおる表現は控えめに。',
    ].join('\n');
  }

  function buildPrompt(task) {
    if (task.kind === 'inv') {
      const r = S.byId(world, task.inv.by);
      const hadWords = world.inventions.findIndex((i) => i.id === 'words') >= 0 && world.inventions.find((i) => i.id === 'words').day <= task.inv.day;
      return `${worldContext()}\n\n${yearOf(task.inv.day)}年目に「${task.inv.name}」が発明されました。\n発明者: ${describePerson(r)}\nこの時点で言葉は${hadWords ? 'ある' : 'まだない'}。\n\n次の形のJSONだけを返してください。\n{"story": "発明が生まれた場面。情景が浮かぶ2〜3文、120字以内", "voice": "発明者本人の一言、40字以内。言葉がまだないなら（）で身ぶりや声の様子を描く"}`;
    }
    if (task.kind === 'era') {
      const elder = S.alive(world).filter((r) => r.job !== 'child').sort((a, b) => a.birthDay - b.birthDay)[0];
      task.by = elder ? elder.id : null;
      return `${worldContext()}\n\n畑が広がり、人が増え、この集まりは「村」と呼べるほどになりました。\n最年長の住民: ${describePerson(elder)}\n\n次の形のJSONだけを返してください。\n{"story": "村が生まれつつある様子。2〜3文、120字以内", "voice": "最年長の住民が皆に語りかける一言、50字以内"}`;
    }
    const evs = world.events.filter((e) => yearOf(e.day) === task.year && e.kind !== 'year').slice(-25).map((e) => '- ' + e.text).join('\n');
    return `${worldContext()}\n\n${task.year}年目に起きたこと:\n${evs}\n\nこの1年を振り返る、世界の新聞「AI世界通信」の記事を書いてください。次の形のJSONだけを返してください。\n{"headline": "見出し、25字以内", "body": "記事、150字以内。いちばん印象的な出来事を中心に"}`;
  }

  const cut = (s, n) => (typeof s === 'string' ? s.trim().slice(0, n) : '');

  async function runAiTasks() {
    if (aiState.busy || !aiState.sample) return;
    const tasks = pendingAiTasks();
    if (!tasks.length) return;
    const ctl = new AbortController();
    aiState.busy = true; aiState.stop = () => ctl.abort();
    try {
      for (let i = 0; i < tasks.length; i++) {
        const task = tasks[i];
        aiState.note = `住民が考えています…（${i + 1}/${tasks.length}）`;
        renderPanel();
        const res = await aiState.sample.json(buildPrompt(task), { signal: ctl.signal });
        if (task.kind === 'year') await saveAi(task.key, { headline: cut(res.headline, 40), body: cut(res.body, 240) });
        else if (task.kind === 'inv') await saveAi(task.key, { story: cut(res.story, 200), voice: cut(res.voice, 80) });
        else await saveAi(task.key, { story: cut(res.story, 200), voice: cut(res.voice, 90), by: task.by, day: world.day });
      }
      aiState.note = '';
    } catch (e) {
      const code = e && e.code;
      if (code === 'not_granted') aiState.available = false;
      aiState.note = '';
      if (code === 'rate_limited') toast('いまはAIを使えません。しばらくしてからもう一度試してください');
      else if (code && code !== 'aborted' && code !== 'not_granted') toast('AIの返事をうまく受け取れませんでした');
    } finally {
      aiState.busy = false; aiState.stop = null;
      renderPanel();
    }
  }

  function toast(msg) {
    const t = el('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    setTimeout(() => t.remove(), 4000);
  }

  // ---------- はじめに ----------
  function startNew() {
    const seed = (Date.now() ^ Math.floor(Math.random() * 1e9)) >>> 0;
    world = S.createWorld(seed, Date.now());
    ai = {};
    saveAiLocal();
    afterLoad();
    save();
    scheduleSharedWrite(true);
    if (shared.db) shared.db.doc('world/ai').set({ seed, texts: {} }).catch(() => {});
    showSummary(null, true);
  }

  function afterLoad() {
    buildBase();
    camReady = false;
    resize();
    renderTop();
    renderPanel();
  }

  // 世界に入る：留守のあいだを計算してまとめを見せる
  function enterWorld(st, announce) {
    world = st;
    loadAiLocal();
    const pendingDays = (Date.now() - world.lastRealTime) / S.REAL_MS_PER_WORLD_DAY;
    if (pendingDays >= 1 && announce !== false) catchUp(true);
    else { S.advanceTo(world, Date.now()); afterLoad(); save(); }
  }

  async function boot() {
    const saved = load();
    if (saved) enterWorld(saved, true);
    else showOverlay(el('div', { class: 'loading' }, el('div', null, '世界を探しています…'), el('div', { class: 'bar' }, el('i'))));
    const db = window.claude && window.claude.use ? await window.claude.use('db').catch(() => null) : null;
    shared.db = db;
    if (db) {
      let remote = null;
      try { remote = await readShared(db); } catch (e) { remote = null; }
      if (remote && (!world || remote.seed !== world.seed)) {
        while (busy) await new Promise((r) => setTimeout(r, 100));
        enterWorld(remote, true);
      } else if (remote && remote.seed === world.seed && remote.day > world.day) {
        enterWorld(remote, false);
      } else if (world) {
        scheduleSharedWrite(true); // この端末の世界を、共有の世界として登録する
      }
      subscribeShared(db);
    }
    if (!world) startNew();
    const sample = window.claude && window.claude.use ? await window.claude.use('sample').catch(() => null) : null;
    aiState.sample = sample;
    aiState.available = !!sample;
    renderPanel();
  }

  // ---------- 動作確認用（#debug のときだけ） ----------
  if (location.hash === '#debug') {
    const travel = (realDays) => { save(); world.lastRealTime -= realDays * 86400000; save(); location.reload(); };
    document.body.append(el('div', { class: 'debug' },
      el('button', { onclick: () => travel(1) }, '+1日留守'),
      el('button', { onclick: () => travel(30) }, '+30日留守'),
      el('button', { onclick: () => { world.worldTime += 0.25; } }, '+6時間')));
  }

  // ---------- はじまり ----------
  for (const b of document.querySelectorAll('.tabs [data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));
  for (const b of document.querySelectorAll('.bottom-nav [data-view]')) b.addEventListener('click', () => setView(b.dataset.view));
  window.addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden) { save(); scheduleSharedWrite(true); } else if (world) {
    const pendingDays = (Date.now() - world.lastRealTime) / S.REAL_MS_PER_WORLD_DAY;
    if (pendingDays >= 1) catchUp(false);
  } });
  window.addEventListener('pagehide', save);
  setInterval(save, 30000);
  setView(window.innerWidth > 820 ? 'map' : 'map');
  boot();
  requestAnimationFrame(tick);
})();
