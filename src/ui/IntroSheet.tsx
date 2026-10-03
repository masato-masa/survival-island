// 神のお告げ。初回起動時に一度だけ出し、万能工具を授ける。

import { Sheet } from './Sheets';

export function IntroSheet({ onReceive }: { onReceive: () => void }) {
  return (
    <Sheet title="神のお告げ" onClose={onReceive}>
      <p className="sheet-text">
        目を覚ますと、そこは知らない島の浜辺だった。あなたのほかに人影はない。
      </p>
      <p className="sheet-text">
        「よく来た。ここは誰のものでもない島だ。木を切り、岩を砕き、畑を耕して、
        好きなように暮らすといい。」
      </p>
      <p className="sheet-text">
        「まずはこれを授けよう。斧にも、つるはしにも、くわにもなる、万能の道具だ。」
      </p>
      <button className="sheet-btn" onClick={onReceive}>
        うけとる
      </button>
    </Sheet>
  );
}
