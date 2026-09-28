// 効果音。すべて WebAudio で合成する。音声ファイルは 1 つも置かない
// （読み込みゼロ・容量ゼロ・遅延ゼロ）。city-builders の sound.ts と同じ骨格。
//
// AudioContext はページ読み込み時ではなく、最初にどれかの play* が呼ばれた
// タイミング（＝最初のユーザー操作）で作る。作れなかった場合・設定で切って
// ある場合は、何もせず黙って続行する（例外を投げない）。
//
// 音は互いにぶつかる。直前に鳴らした音から一定時間内は次を間引く
// （失敗音・レベルアップだけは必ず鳴らす）。

import { isSoundEnabled } from './settings';

let ctx: AudioContext | null = null;
let unavailable = false;

function getContext(): AudioContext | null {
  if (unavailable) return null;
  if (ctx) {
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {
        // 再開できなくても致命的ではない
      });
    }
    return ctx;
  }
  try {
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const Ctor = w.AudioContext ?? w.webkitAudioContext;
    if (!Ctor) {
      unavailable = true;
      return null;
    }
    ctx = new Ctor();
    return ctx;
  } catch {
    unavailable = true;
    return null;
  }
}

/** 最初のユーザー操作（ホームの「はじめる」など）で、なるべく早く AudioContext を
 *  用意しておく。失敗しても何もしない。 */
export function primeAudio(): void {
  if (!isSoundEnabled()) return;
  try {
    getContext();
  } catch {
    // 何もしない
  }
}

let lastPlayedAt = 0;
const THROTTLE_MS = 55;

/** 直前の音から近すぎるときは間引く。force で強制的に鳴らす（失敗・レベルアップ用）。 */
function gate(force = false): boolean {
  const now = performance.now();
  if (!force && now - lastPlayedAt < THROTTLE_MS) return false;
  lastPlayedAt = now;
  return true;
}

interface ToneOptions {
  freq: number;
  duration: number;
  type?: OscillatorType;
  gain?: number;
  delay?: number;
  freqEnd?: number;
}

function tone(audioCtx: AudioContext, opts: ToneOptions): void {
  const { freq, duration, type = 'sine', gain = 0.16, delay = 0, freqEnd } = opts;
  const osc = audioCtx.createOscillator();
  const amp = audioCtx.createGain();
  osc.type = type;
  const t0 = audioCtx.currentTime + delay;
  osc.frequency.setValueAtTime(Math.max(freq, 1), t0);
  if (freqEnd !== undefined) {
    osc.frequency.exponentialRampToValueAtTime(Math.max(freqEnd, 1), t0 + duration);
  }
  amp.gain.setValueAtTime(0.0001, t0);
  amp.gain.exponentialRampToValueAtTime(Math.max(gain, 0.0005), t0 + Math.min(0.014, duration / 3));
  amp.gain.exponentialRampToValueAtTime(0.0001, t0 + duration);
  osc.connect(amp);
  amp.connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + duration + 0.03);
}

/** ノイズバースト（木を叩く・岩を砕くなど、質感のある音に使う）。 */
function noiseBurst(audioCtx: AudioContext, duration: number, gain: number, delay = 0): void {
  const bufferSize = Math.floor(audioCtx.sampleRate * duration);
  const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < bufferSize; i++) {
    data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
  }
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const amp = audioCtx.createGain();
  const t0 = audioCtx.currentTime + delay;
  amp.gain.setValueAtTime(gain, t0);
  amp.gain.exponentialRampToValueAtTime(0.0005, t0 + duration);
  src.connect(amp);
  amp.connect(audioCtx.destination);
  src.start(t0);
  src.stop(t0 + duration + 0.02);
}

/** 呼び出し全体を try/catch で包む。鳴らせなくても例外は外に出さない。 */
function play(force: boolean, body: (audioCtx: AudioContext) => void): void {
  if (!isSoundEnabled()) return;
  if (!gate(force)) return;
  try {
    const audioCtx = getContext();
    if (!audioCtx) return;
    body(audioCtx);
  } catch {
    // 鳴らせなくても続行
  }
}

/** 木を叩く: 乾いた木質のノック音 */
export function playChop(): void {
  play(false, (c) => {
    noiseBurst(c, 0.05, 0.2);
    tone(c, { freq: 210, freqEnd: 140, duration: 0.09, type: 'triangle', gain: 0.14 });
  });
}

/** 岩を叩く: 石の硬いクリック音 */
export function playMine(): void {
  play(false, (c) => {
    noiseBurst(c, 0.03, 0.16);
    tone(c, { freq: 900, freqEnd: 500, duration: 0.05, type: 'square', gain: 0.06 });
  });
}

/** 木・岩が壊れる: chop/mine より低く重い、崩れる音 */
export function playBreak(): void {
  play(false, (c) => {
    noiseBurst(c, 0.14, 0.22);
    tone(c, { freq: 150, freqEnd: 60, duration: 0.22, type: 'sine', gain: 0.16 });
  });
}

/** 植える: 土に触れる柔らかい音 */
export function playPlant(): void {
  play(false, (c) => {
    tone(c, { freq: 340, freqEnd: 260, duration: 0.1, type: 'sine', gain: 0.11 });
  });
}

/** 収穫: 明るく弾む音 */
export function playHarvest(): void {
  play(false, (c) => {
    [660, 880].forEach((freq, i) => {
      tone(c, { freq, duration: 0.11, type: 'triangle', gain: 0.13, delay: i * 0.06 });
    });
  });
}

/** クラフト・宝箱・スキル獲得: 達成感のある短いフレーズ */
export function playCraft(): void {
  play(false, (c) => {
    tone(c, { freq: 500, duration: 0.09, type: 'sine', gain: 0.13 });
    tone(c, { freq: 760, duration: 0.14, type: 'triangle', gain: 0.12, delay: 0.07 });
  });
}

/** 家具を置く・しまう: 軽く「コトッ」と収まる音 */
export function playPlace(): void {
  play(false, (c) => {
    tone(c, { freq: 300, freqEnd: 220, duration: 0.08, type: 'sine', gain: 0.14 });
  });
}

/** 島レベルアップ・境界の開放: 明るいアルペジオ */
export function playLevelUp(): void {
  play(true, (c) => {
    [520, 660, 780, 1040].forEach((freq, i) => {
      tone(c, { freq, duration: 0.22, type: 'triangle', gain: 0.14, delay: i * 0.09 });
    });
  });
}

/** 失敗: 短く低い、不快でない拒否音 */
export function playFail(): void {
  play(true, (c) => {
    tone(c, { freq: 220, duration: 0.08, type: 'triangle', gain: 0.1 });
    tone(c, { freq: 180, duration: 0.09, type: 'triangle', gain: 0.1, delay: 0.09 });
  });
}

/** ボタン・タップ全般: ごく短い、軽いクリック */
export function playUiTap(): void {
  play(false, (c) => {
    tone(c, { freq: 900, duration: 0.04, type: 'triangle', gain: 0.06 });
  });
}
