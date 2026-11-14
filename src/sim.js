// AI社会 — 世界の計算（第1段階：原始の時代、ルールだけで動く）
// ブラウザでもNodeでも動くように、globalThis.AISim に公開する。
(function () {
  'use strict';

  // ---- 時間 ----
  // 現実の1日で世界の3か月（90日）が進む。世界の1年は360日（季節ごとに90日）。
  const WORLD_DAYS_PER_REAL_DAY = 90;
  const REAL_MS_PER_WORLD_DAY = (24 * 3600 * 1000) / WORLD_DAYS_PER_REAL_DAY; // 16分
  const DAYS_PER_YEAR = 360;
  const DAYS_PER_SEASON = 90;
  const SEASONS = ['春', '夏', '秋', '冬'];
  const MAX_CATCHUP_DAYS = 100 * DAYS_PER_YEAR; // 1回に計算するのは最大100年ぶん

  const yearsToDays = (y) => Math.round(y * DAYS_PER_YEAR);
  const ADULT = yearsToDays(14);
  const ELDER = yearsToDays(52);

  // ---- 乱数（同じ種からは同じ歴史になる） ----
  function rand(st) {
    st.rng = (st.rng + 0x6d2b79f5) >>> 0;
    let t = st.rng;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  const pick = (st, arr) => arr[Math.floor(rand(st) * arr.length)];
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  function hash2(x, y, seed) {
    let h = (x * 374761393 + y * 668265263 + seed * 2246822519) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  // ---- 地形 ----
  const T = { DEEP: 0, SHALLOW: 1, SAND: 2, GRASS: 3, FOREST: 4, HILL: 5 };
  const MAP_W = 64;
  const MAP_H = 44;

  function valueNoise(x, y, scale, seed) {
    const gx = x / scale, gy = y / scale;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = hash2(x0, y0, seed), b = hash2(x0 + 1, y0, seed);
    const c = hash2(x0, y0 + 1, seed), d = hash2(x0 + 1, y0 + 1, seed);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  }

  function makeMap(seed) {
    const tiles = new Array(MAP_W * MAP_H);
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const nx = (x - MAP_W / 2) / (MAP_W / 2), ny = (y - MAP_H / 2) / (MAP_H / 2);
        const falloff = Math.sqrt(nx * nx * 0.9 + ny * ny * 1.1);
        const h = valueNoise(x, y, 11, seed) * 0.6 + valueNoise(x, y, 5, seed + 7) * 0.3 + valueNoise(x, y, 2.5, seed + 13) * 0.1 - falloff * 0.55 + 0.18;
        const wet = valueNoise(x, y, 7, seed + 29);
        let t;
        if (h < 0.06) t = T.DEEP;
        else if (h < 0.14) t = T.SHALLOW;
        else if (h < 0.19) t = T.SAND;
        else if (h > 0.5) t = T.HILL;
        else t = wet > 0.52 ? T.FOREST : T.GRASS;
        tiles[y * MAP_W + x] = t;
      }
    }
    return { w: MAP_W, h: MAP_H, tiles };
  }

  const tileAt = (map, x, y) => (x < 0 || y < 0 || x >= map.w || y >= map.h ? T.DEEP : map.tiles[y * map.w + x]);

  function findCamp(map) {
    let best = null, bestScore = -1;
    for (let y = 4; y < map.h - 4; y++) {
      for (let x = 4; x < map.w - 4; x++) {
        if (tileAt(map, x, y) !== T.GRASS) continue;
        let water = 0, forest = 0, grass = 0;
        for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
          const t = tileAt(map, x + dx, y + dy);
          if (t === T.SHALLOW) water++;
          else if (t === T.FOREST) forest++;
          else if (t === T.GRASS) grass++;
        }
        const cx = (x - map.w / 2) / map.w, cy = (y - map.h / 2) / map.h;
        const score = Math.min(water, 12) * 2 + Math.min(forest, 25) + Math.min(grass, 40) * 0.5 - (cx * cx + cy * cy) * 80;
        if (score > bestScore) { bestScore = score; best = { x, y }; }
      }
    }
    return best || { x: Math.floor(map.w / 2), y: Math.floor(map.h / 2) };
  }

  // 仕事ごとの「出かける場所」の候補（拠点の近く）
  const spotCache = new WeakMap();
  function spotsFor(st) {
    let c = spotCache.get(st.map);
    if (c && c.cx === st.camp.x && c.cy === st.camp.y) return c;
    c = { cx: st.camp.x, cy: st.camp.y, gather: [], hunt: [], fish: [], home: [] };
    for (let y = 0; y < st.map.h; y++) for (let x = 0; x < st.map.w; x++) {
      const d = Math.abs(x - st.camp.x) + Math.abs(y - st.camp.y);
      const t = tileAt(st.map, x, y);
      if (d <= 14 && (t === T.FOREST || t === T.GRASS)) c.gather.push({ x, y });
      if (d <= 18 && (t === T.FOREST || t === T.HILL)) c.hunt.push({ x, y });
      if (d <= 16 && (t === T.SHALLOW || (t === T.SAND && d <= 10))) c.fish.push({ x, y });
      if (d <= 3 && t !== T.DEEP && t !== T.SHALLOW) c.home.push({ x, y });
    }
    if (!c.fish.length) c.fish = c.gather;
    if (!c.hunt.length) c.hunt = c.gather;
    if (!c.home.length) c.home = [{ x: st.camp.x, y: st.camp.y }];
    spotCache.set(st.map, c);
    return c;
  }

  // ---- 名前 ----
  const SYL = ['ア', 'イ', 'ウ', 'エ', 'オ', 'カ', 'キ', 'ク', 'ケ', 'コ', 'サ', 'シ', 'ス', 'セ', 'ソ', 'タ', 'チ', 'ツ', 'テ', 'ト', 'ナ', 'ニ', 'ヌ', 'ネ', 'ノ', 'ハ', 'ヒ', 'フ', 'ホ', 'マ', 'ミ', 'ム', 'メ', 'モ', 'ヤ', 'ユ', 'ヨ', 'ラ', 'リ', 'ル', 'レ', 'ロ', 'ワ'];
  const TAIL = ['', '', '', 'ン', 'ル', 'ト', 'ラ', 'ナ'];
  function makeName(st) {
    const used = new Set(st.residents.filter((r) => r.alive).map((r) => r.name));
    for (let i = 0; i < 20; i++) {
      const n = pick(st, SYL) + pick(st, SYL) + (rand(st) < 0.35 ? pick(st, SYL) : '') + pick(st, TAIL);
      if (!used.has(n) && n.length <= 4) return n;
    }
    return pick(st, SYL) + pick(st, SYL) + pick(st, SYL) + st.nextId;
  }

  // ---- 発明（この順番で生まれる） ----
  const INVENTIONS = [
    { id: 'fire', name: '火', need: 20, text: '火をおこす方法を見つけた。寒い夜も、みんなで火を囲めるようになった' },
    { id: 'tools', name: '石の道具', need: 70, text: '石を割って、鋭い刃を作った。木の実や獲物の処理がずっと楽になった' },
    { id: 'words', name: '言葉', need: 130, text: '物に名前をつけて呼び合うようになった。知恵が人から人へ伝わりはじめた' },
    { id: 'shelter', name: '小屋', need: 220, text: '枝と草で小屋を建てた。家族ごとに暮らす場所ができた' },
    { id: 'bow', name: '弓矢', need: 470, text: 'しなる枝と紐で弓を作った。遠くの獲物も狙えるようになった' },
    { id: 'boat', name: '丸木舟', need: 340, text: '木をくりぬいて舟を作った。沖の魚も獲れるようになった' },
    { id: 'pottery', name: '土器', need: 820, text: '粘土を焼いて器を作った。食べ物を長く蓄えられるようになった' },
    { id: 'farming', name: '農耕', need: 620, text: '種をまけば食べ物が育つことに気づいた。土地に根を下ろす暮らしが始まる' },
  ];
  const has = (st, id) => st.inventions.some((i) => i.id === id);

  const JOB_NAMES = { gather: '採集', hunt: '狩り', fish: '漁', child: '子ども', elder: '長老', farm: '畑仕事' };
  const TRAIT_WORDS = {
    curiosity: ['無関心', 'ふつう', '好奇心が強い'],
    caution: ['向こう見ず', 'ふつう', '慎重'],
    sociability: ['一匹狼', 'ふつう', '人なつっこい'],
  };
  function traitLabel(key, v) { return TRAIT_WORDS[key][v < 0.33 ? 0 : v < 0.67 ? 1 : 2]; }

  // ---- 住民 ----
  function makeResident(st, opts) {
    const r = {
      id: st.nextId++,
      name: makeName(st),
      sex: opts.sex || (rand(st) < 0.5 ? 'm' : 'f'),
      birthDay: opts.birthDay,
      traits: { curiosity: rand(st), caution: rand(st), sociability: rand(st) },
      job: 'child',
      hunger: 10,
      health: 90 + rand(st) * 10,
      mood: 60,
      partnerId: null,
      parentIds: opts.parentIds || [],
      childIds: [],
      hutId: null,
      affinity: {},
      lastBirthDay: -9999,
      memories: [],
      alive: true,
      deathDay: null,
      deathCause: null,
      spot: { x: st.camp.x, y: st.camp.y },
    };
    if (opts.parentIds && opts.parentIds.length) {
      const [a, b] = opts.parentIds.map((id) => byId(st, id));
      for (const k of ['curiosity', 'caution', 'sociability']) {
        r.traits[k] = clamp(((a ? a.traits[k] : 0.5) + (b ? b.traits[k] : 0.5)) / 2 + (rand(st) - 0.5) * 0.5, 0, 1);
      }
    }
    st.residents.push(r);
    assignJob(st, r);
    return r;
  }

  const idIndex = new WeakMap();
  function byId(st, id) {
    let m = idIndex.get(st.residents);
    if (!m || m.size !== st.residents.length) {
      m = new Map(st.residents.map((r) => [r.id, r]));
      idIndex.set(st.residents, m);
    }
    return m.get(id);
  }
  const age = (st, r) => (r.deathDay ?? st.day) - r.birthDay;
  const ageYears = (st, r) => Math.floor(age(st, r) / DAYS_PER_YEAR);
  const alive = (st) => st.residents.filter((r) => r.alive);

  function assignJob(st, r) {
    const a = age(st, r);
    if (a < ADULT) { r.job = 'child'; return; }
    if (a >= ELDER) { r.job = 'elder'; return; }
    if (r.job !== 'child' && r.job !== 'elder' && !(has(st, 'farming') && r.job !== 'farm' && rand(st) < 0.3)) return;
    const w = {
      gather: 1.2,
      hunt: 0.6 + (1 - r.traits.caution) * 0.8,
      fish: spotsFor(st).fish.length > 4 ? 0.9 : 0.1,
      farm: has(st, 'farming') ? 1.4 : 0,
    };
    let total = 0; for (const k in w) total += w[k];
    let x = rand(st) * total;
    for (const k in w) { x -= w[k]; if (x <= 0) { r.job = k; return; } }
    r.job = 'gather';
  }

  function remember(st, r, text) {
    r.memories.push({ day: st.day, text });
    if (r.memories.length > 16) r.memories.shift();
  }

  function log(st, kind, text, ids, major) {
    st.events.push({ day: st.day, kind, text, ids: ids || [], major: !!major });
    if (st.events.length > 1500) {
      const i = st.events.findIndex((e) => !e.major);
      st.events.splice(i >= 0 ? i : 0, 1);
    }
  }

  // ---- 世界の誕生 ----
  function createWorld(seed, realNow) {
    seed = seed >>> 0;
    const map = makeMap(seed);
    const st = {
      version: 1,
      seed,
      rng: seed ^ 0x9e3779b9,
      day: 0,
      worldTime: 0.3, // 朝から始める
      createdAt: realNow,
      lastRealTime: realNow,
      map,
      camp: findCamp(map),
      residents: [],
      huts: [],
      food: 30,
      knowledge: 0,
      inventions: [],
      era: 'primitive',
      villageReady: false,
      events: [],
      posts: [],
      nextPostId: 1,
      nextId: 1,
      stats: { births: 0, deaths: 0 },
      lastFamineDay: -9999,
    };
    const startAges = [17, 19, 21, 23, 25, 28, 31, 34, 38, 44];
    startAges.forEach((y, i) => {
      makeResident(st, { sex: i % 2 ? 'f' : 'm', birthDay: -yearsToDays(y) - Math.floor(rand(st) * 300) });
    });
    for (const r of st.residents) {
      r.spot = pick(st, spotsFor(st).home);
      remember(st, r, '何もない土地で目を覚ました。そばには見知らぬ9人がいた');
    }
    log(st, 'origin', '何もない土地に、10人の住民が現れた。世界の歴史がここから始まる', st.residents.map((r) => r.id), true);
    return st;
  }

  // ---- 1日ぶんの計算 ----
  function stepDay(st) {
    st.day += 1;
    const season = Math.floor((st.day % DAYS_PER_YEAR) / DAYS_PER_SEASON);
    const people = alive(st);
    const spots = spotsFor(st);

    // 仕事の見直し（成長・老い）
    for (const r of people) {
      const a = age(st, r);
      if (a === ADULT) {
        assignJob(st, r);
        remember(st, r, `大人の仲間入りをして、${JOB_NAMES[r.job]}を始めた`);
      } else if (a === ELDER) {
        r.job = 'elder';
        remember(st, r, '体が思うように動かなくなり、若者に知恵を伝える側になった');
      } else if (r.job === 'child' && a > ADULT) assignJob(st, r);
    }

    // 働く
    const seasonGather = [1.1, 1.3, 1.5, 0.55][season];
    const seasonFish = [1.0, 1.2, 1.0, 0.6][season];
    const seasonFarm = [0.5, 1.2, 2.2, 0.2][season];
    // 土地が養える量には限りがある（同じ仕事の人が増えるほど1人あたりの収穫は減る）
    const work = { gather: 0, fish: 0, farm: 0, hunt: 0 };
    for (const r of people) {
      const strength = r.health / 100;
      if (r.job === 'child') {
        if (age(st, r) >= yearsToDays(7)) { work.gather += 0.4 * strength; r.spot = rand(st) < 0.5 ? pick(st, spots.gather) : pick(st, spots.home); }
        else r.spot = pick(st, spots.home);
        continue;
      }
      if (r.job === 'elder') { r.spot = pick(st, spots.home); continue; }
      if (r.job === 'gather') { work.gather += strength; r.spot = pick(st, spots.gather); }
      else if (r.job === 'fish') { work.fish += strength; r.spot = pick(st, spots.fish); }
      else if (r.job === 'farm') { work.farm += strength; r.spot = pick(st, spots.gather); }
      else if (r.job === 'hunt') {
        r.spot = pick(st, spots.hunt);
        const success = 0.42 + (has(st, 'bow') ? 0.18 : 0) + (season === 3 ? -0.12 : 0);
        if (rand(st) < success) work.hunt += strength;
        if (rand(st) < 0.0012 * (1.3 - r.traits.caution)) {
          r.health -= 30;
          remember(st, r, '狩りの最中に獣に襲われ、大けがをした');
          log(st, 'injury', `${r.name}が狩りの最中にけがをした`, [r.id], false);
        }
      }
    }
    const land = (n, cap) => cap * (1 - Math.exp(-n / cap));
    const cap = {
      gather: spots.gather.length / 22,
      fish: Math.max(1, spots.fish.length / 14) * (has(st, 'boat') ? 1.6 : 1),
      hunt: spots.hunt.length / 40,
      farm: spots.gather.length / 4,
    };
    let produced = 0;
    produced += 1.5 * seasonGather * (has(st, 'tools') ? 1.25 : 1) * land(work.gather, cap.gather);
    produced += 1.35 * seasonFish * (has(st, 'boat') ? 1.3 : 1) * land(work.fish, cap.fish);
    produced += 3.4 * (has(st, 'tools') ? 1.1 : 1) * land(work.hunt, cap.hunt);
    produced += 1.6 * seasonFarm * (has(st, 'tools') ? 1.15 : 1) * land(work.farm, cap.farm);
    st.food += produced;
    st.food *= has(st, 'pottery') ? 0.998 : 0.994; // 食べ物は少しずつ傷む

    // 食べる（足りないときは、働き手から順に分け合う）
    const order = people.map((r) => ({ r, k: (r.job === 'child' ? 1 : r.job === 'elder' ? 2 : 0) + rand(st) * 1.5 }));
    order.sort((a, b) => a.k - b.k);
    const winterHarsh = season === 3 && !has(st, 'fire') ? 1 : season === 3 && !has(st, 'shelter') ? 0.4 : 0;
    for (const { r } of order) {
      const want = r.job === 'child' ? 0.6 : 1;
      const got = Math.min(want, st.food);
      st.food -= got;
      const share = got / want;
      r.hunger = clamp(share >= 1 ? r.hunger - 15 : r.hunger + (1 - share) * 8, 0, 100);
      let dh = 0.6;
      if (r.hunger > 55) dh -= (r.hunger - 55) / 28;
      dh -= winterHarsh * 0.45;
      const sick = (age(st, r) < yearsToDays(3) ? 0.0016 : 0.0006) * (has(st, 'fire') ? 0.8 : 1);
      if (rand(st) < sick) {
        dh -= 28;
        remember(st, r, '熱を出して寝込んだ');
      }
      r.health = clamp(r.health + dh, 0, 100);
      const partnerBonus = r.partnerId ? 8 : 0;
      r.mood = clamp(r.mood * 0.9 + (100 - r.hunger * 0.8 - (100 - r.health) * 0.4 + partnerBonus) * 0.1, 0, 100);
    }

    // 死
    for (const r of people) {
      const y = age(st, r) / DAYS_PER_YEAR;
      let cause = null;
      if (r.health <= 0) cause = r.hunger > 60 ? '飢え' : '病気やけが';
      else if (y > 45 && rand(st) < 0.00004 * (y - 45) * (y - 45)) cause = '老衰';
      if (cause) die(st, r, cause);
    }

    // 付き合い
    const living = alive(st);
    for (const r of living) {
      if (living.length < 2 || rand(st) > 0.25 + r.traits.sociability * 0.35) continue;
      const o = pick(st, living);
      if (o === r) continue;
      const delta = (rand(st) - 0.28) * 6 * (0.5 + (r.traits.sociability + o.traits.sociability) / 2);
      r.affinity[o.id] = clamp((r.affinity[o.id] || 0) + delta, -100, 100);
      o.affinity[r.id] = clamp((o.affinity[r.id] || 0) + delta * 0.8, -100, 100);
      if (delta < -3.5 && r.affinity[o.id] < -40 && rand(st) < 0.15) {
        log(st, 'quarrel', `${r.name}と${o.name}が言い争いをした`, [r.id, o.id], false);
        remember(st, r, `${o.name}と言い争いになった`);
        remember(st, o, `${r.name}に言いがかりをつけられた`);
      }
    }

    // 夫婦になる
    for (const r of living) {
      if (r.partnerId || r.sex !== 'm') continue;
      const a = age(st, r);
      if (a < yearsToDays(16) || a > yearsToDays(48)) continue;
      for (const k in r.affinity) {
        if (r.affinity[k] < 35) continue;
        const o = byId(st, +k);
        if (!o || !o.alive || o.sex !== 'f' || o.partnerId) continue;
        const b = age(st, o);
        if (b < yearsToDays(16) || b > yearsToDays(45)) continue;
        if (r.parentIds.some((p) => o.parentIds.includes(p))) continue;
        if ((r.affinity[o.id] || 0) >= 35 && (o.affinity[r.id] || 0) >= 30) {
          r.partnerId = o.id; o.partnerId = r.id;
          log(st, 'couple', `${r.name}と${o.name}が夫婦になった`, [r.id, o.id], false);
          remember(st, r, `${o.name}と夫婦になった`);
          remember(st, o, `${r.name}と夫婦になった`);
          if (has(st, 'shelter')) buildHut(st, r, o);
          break;
        }
      }
    }

    // 生まれる
    const perCapita = st.food / Math.max(1, living.length);
    const avgHunger = living.reduce((s, r) => s + r.hunger, 0) / Math.max(1, living.length);
    for (const f of living) {
      if (f.sex !== 'f' || !f.partnerId || !f.alive) continue;
      const a = age(st, f);
      if (a < yearsToDays(16) || a > yearsToDays(42)) continue;
      if (st.day - f.lastBirthDay < DAYS_PER_YEAR * 1.2) continue;
      const m = byId(st, f.partnerId);
      if (!m || !m.alive) continue;
      const p = perCapita < 2 || avgHunger > 25 ? 0 : 0.0035 * clamp(perCapita / 8, 0.2, 1.3) * (f.health / 100);
      if (rand(st) < p) {
        f.lastBirthDay = st.day;
        const c = makeResident(st, { birthDay: st.day, parentIds: [m.id, f.id] });
        c.hutId = f.hutId;
        c.spot = pick(st, spots.home);
        m.childIds.push(c.id); f.childIds.push(c.id);
        st.stats.births++;
        log(st, 'birth', `${m.name}と${f.name}のあいだに${c.name}が生まれた`, [c.id, m.id, f.id], false);
        remember(st, f, `子ども${c.name}を産んだ`);
        remember(st, m, `子ども${c.name}が生まれた`);
      }
    }

    // 知恵がたまって発明が生まれる
    const adults = alive(st).filter((r) => r.job !== 'child');
    let gain = 0;
    for (const r of adults) gain += 0.004 + r.traits.curiosity * 0.012 + (r.job === 'elder' ? 0.006 : 0);
    if (has(st, 'words')) gain *= 1.35;
    st.knowledge += gain;
    const next = INVENTIONS.find((i) => !has(st, i.id));
    const lastInv = st.inventions.length ? st.inventions[st.inventions.length - 1].day : -9999;
    if (next && st.knowledge >= next.need && adults.length && st.day - lastInv > DAYS_PER_YEAR && rand(st) < 0.01) {
      let total = 0; for (const r of adults) total += 0.1 + r.traits.curiosity;
      let x = rand(st) * total, inventor = adults[0];
      for (const r of adults) { x -= 0.1 + r.traits.curiosity; if (x <= 0) { inventor = r; break; } }
      st.inventions.push({ id: next.id, name: next.name, day: st.day, by: inventor.id });
      log(st, 'invention', `${inventor.name}が「${next.name}」を発明した。${next.text}`, [inventor.id], true);
      remember(st, inventor, `「${next.name}」を発明した。みんなに驚かれた`);
      if (next.id === 'shelter') {
        for (const r of alive(st)) if (r.partnerId && r.sex === 'm' && !r.hutId) buildHut(st, r, byId(st, r.partnerId));
      }
      if (next.id === 'farming') for (const r of adults) if (rand(st) < 0.35 && r.job !== 'elder') { r.job = 'farm'; }
    }

    // 季節の出来事
    const dayOfSeason = st.day % DAYS_PER_SEASON;
    if (dayOfSeason === 0) {
      if (season === 0) {
        prune(st);
        const pop = alive(st).length;
        log(st, 'year', `${Math.floor(st.day / DAYS_PER_YEAR) + 1}年目の春が来た。住民は${pop}人`, [], false);
      }
      if (season === 3 && st.food > living.length * 25) {
        log(st, 'harvest', '蓄えがたっぷりある。今年の冬は越せそうだ', [], false);
      }
    }
    const hungry = living.length && living.reduce((s, r) => s + r.hunger, 0) / living.length;
    if (hungry > 50 && st.day - st.lastFamineDay > DAYS_PER_YEAR / 2) {
      st.lastFamineDay = st.day;
      log(st, 'famine', `食べ物が足りず、みんなお腹をすかせている（${SEASONS[season]}）`, [], true);
    }

    // 旅人がやってくる（人が少なくなりすぎたとき）
    if (alive(st).length < 5 && rand(st) < 0.01) {
      const a1 = makeResident(st, { sex: 'm', birthDay: st.day - yearsToDays(18 + rand(st) * 10) });
      const a2 = makeResident(st, { sex: 'f', birthDay: st.day - yearsToDays(18 + rand(st) * 10) });
      for (const r of [a1, a2]) { r.spot = pick(st, spots.home); remember(st, r, '遠い土地から旅をして、ここにたどり着いた'); }
      log(st, 'arrival', `遠くから${a1.name}と${a2.name}が旅をしてたどり着いた`, [a1.id, a2.id], true);
    }

    // 村の時代の入り口
    if (!st.villageReady && has(st, 'farming') && alive(st).length >= 25) {
      st.villageReady = true;
      log(st, 'era', '畑が広がり、人も増えた。ここはもう「村」と呼べるかもしれない', [], true);
    }

    makePosts(st, season);
  }

  // ---- つぶやき（決まりごとで作る。第2段階の後半で、大事な場面だけAIが書く） ----
  const POST_LINES = {
    gather: ['森で木の実をたくさん見つけた', 'きのこを採った。食べられるかは、明日のお腹が教えてくれる', '{season}の森はいいにおいがする', '甘い実のなる木を見つけた。場所は秘密', 'カゴいっぱいに草の根を掘った', '今日は何も見つからなかった。森がけちだ'],
    hunt: ['大きなシカを追いかけたが、逃げられた', '獲物をしとめた。今夜はごちそうだ', '足あとを三日追っている。もうすぐだ', '{friend}と二人でイノシシを追い込んだ', '獣の気配がない日は、空ばかり見ている'],
    fish: ['水辺で魚を{n}匹つかまえた', '今日は一匹もかからなかった', '{season}の水は冷たい', '水に映った自分の顔を、しばらく見ていた', '大きな魚が跳ねた。明日こそ'],
    farm: ['畑に芽が出た', '雨が降ってほしい', '土をいじっていると落ち着く', '{friend}が畑を手伝ってくれた'],
    child: ['{friend}と石を投げて遊んだ', '大きくなったら{dream}をやりたい', '虫をつかまえた。見せたらみんな逃げた', '火のそばで昔話を聞いた'],
    elder: ['若いころは、このあたりにも大きな獣がいた', '{friend}は、わしの若いころにそっくりだ', '腰が痛い。でも口はまだ動く', '星の並びで季節がわかる。若い者に教えておこう'],
    hungry: ['お腹がすいた', '木の皮でもかじりたい気分だ', '{friend}が少し食べ物を分けてくれた', '次の季節まで、もつだろうか'],
    cold: ['寒い。火のそばから離れたくない', '指先の感覚がない', '吐く息が白い'],
    coldNoFire: ['寒い。みんなで身を寄せ合って眠った', '夜が長くて、こわい'],
    friend: ['{friend}といると落ち着く', '{friend}とくだらない話で笑った', '{friend}に助けられた。借りができた'],
    enemy: ['{enemy}とは、もう口をききたくない', '{enemy}がまた文句を言っている'],
  };
  const SEASON_WORDS = ['春', '夏', '秋', '冬'];

  function fill(st, text, r) {
    const needsPeople = text.includes('{friend}') || text.includes('{enemy}');
    const friends = !needsPeople ? [] : Object.entries(r.affinity).filter(([, v]) => v > 15).map(([k]) => byId(st, +k)).filter((o) => o && o.alive);
    const enemies = !needsPeople ? [] : Object.entries(r.affinity).filter(([, v]) => v < -30).map(([k]) => byId(st, +k)).filter((o) => o && o.alive);
    if (text.includes('{friend}') && !friends.length) return null;
    if (text.includes('{enemy}') && !enemies.length) return null;
    return text
      .replace('{friend}', friends.length ? pick(st, friends).name : '')
      .replace('{enemy}', enemies.length ? pick(st, enemies).name : '')
      .replace('{season}', SEASON_WORDS[Math.floor((st.day % DAYS_PER_YEAR) / DAYS_PER_SEASON)])
      .replace('{n}', String(2 + Math.floor(rand(st) * 5)))
      .replace('{dream}', pick(st, ['狩り', '漁', '採集', has(st, 'farming') ? '畑仕事' : '火の番']));
  }

  function addPost(st, r, text, kind) {
    if (!text) return;
    const fans = Object.values(r.affinity).filter((v) => v > 20).length;
    st.posts.push({
      id: st.nextPostId++,
      day: st.day,
      t: 0.3 + rand(st) * 0.6,
      by: r.id,
      text,
      kind: kind || 'daily',
      gesture: !has(st, 'words'),
      likes: Math.max(0, Math.round(fans * (0.4 + rand(st) * 0.6) + (kind === 'big' ? 3 : 0))),
    });
    if (st.posts.length > 450) st.posts.splice(0, st.posts.length - 450);
  }

  function makePosts(st, season) {
    if (!st.posts) { st.posts = []; st.nextPostId = 1; }
    const people = alive(st).filter((r) => age(st, r) >= yearsToDays(5));
    // その日の出来事への反応
    const today = [];
    for (let i = st.events.length - 1; i >= 0 && st.events[i].day === st.day; i--) today.unshift(st.events[i]);
    for (const e of today) {
      const main = e.ids.length ? byId(st, e.ids[0]) : null;
      if (e.kind === 'birth' && main) {
        const parent = byId(st, e.ids[rand(st) < 0.5 ? 1 : 2]);
        if (parent && parent.alive) addPost(st, parent, pick(st, [`${main.name}が生まれた。小さな手が、指をにぎり返してきた`, `${main.name}が生まれた。泣き声が大きい。きっと強い子になる`, `家族が増えた。名前は${main.name}`]), 'big');
      } else if (e.kind === 'couple' && main) {
        const other = byId(st, e.ids[1]);
        if (other) addPost(st, main, pick(st, [`${other.name}と一緒に暮らすことにした`, `${other.name}と火を囲む夜が、いちばん好きだ`]), 'big');
      } else if (e.kind === 'death' && main) {
        const mourners = people.filter((o) => o.partnerId === null && (o.parentIds.includes(main.id) || main.parentIds.includes(o.id)) || (o.memories.length && o.memories[o.memories.length - 1].text.includes(main.name)));
        const m = mourners.length ? pick(st, mourners) : null;
        if (m) addPost(st, m, pick(st, [`${main.name}がいなくなって、火のまわりが静かだ`, `${main.name}のことを、ずっと覚えている`, `${main.name}が最後に笑った顔を思い出す`]), 'big');
      } else if (e.kind === 'invention' && main) {
        const inv = st.inventions[st.inventions.length - 1];
        addPost(st, main, pick(st, [`「${inv.name}」を作った。みんな目を丸くしていた`, `ずっと考えていたことが、やっと形になった。「${inv.name}」と呼ぶことにする`]), 'big');
        const fan = pick(st, people);
        if (fan && fan !== main) addPost(st, fan, `${main.name}の「${inv.name}」、すごい。真似してみる`, 'big');
      } else if (e.kind === 'quarrel' && main && rand(st) < 0.5) {
        const other = byId(st, e.ids[1]);
        if (other) addPost(st, main, `${other.name}とはもう話したくない`, 'daily');
      }
    }
    // ふだんのつぶやき
    for (const r of people) {
      if (rand(st) > 0.035 * (0.4 + r.traits.sociability)) continue;
      let pool;
      if (r.hunger > 50) pool = POST_LINES.hungry;
      else if (season === 3 && rand(st) < 0.25) pool = has(st, 'fire') ? POST_LINES.cold : POST_LINES.coldNoFire;
      else if (rand(st) < 0.2) pool = rand(st) < 0.7 ? POST_LINES.friend : POST_LINES.enemy;
      else pool = POST_LINES[r.job] || POST_LINES.gather;
      for (let i = 0; i < 3; i++) {
        const text = fill(st, pick(st, pool), r);
        if (text) { addPost(st, r, text, 'daily'); break; }
      }
    }
  }

  // 保存の大きさを抑える（共有の保存先は1つあたり256KBまで）
  function prune(st) {
    for (const r of st.residents) {
      const ent = Object.entries(r.affinity);
      if (ent.length > 16) {
        ent.sort((x, y) => Math.abs(y[1]) - Math.abs(x[1]));
        r.affinity = Object.fromEntries(ent.slice(0, 16));
      }
      if (!r.alive && r.memories.length > 6) r.memories = r.memories.slice(-6);
    }
    const dead = st.residents.filter((r) => !r.alive);
    if (dead.length > 120) {
      const drop = new Set(dead.slice(0, dead.length - 120).map((r) => r.id));
      st.residents = st.residents.filter((r) => !drop.has(r.id));
    }
    if (st.events.length > 700) {
      const keep = st.events.filter((e) => e.major || e.kind === 'invention');
      const minor = st.events.filter((e) => !(e.major || e.kind === 'invention')).slice(-(700 - Math.min(keep.length, 300)));
      st.events = [...keep.slice(-300), ...minor].sort((x, y) => x.day - y.day);
    }
    if (st.posts && st.posts.length > 400) st.posts.splice(0, st.posts.length - 400);
  }

  function buildHut(st, a, b) {
    const used = new Set(alive(st).map((r) => r.hutId).filter((id) => id));
    const empty = st.huts.find((h) => !used.has(h.id));
    if (empty) {
      for (const r of [a, b]) if (r) { r.hutId = empty.id; remember(st, r, '空いていた小屋に移り住んだ'); }
      return empty;
    }
    const taken = new Set(st.huts.map((h) => h.x + ',' + h.y));
    taken.add(st.camp.x + ',' + st.camp.y);
    for (let rad = 1; rad < 10; rad++) {
      const cands = [];
      for (let dy = -rad; dy <= rad; dy++) for (let dx = -rad; dx <= rad; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== rad) continue;
        const x = st.camp.x + dx, y = st.camp.y + dy, t = tileAt(st.map, x, y);
        if ((t === T.GRASS || t === T.SAND) && !taken.has(x + ',' + y) && (dx + dy) % 2 === 0) cands.push({ x, y });
      }
      if (cands.length) {
        const spot = pick(st, cands);
        const hut = { id: st.huts.length + 1, x: spot.x, y: spot.y, day: st.day };
        st.huts.push(hut);
        for (const r of [a, b]) if (r) { r.hutId = hut.id; remember(st, r, '自分たちの小屋を建てた'); }
        for (const id of [...(a ? a.childIds : []), ...(b ? b.childIds : [])]) { const c = byId(st, id); if (c && c.alive && c.job === 'child') c.hutId = hut.id; }
        return hut;
      }
    }
    return null;
  }

  function die(st, r, cause) {
    r.alive = false;
    r.deathDay = st.day;
    r.deathCause = cause;
    st.stats.deaths++;
    r.affinity = {};
    const y = ageYears(st, r);
    log(st, 'death', `${r.name}が${cause}で亡くなった（${y}歳）`, [r.id], y >= 40 || r.childIds.length >= 3);
    for (const o of st.residents) {
      if (!o.alive) continue;
      if (o.partnerId === r.id) { o.partnerId = null; remember(st, o, `連れ合いの${r.name}を亡くした`); }
      else if ((o.affinity[r.id] || 0) > 40 || o.parentIds.includes(r.id) || r.parentIds.includes(o.id)) remember(st, o, `${r.name}が亡くなり、深く悲しんだ`);
      delete o.affinity[r.id];
    }
  }

  // ---- 留守中のまとめ計算 ----
  function snapshot(st) {
    return { day: st.day, pop: alive(st).length, births: st.stats.births, deaths: st.stats.deaths, inventions: st.inventions.length, huts: st.huts.length, eventCount: st.events.length };
  }

  function summarize(st, before) {
    const days = st.day - before.day;
    const events = st.events.filter((e) => e.day > before.day);
    return {
      days,
      fromDay: before.day,
      toDay: st.day,
      popBefore: before.pop,
      popAfter: alive(st).length,
      births: st.stats.births - before.births,
      deaths: st.stats.deaths - before.deaths,
      newInventions: st.inventions.slice(before.inventions),
      newHuts: st.huts.length - before.huts,
      highlights: events.filter((e) => e.major && e.kind !== 'invention').slice(-6),
    };
  }

  // 現実の時刻 now までの世界を進める。戻り値は留守中のまとめ。
  function advanceTo(st, realNow) {
    const elapsed = Math.max(0, realNow - st.lastRealTime);
    let target = st.worldTime + elapsed / REAL_MS_PER_WORLD_DAY;
    let skipped = 0;
    if (target - st.day > MAX_CATCHUP_DAYS) {
      skipped = Math.floor(target - st.day - MAX_CATCHUP_DAYS);
      target = st.day + MAX_CATCHUP_DAYS + (target % 1);
    }
    const before = snapshot(st);
    while (st.day < Math.floor(target)) stepDay(st);
    st.worldTime = target;
    st.lastRealTime = realNow;
    const sum = summarize(st, before);
    sum.skippedDays = skipped;
    return sum;
  }

  function formatDate(day) {
    const y = Math.floor(day / DAYS_PER_YEAR) + 1;
    const d = day % DAYS_PER_YEAR;
    return `${y}年目 ${SEASONS[Math.floor(d / DAYS_PER_SEASON)]} ${(d % DAYS_PER_SEASON) + 1}日`;
  }

  function formatSpan(days) {
    const y = Math.floor(days / DAYS_PER_YEAR);
    const m = Math.floor((days % DAYS_PER_YEAR) / 30);
    const d = days % 30;
    if (y > 0) return m > 0 ? `${y}年${m}か月` : `${y}年`;
    if (m > 0) return `${m}か月`;
    return `${d}日`;
  }

  globalThis.AISim = {
    prune, POST_LINES, T, MAP_W, MAP_H, SEASONS, INVENTIONS, JOB_NAMES, DAYS_PER_YEAR, DAYS_PER_SEASON, REAL_MS_PER_WORLD_DAY, WORLD_DAYS_PER_REAL_DAY,
    createWorld, stepDay, advanceTo, formatDate, formatSpan, traitLabel, byId, age, ageYears, alive, tileAt, has,
  };
})();
