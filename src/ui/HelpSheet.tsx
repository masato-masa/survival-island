// あそびかた: 画面の見かたと基本の遊びかた。左上の顔アイコン → メニューからだけ開く。
// 数字は data.ts から読む（数値を変えても説明が古くならない）。

import { ISLAND_LEVEL_POINTS, SERIES_BONUS, STAMINA_BASE, STAMINA_REGEN_MS, XP_PER_STAMINA } from '../game/data';
import { HeartIcon, SproutIcon, StarIcon } from './icons';
import { Sheet } from './Sheets';

const regenMin = Math.round(STAMINA_REGEN_MS / 60000);
const maxLevel = ISLAND_LEVEL_POINTS.length;

export function HelpSheet({ onClose }: { onClose: () => void }) {
  return (
    <Sheet title="あそびかた" onClose={onClose}>
      <div className="help-body">
        <section className="help-sec">
          <h3>島での過ごしかた</h3>
          <ul className="help-list">
            <li>画面をドラッグして歩きます。ピンチで拡大・縮小できます。</li>
            <li>光っている相手（木・花・畑・看板・宝箱）をタップすると、約 3 秒かけて作業します。</li>
            <li>とれたものはポンと飛び出して、自動で持ち物に入ります。</li>
            <li>木は切ると幹になり、幹を切ると苗木がとれます。花を摘むと花びらと花の種がとれます。</li>
            <li>右の「模様替え」で、家具を置く・しまう・動かす、苗木や種を植える、ができます。</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>
            <HeartIcon />
            ハート ＝ スタミナ
          </h3>
          <p>
            {`作業するとへります：`}<b>伐採・花摘み・畑・クラフト</b>{`。0 だとできません。`}
            <b>{regenMin} 分に 1 つ</b>{`ずつ回復し、ゲームを閉じている間も進みます。最大は ${STAMINA_BASE} から始まり、スキルでふやせます。`}
          </p>
        </section>

        <section className="help-sec">
          <h3>
            <SproutIcon />
            島レベル
          </h3>
          <p>
            家具を置くと<b>島ポイント</b>がたまります。家具ごとの得点に、同じシリーズをそろえた
            <b>統一ボーナス</b>（{SERIES_BONUS.slice()
              .reverse()
              .map((b) => `${b.count} 個で +${b.bonus}`)
              .join('、')}）が加わります。
          </p>
          <p>
            ポイントが {ISLAND_LEVEL_POINTS.slice(1).join(' / ')} に届くたびにレベルアップ（最高 {maxLevel}）。
            新しいクラフトのレシピ、育てられる種、スキルの上限がひらきます。
            ゲージは「あと何ポイントか」を表します。
          </p>
        </section>

        <section className="help-sec">
          <h3>
            <StarIcon />
            経験値
          </h3>
          <p>
            {`スタミナを 1 使うごとに ${XP_PER_STAMINA} たまります。島の`}<b>謎の遺跡</b>{`に触れて、スキル（伐採・畑・スタミナなど）を授かるときに使います。`}
          </p>
        </section>

        <section className="help-sec">
          <h3>クラフトと畑</h3>
          <ul className="help-list">
            <li>
              <b>作業台</b>に触れて家具を作ります。作るには時間がかかり、できあがりは作業台でうけとります。
            </li>
            <li>種は畑に植えると、時間がたって育ちます。育ったらタップで収穫。</li>
            <li>島レベルが上がると、作れる家具や育てられる作物がふえます。</li>
          </ul>
        </section>

        <section className="help-sec">
          <h3>画面の右がわ</h3>
          <ul className="help-list">
            <li>
              <b>もちもの</b>：集めた材料と家具。<b>もくひょう</b>：次にやることの目安。
            </li>
            <li>左上の顔をタップすると、このあそびかたと設定を開けます。</li>
          </ul>
        </section>
      </div>
    </Sheet>
  );
}
