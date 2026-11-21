// 序盤 10 分と、天気ごとのテンポ（SI-22）。自動操作（ボット）で測って表にする。
//   ボット: 畑にカブを 2 つ植える → 木を切る → 育ったら収穫して スープを食べる（力もち） → 木材 16 個で 1 件目のおねがい。
//   木は地図に 13 本（1 本 4 回で幹まで消える = 52 回）なので、切り尽くすまでを測る。
//   1 回の行動 = 歩き 2 秒 + 行動の長さ（actionMs）。スタミナが 0 なら 1 回復するまで待つ。
// 数値は表に出すだけでなく、目標の幅（重みでなく目安）を soft に確かめる。
import { afterEach, describe, expect, it } from 'vitest';

import { chooseCrop, cook, farmAction, hitNode } from '../src/game/actions';
import { CROPS } from '../src/game/data';
import { actionMs, islandLevel } from '../src/game/rules';
import { currentStamina } from '../src/game/time';
import { setWeatherOverride, type WeatherId } from '../src/game/weather';
import { createSim } from './sim';
import { freshSave, world } from './helpers';
import { FURNITURE } from '../src/game/data';

afterEach(() => setWeatherOverride('plain'));

const WALK_MS = 2000;
const MIN = 60000;

function earlyBot(weather: WeatherId, limitMin: number) {
  setWeatherOverride(weather);
  const save = freshSave(0);
  let now = 0;
  let actions = 0;
  let idleMs = 0;
  let firstRequestAt: number | null = null;
  const plot = world.plots[0]!;
  const trees = world.nodes.filter((n) => n.kind === 'tree');
  let ti = 0;
  let misses = 0;

  const waitForStamina = () => {
    const s = currentStamina(save, now);
    if (s.value >= 1) return;
    idleMs += s.nextInMs;
    now += s.nextInMs;
  };
  const step = (tool: 'axe' | 'farm', fn: () => boolean) => {
    let fails = 0;
    for (;;) {
      waitForStamina();
      if (now >= limitMin * MIN) return false;
      now += WALK_MS;
      const ok = fn();
      if (ok) {
        now += actionMs(save, tool, now);
        actions++;
        return true;
      }
      if (++fails > 0) return false; // 行き詰まり（その木は叩けないなど）。次の対象へ進めるよう呼び出し側へ返す
    }
  };

  chooseCrop(save, plot.id, 'turnip');
  const t0 = plot.tiles[0]!;
  const t1 = plot.tiles[1]!;
  step('farm', () => farmAction(world, save, plot, t0.x, t0.y, now).ok);
  step('farm', () => farmAction(world, save, plot, t1.x, t1.y, now).ok);
  const ready = now + CROPS.turnip.growMs; // 雨は 3 割育った状態から（plantedAt を遡る）なので、準備できる時刻は下で見直す
  void ready;

  let cooked = false;
  while (now < limitMin * MIN) {
    // 育っていれば収穫してスープ
    if (!cooked) {
      const tile = save.plots[plot.id]?.tiles[`${t0.x},${t0.y}`];
      if (tile && now >= tile.plantedAt + CROPS.turnip.growMs) {
        step('farm', () => farmAction(world, save, plot, t0.x, t0.y, now).ok);
        step('farm', () => farmAction(world, save, plot, t1.x, t1.y, now).ok);
        cook(save, 'turnipSoup', now);
        cooked = true;
        continue;
      }
    }
    const tree = trees[ti % trees.length]!;
    const done = step('axe', () => hitNode(world, save, tree, now).ok);
    if (!done) {
      ti++;
      if (++misses > trees.length) break; // 叩ける木が無い
      continue;
    }
    misses = 0;
    if (save.nodes[tree.id]?.destroyedAt != null) ti++;
    if (firstRequestAt == null && save.request.done.length > 0) firstRequestAt = now;
  }
  return { actions, endNow: now, firstRequestAt, idleMs, xp: save.totalXp, stamina: currentStamina(save, now).value };
}

/** 島レベル 2・3 に着くまでの時間（4 エリアを開くところから。progression と同じ手順）。 */
function levelTimes(weather: WeatherId) {
  setWeatherOverride(weather);
  const sim = createSim();
  const { save, destroyNode, buy, craftAndPlace } = sim;
  buy('axePower', 10);
  for (const b of world.nodes.filter((n) => n.area === 'forest' && n.kind === 'borderTree')) destroyNode(b);
  buy('pickHard', 10);
  for (const b of world.nodes.filter((n) => n.area === 'rocks' && n.kind === 'borderRock')) destroyNode(b);
  craftAndPlace(FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 1).map((f) => f.id));
  const lv2 = sim.now;
  buy('axePower', 25);
  for (const b of world.nodes.filter((n) => n.area === 'hill' && n.kind === 'borderTree')) destroyNode(b);
  craftAndPlace(FURNITURE.filter((f) => 'level' in f.learn && f.learn.level === 2).map((f) => f.id), 3);
  return { lv2, lv3: sim.now, level: islandLevel(save) };
}

describe('テンポ: 序盤 10 分と島レベル', () => {
  it('天気ごとの表（最初の 10 分の行動数・1 件目のおねがい・島レベル 2・3）', () => {
    const rows: string[] = [];
    const ids: WeatherId[] = ['plain', 'sunny', 'cloudy', 'rainy'];
    const out: Record<string, ReturnType<typeof earlyBot>> = {};
    for (const w of ids) {
      const r = earlyBot(w, 10);
      out[w] = r;
      const lv = levelTimes(w);
      rows.push(
        `${w.padEnd(6)} 森の木を切り尽くすまで ${String(r.actions).padStart(2)} 回（${(r.endNow / MIN).toFixed(1)} 分）/ スタミナ待ち ${(r.idleMs / MIN).toFixed(1)} 分 / 1 件目のおねがい ${
          r.firstRequestAt == null ? '10 分では届かず' : (r.firstRequestAt / MIN).toFixed(1) + ' 分'
        } / 島Lv2 ${(lv.lv2 / MIN).toFixed(0)} 分 / 島Lv3 ${(lv.lv3 / MIN).toFixed(0)} 分`,
      );
    }
    // eslint-disable-next-line no-console
    console.log('[テンポ測定]\n' + rows.join('\n'));
    // 目安（必須条件ではなく、手が止まらない幅）: 序盤にスタミナ待ちで止まる時間が 15% 以内（回復を島レベル 1・2 で速くする前は 2.7/5.3 分 = 51%）
    for (const w of ids) expect(out[w]!.idleMs / out[w]!.endNow).toBeLessThan(0.15);
  });
});
