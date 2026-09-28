// 地面テクスチャ（tex_*.png・64×64・継ぎ目なし想定）の読み込みと共有キャッシュ。
//
// terrain.ts（地面の事前描画。ピクセル単位でサンプリングするので生ピクセル配列が要る）と
// sprites.ts（道系の家具 f_woodPath / f_stonePath。ワールド座標に応じてテクスチャを
// そのまま 16×16 切り出して敷くので、Image をそのまま drawImage で使う）の両方が
// 同じ読み込み結果を使い回せるよう、ここに集約する。
//
// Vite の import.meta.glob で URL だけを静的に集める（このファイル自体は Image を
// モジュール読み込み時に作らない＝Canvas の無いテスト環境でも import できる）。

export type TextureName = 'grass' | 'grassFlowers' | 'dirt' | 'sand' | 'wetSand' | 'paving' | 'dock' | 'water';

export const TEXTURE_SIZE = 64;

const ALL: TextureName[] = ['grass', 'grassFlowers', 'dirt', 'sand', 'wetSand', 'paving', 'dock', 'water'];

const texUrls = import.meta.glob('../assets/gen/tex_*.png', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

function urlFor(name: TextureName): string | undefined {
  const suffix = `/tex_${name}.png`;
  for (const path in texUrls) {
    if (path.endsWith(suffix)) return texUrls[path];
  }
  return undefined;
}

const images = new Map<TextureName, HTMLImageElement>();
const pixelCache = new Map<TextureName, Uint8ClampedArray>();
let loadPromise: Promise<void> | null = null;

function loadOne(name: TextureName): Promise<void> {
  const url = urlFor(name);
  if (!url || typeof Image === 'undefined') return Promise.resolve();
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      images.set(name, img);
      try {
        const c = document.createElement('canvas');
        c.width = TEXTURE_SIZE;
        c.height = TEXTURE_SIZE;
        const ctx = c.getContext('2d');
        if (ctx) {
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(img, 0, 0, TEXTURE_SIZE, TEXTURE_SIZE);
          pixelCache.set(name, ctx.getImageData(0, 0, TEXTURE_SIZE, TEXTURE_SIZE).data as unknown as Uint8ClampedArray);
        }
      } catch {
        // getImageData が使えない環境（テストなど）では諦める。呼び出し側はフォールバック色を使う。
      }
      resolve();
    };
    img.onerror = () => resolve();
    img.src = url;
  });
}

/** 全テクスチャを読み込む（一度だけ）。失敗した個別テクスチャは無視して進む。 */
export function loadTextures(): Promise<void> {
  if (!loadPromise) loadPromise = Promise.all(ALL.map(loadOne)).then(() => undefined);
  return loadPromise;
}

export function getTextureImage(name: TextureName): HTMLImageElement | null {
  return images.get(name) ?? null;
}

/** RGBA の生ピクセル配列（64×64）。読み込み前・失敗時は null。 */
export function getTexturePixels(name: TextureName): Uint8ClampedArray | null {
  return pixelCache.get(name) ?? null;
}
