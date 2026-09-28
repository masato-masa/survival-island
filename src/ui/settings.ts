// 効果音・振動の入切。localStorage に保存し、次に開いたときも保たれる。
// 既定はどちらも「入」。city-builders と同じ形だが、キーだけこのアプリ専用にする。

const SOUND_KEY = 'survival-island:sound';
const HAPTICS_KEY = 'survival-island:haptics';

function readFlag(key: string): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return true;
    return raw === '1';
  } catch {
    return true;
  }
}

function writeFlag(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // 保存できなくても遊べる
  }
}

// モジュール読み込み時ではなく、値が最初に要求されたタイミングで localStorage を読む
// （テスト環境やサーバーサイドでも安全に import できるようにするため）。
let soundEnabled: boolean | null = null;
let hapticsEnabled: boolean | null = null;

export function isSoundEnabled(): boolean {
  if (soundEnabled === null) soundEnabled = readFlag(SOUND_KEY);
  return soundEnabled;
}

export function isHapticsEnabled(): boolean {
  if (hapticsEnabled === null) hapticsEnabled = readFlag(HAPTICS_KEY);
  return hapticsEnabled;
}

export function setSoundEnabled(value: boolean): void {
  soundEnabled = value;
  writeFlag(SOUND_KEY, value);
}

export function setHapticsEnabled(value: boolean): void {
  hapticsEnabled = value;
  writeFlag(HAPTICS_KEY, value);
}
