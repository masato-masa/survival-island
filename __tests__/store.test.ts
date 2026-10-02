// store の時間のかかる行動（約 3 秒）: 始める → 動けない・二重に始められない → update で結果が出る。

import { describe, expect, it } from 'vitest';

import { createStore } from '../src/game/store';
import type { GameEvent } from '../src/game/types';

function setup() {
  let t = 1_000_000;
  const store = createStore({ storage: false, clock: () => t });
  const events: GameEvent[] = [];
  store.onEvents((evs) => events.push(...evs));
  return {
    store,
    events,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

describe('時間のかかる行動', () => {
  it('木の前でタップすると 3 秒の伐採が始まり、終わると幹になる', () => {
    const { store, events, advance } = setup();
    const tree = store.world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    const save = store.get();
    save.player.x = tree.x + 0.5;
    save.player.y = tree.y + 1.5; // 木の真下（体の中心が木から 1 マス以内）
    save.player.dir = 'up';
    expect(store.target()?.kind).toBe('node');

    const r = store.actOnTarget();
    expect(r.ok).toBe(true);
    const action = store.currentAction();
    expect(action).toMatchObject({ kind: 'chop', x: tree.x, y: tree.y, nodeId: tree.id, nodeKind: 'tree' });
    expect((action?.endsAt ?? 0) - (action?.startedAt ?? 0)).toBe(3000);
    expect(events.some((e) => e.type === 'actionStarted')).toBe(true);

    // 作業中は動けず、二重に始められない
    const before = { ...save.player };
    store.move(1, 0, 0.5);
    expect(save.player.x).toBe(before.x);
    const again = store.actOnTarget();
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.reason).toBe('cooldown');

    advance(2999);
    store.update();
    expect(store.currentAction()).not.toBeNull();
    expect(save.inventory.wood ?? 0).toBe(0);

    advance(1);
    store.update();
    expect(store.currentAction()).toBeNull();
    expect(save.nodes[tree.id]?.stump).toBe(true);
    expect(save.inventory.wood).toBe(2);
    expect(events.some((e) => e.type === 'dropped')).toBe(true);
  });

  it('スタミナが 0 なら始めない', () => {
    const { store } = setup();
    const tree = store.world.nodes.find((n) => n.kind === 'tree');
    if (!tree) throw new Error('no tree');
    const save = store.get();
    save.player.x = tree.x + 0.5;
    save.player.y = tree.y + 1.5;
    save.stamina.value = 0;
    const r = store.actOnTarget();
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('noStamina');
    expect(store.currentAction()).toBeNull();
  });

  it('作業台の前では furniture が対象になり、行動は始まらない', () => {
    const { store } = setup();
    const save = store.get();
    const anchor = Object.entries(save.placements).find(([, id]) => id === 'woodWorkbench')?.[0];
    if (!anchor) throw new Error('no workbench');
    const [x, y] = anchor.split(',').map(Number);
    save.player.x = (x ?? 0) + 0.5;
    save.player.y = (y ?? 0) + 1.5;
    save.player.dir = 'up';
    expect(store.target()).toMatchObject({ kind: 'furniture', furnitureId: 'woodWorkbench' });
    expect(store.actOnTarget().ok).toBe(true);
    expect(store.currentAction()).toBeNull();
  });
});
