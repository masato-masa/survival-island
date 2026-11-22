// 既存のテストは天気を気にしない。何も効かない天気（plain）に固定する。天気の確認は weather.test.ts で天気を指定して行う。
import { setSeasonOverride } from '../../src/game/season';
import { setWeatherOverride } from '../../src/game/weather';

setWeatherOverride('plain');
setSeasonOverride('none');
