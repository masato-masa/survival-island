// あそびかた: 操作説明。プレイ画面右上の ? からだけ開く。

import { Sheet } from './Sheets';

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="あそびかた" onClose={onClose}>
      <ul className="help-list">
        <li>ドラッグで歩きます。指を置いた場所を中心にした、見えないスティックです。</li>
        <li>光っている相手（木・岩・看板・宝箱・畑）をタップすると道具を使います。</li>
        <li>謎の遺跡に触れるとスキルを授かります。</li>
        <li>作業台に触れると家具をクラフトできます。</li>
        <li>ピンチで拡大縮小します。</li>
        <li>模様替えモードでは、置き場所をタップして家具を置いたりしまったりできます。</li>
      </ul>
    </Sheet>
  );
}
