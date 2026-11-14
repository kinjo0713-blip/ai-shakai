// 世界の計算のテスト。実行: node tests/sim.test.mjs
import assert from 'node:assert/strict';
import '../src/sim.js';
const S = globalThis.AISim;

const DAY_MS = 24 * 3600 * 1000;

// 1. 同じ種と同じ時間なら、同じ歴史になる
{
  const a = S.createWorld(42, 0), b = S.createWorld(42, 0);
  S.advanceTo(a, 30 * DAY_MS); S.advanceTo(b, 30 * DAY_MS);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
}

// 2. 時間の速さ：現実の1日 = 世界の90日
{
  const w = S.createWorld(1, 0);
  const sum = S.advanceTo(w, DAY_MS);
  assert.equal(sum.days, 90);
}

// 3. 小刻みに進めても、まとめて進めても同じ結果になる
{
  const a = S.createWorld(7, 0), b = S.createWorld(7, 0);
  S.advanceTo(a, 10 * DAY_MS);
  for (let t = 0; t <= 10 * DAY_MS; t += DAY_MS / 3) S.advanceTo(b, t);
  assert.equal(a.day, b.day);
  assert.equal(JSON.stringify(a.residents), JSON.stringify(b.residents));
}

// 4. 保存（JSON）して読み戻しても続きが同じ
{
  const a = S.createWorld(9, 0);
  S.advanceTo(a, 5 * DAY_MS);
  const b = JSON.parse(JSON.stringify(a));
  S.advanceTo(a, 9 * DAY_MS); S.advanceTo(b, 9 * DAY_MS);
  assert.equal(JSON.stringify(a), JSON.stringify(b));
}

// 5. 100年進めても、多くの世界で人が絶えず、増えすぎもしない
const rows = [];
for (let seed = 1; seed <= 12; seed++) {
  const w = S.createWorld(seed, 0);
  const t0 = Date.now();
  const marks = [];
  for (const years of [5, 20, 50, 100]) {
    S.advanceTo(w, (years * 360 / 90) * DAY_MS);
    marks.push(S.alive(w).length);
  }
  rows.push({ seed, pop: marks.join('→'), inv: w.inventions.map((i) => i.name + '@' + Math.floor(i.day / 360)).join(' '), huts: w.huts.length, village: w.villageReady, ms: Date.now() - t0 });
  const pop = S.alive(w).length;
  assert.ok(pop > 0 && pop < 400, `seed ${seed}: pop ${pop}`);
}
console.table(rows);

// 6. 長い留守は100年で打ち切る
{
  const w = S.createWorld(3, 0);
  const sum = S.advanceTo(w, 1000 * DAY_MS);
  assert.equal(sum.days, 36000);
  assert.ok(sum.skippedDays > 0);
}
console.log('ok');
