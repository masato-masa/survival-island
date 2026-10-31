import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { CraftSheet } from '../src/ui/CraftSheet';
import { freshSave } from './helpers';

describe('クラフト画面', () => {
  it('入手元がまだ無い材料（銅）が要るレシピに「洞窟で手に入る（準備中）」と出る（SI-7）', () => {
    const save = freshSave();
    save.maxPoints = 100; // 島レベル 5。銅が要るかまど・石灯籠などが開いている
    const html = renderToStaticMarkup(
      createElement(CraftSheet, { save, now: () => 0, onClose: () => {}, onCraft: () => {}, onCollect: () => {} }),
    );
    expect(html).toContain('銅鉱石は洞窟で手に入る（準備中）');
  });
});
