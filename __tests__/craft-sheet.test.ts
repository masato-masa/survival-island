import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CraftSheet } from '../src/ui/CraftSheet';
import { freshSave } from './helpers';

describe('クラフト画面', () => {
  it('銅は洞窟で採れるようになったので、「洞窟で手に入る（準備中）」は出ない（SI-6。SI-7 の表示を外した）', () => {
    const save = freshSave();
    save.maxPoints = 100; // 島レベル 5。銅が要るかまど・石灯籠などが開いている
    const html = renderToStaticMarkup(
      createElement(CraftSheet, { save, now: () => 0, onClose: () => {}, onCraft: () => {}, onCollect: () => {} }),
    );
    expect(html).toContain('かまど');
    expect(html).not.toContain('準備中');
  });
});
