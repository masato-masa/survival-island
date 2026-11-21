// 天気（SI-18）。日付（日本時間 0 時切替、dailyDay）から決まる。同じ日なら必ず同じ。時刻は now を引数で受ける。
//
//   晴れ   : 木・岩・花・畑の作業が 1 割はやい
//   くもり : ごはんの効き目が 1.5 倍長持ち（10 分 → 15 分）
//   雨     : 作業は 1 割おそい（ぬかるみ）が、畑は植えた作物が 3 割進んだ状態で育ち、釣りは大物が出やすい
//
// 「今日は何をするか」を選ぶ材料。見張り台を 2 段階以上建て増すと、あしたの天気が見える。

// daily.ts は rules.ts を読み込むので、循環しないよう日付の計算だけここに持つ（daily.ts の dailyDay と同じ）。
const DAY_MS = 24 * 60 * 60 * 1000;
const JST_MS = 9 * 60 * 60 * 1000;
const dailyDay = (now: number) => Math.floor((now + JST_MS) / DAY_MS);

export type WeatherId = 'sunny' | 'cloudy' | 'rainy' | 'plain';

export interface WeatherDef {
  id: WeatherId;
  name: string;
  /** 1 行の効き目（画面にそのまま出す）。 */
  effect: string;
  /** 重み（日付から選ぶときの出やすさ）。 */
  weight: number;
}

export const WEATHERS: Record<WeatherId, WeatherDef> = {
  sunny: { id: 'sunny', name: '晴れ', effect: '木・岩・花・畑の作業が 1 割はやい', weight: 45 },
  cloudy: { id: 'cloudy', name: 'くもり', effect: 'ごはんの効き目が 15 分に長持ち', weight: 25 },
  plain: { id: 'plain', name: '（なし）', effect: '', weight: 0 }, // テスト用。日付からは出ない
  rainy: { id: 'rainy', name: '雨', effect: '畑の作物が早く育ち、大物が釣れやすい（作業は 1 割おそい）', weight: 30 },
};

export const WEATHER_ORDER: Exclude<WeatherId, 'plain'>[] = ['sunny', 'cloudy', 'rainy'];

/** 晴れの作業の長さの倍率（0.9 = 1 割はやい）。 */
export const SUNNY_ACTION_FACTOR = 0.9;
/** 雨の作業の長さの倍率。 */
export const RAIN_ACTION_FACTOR = 1.1;
/** くもりのごはんの効き目の長さの倍率。 */
export const CLOUDY_BUFF_FACTOR = 1.5;
/** 雨の日に植えた作物は、この割合だけ育った状態から始まる。 */
export const RAIN_CROP_HEADSTART = 0.3;
/** 雨の日の大物（perfect のとき）の足し分。 */
export const RAIN_BIG_FISH_BONUS = 0.15;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** その日の天気。 */
export function weatherOnDay(day: number): WeatherId {
  const rnd = mulberry32(day * 40503 + 9176);
  rnd();
  const total = WEATHER_ORDER.reduce((n, id) => n + WEATHERS[id].weight, 0);
  let r = rnd() * total;
  for (const id of WEATHER_ORDER) {
    r -= WEATHERS[id].weight;
    if (r < 0) return id;
  }
  return 'sunny';
}

/** 確認用: URL の ?weather=rainy などで上書きできる（開発・確認のためだけ。保存はしない）。 */
let override: WeatherId | null = null;
export function setWeatherOverride(id: WeatherId | null): void {
  override = id;
}

/** now の天気。 */
export function weatherAt(now: number): WeatherId {
  return override ?? weatherOnDay(dailyDay(now));
}

/** あしたの天気。 */
export function tomorrowWeather(now: number): WeatherId {
  return weatherOnDay(dailyDay(now) + 1);
}
