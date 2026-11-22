// 性能の監査（全ゲーム共通）。モバイル幅・CPU を遅くした状態で一定時間あそび、次を計測して表にする。
//   フレーム間隔（requestAnimationFrame。p50・p95・最悪）、Long Task（50ms 超の回数・最大・合計）、
//   入力遅延（pointerdown から次の描画まで。p50・p95・最悪）、メモリ（JS ヒープの開始・終了・増加）、
//   DOM ノード数・イベントリスナー数（CDP Memory.getDOMCounters）の増加、初回表示の時間（--load）。
//
// 使い方:
//   node scripts/perf-audit.mjs <URL> [--preset survival|citybuilders|generic] [--minutes 10] [--throttle 4]
//                               [--width 375 --height 812] [--profile] [--json out.json] [--load] [--network 4g]
//   例: node scripts/perf-audit.mjs "http://localhost:5190/survival-island/?mute&dev" --preset survival --minutes 10
//       node scripts/perf-audit.mjs "https://masato-masa.github.io/city-builders/?mute" --preset citybuilders --minutes 3
//       node scripts/perf-audit.mjs "https://masato-masa.github.io/survival-island/?mute" --load --network 4g   （初回と 2 回目の読み込み時間）
// 新しいゲームを足すときは、下の PRESETS に「1 回分の遊び」（page と時間を受け取る関数）を足す。
// playwright-core は playwright-cli のものを使う（PLAYWRIGHT_CORE で場所を変えられる）。ブラウザは系統の Chrome（PW_CHANNEL で変更）。
// 結果は Vault の Knowledge/perf-audit-2026-11.md に貼る（置き場所は Knowledge/perf-audit-script.md に書いてある）。

import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const core = process.env.PLAYWRIGHT_CORE ?? 'C:/Users/将斗/AppData/Roaming/npm/node_modules/@playwright/cli/node_modules/playwright-core';
const { chromium } = require(core);

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith('--') && /^https?:/.test(a));
const opt = (name, def) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : def;
};
const flag = (name) => argv.includes(`--${name}`);
if (!url) {
  console.error('URL を指定してください');
  process.exit(2);
}
const preset = opt('preset', 'generic');
const minutes = Number(opt('minutes', 10));
const throttle = Number(opt('throttle', 4));
const width = Number(opt('width', 375));
const height = Number(opt('height', 812));
const NETWORKS = {
  '4g': { latency: 40, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (9 * 1024 * 1024) / 8 },
  '3g': { latency: 100, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (0.75 * 1024 * 1024) / 8 },
};

const pct = (arr, p) => {
  if (!arr.length) return 0;
  const a = [...arr].sort((x, y) => x - y);
  return a[Math.min(a.length - 1, Math.floor((p / 100) * a.length))];
};
const f1 = (n) => (Math.round(n * 10) / 10).toString();

// ---- 1 回分の遊び（ゲームごと） ----
const rnd = (a, b) => a + Math.random() * (b - a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PRESETS = {
  /** むじんとう: 画面を指で動かして歩き、ときどきタップ（作業・シートを開く）。 */
  survival: async (page, until) => {
    await page.getByText('うけとる').first().click({ timeout: 8000 }).catch(() => {});
    const cx = width / 2;
    const cy = height * 0.72;
    let n = 0;
    while (Date.now() < until) {
      // 歩く（ドラッグ）
      const ang = rnd(0, Math.PI * 2);
      await page.mouse.move(cx, cy);
      await page.mouse.down();
      for (let i = 1; i <= 6; i++) {
        await page.mouse.move(cx + Math.cos(ang) * 14 * i, cy + Math.sin(ang) * 14 * i);
        await sleep(120);
      }
      await page.mouse.up();
      // タップ（作業・設備）
      await page.mouse.click(cx, height * 0.5);
      await sleep(rnd(300, 900));
      n++;
      if (n % 12 === 0) {
        // もくひょう・もちものを開いて閉じる
        for (const name of ['もくひょう', 'もちもの']) {
          await page.getByRole('button', { name }).click({ timeout: 2000 }).catch(() => {});
          await sleep(500);
          await page.locator('.close-btn').click({ timeout: 2000 }).catch(() => {});
          await sleep(300);
        }
      }
    }
  },
  /** シティビルダーズ: ふつうで始め、札をドラッグ → ターン終了 を繰り返す。終わったら「もう一度」。 */
  citybuilders: async (page, until) => {
    const start = async () => {
      await page.getByText('ふつう', { exact: false }).first().click({ timeout: 8000 }).catch(() => {});
      await sleep(1500);
    };
    await start();
    while (Date.now() < until) {
      const state = await page.evaluate(() => {
        if (document.querySelector('.result')) return 'result';
        const b = [...document.querySelectorAll('button')].find((x) => x.textContent.includes('ターン終了'));
        return b ? (b.disabled ? 'wait' : 'ok') : 'none';
      });
      if (state === 'result') {
        await page.getByText('もう一度').first().click().catch(() => {});
        await sleep(1500);
        continue;
      }
      if (state === 'ok') {
        const cards = await page.$$('[data-hand-card]');
        for (let i = 0; i < Math.min(2, cards.length); i++) {
          const b = await (await page.$$('[data-hand-card]'))[i]?.boundingBox();
          if (!b) break;
          await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
          await page.mouse.down();
          for (const dy of [-60, -200, -330]) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + dy, { steps: 4 });
          await page.mouse.up();
          await sleep(700);
          if (await page.evaluate(() => document.body.innerText.includes('札をタップ'))) {
            const bs = await page.$$('[data-hand-card]');
            const last = await bs[bs.length - 1]?.boundingBox();
            if (last) await page.mouse.click(last.x + last.width / 2, last.y + last.height / 2);
            await sleep(700);
          }
        }
        // 建てられる物件があればタップして建てる
        const buildLabel = await page.evaluate(() => {
          const m = document.body.innerText.match(/\n(\d+)\n次の収入/);
          const coins = +(m ? m[1] : 0);
          const c = [...document.querySelectorAll('.plot')].map((p) => p.getAttribute('aria-label') || '').map((l) => { const x = l.match(/建設 (\d+) コイン/); return x ? { l, c: +x[1] } : null; }).filter(Boolean).filter((x) => x.c <= coins).sort((a, b) => b.c - a.c);
          return c.length ? c[0].l : '';
        });
        if (buildLabel) {
          await page.getByRole('button', { name: buildLabel }).first().click({ timeout: 2000 }).catch(() => {});
          await sleep(500);
          await page.getByRole('button', { name: '建てる' }).first().click({ timeout: 2000 }).catch(() => {});
          await sleep(1200);
        }
        await page.getByText('ターン終了').first().click({ timeout: 2000 }).catch(() => {});
        await sleep(1500);
      } else {
        await sleep(800);
      }
    }
  },
  /** 汎用: 画面のあちこちをタップ・ドラッグ。 */
  generic: async (page, until) => {
    while (Date.now() < until) {
      const x = rnd(20, width - 20);
      const y = rnd(80, height - 20);
      if (Math.random() < 0.5) await page.mouse.click(x, y);
      else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + rnd(-80, 80), y + rnd(-120, 120), { steps: 6 });
        await page.mouse.up();
      }
      await sleep(rnd(300, 800));
    }
  },
};

// ---- ページに仕込む計測 ----
const INIT = () => {
  const w = window;
  w.__perf = { frames: [], longtasks: [], inputDelay: [], mem: [] };
  let last = 0;
  const tick = (t) => {
    if (last) w.__perf.frames.push(t - last);
    last = t;
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) w.__perf.longtasks.push(e.duration);
    }).observe({ entryTypes: ['longtask'] });
  } catch {
    // longtask が使えない環境
  }
  // 入力遅延: pointerdown の時刻 → 次の描画（rAF の次の rAF = 描画完了の近似）
  addEventListener(
    'pointerdown',
    () => {
      const t0 = performance.now();
      requestAnimationFrame(() => requestAnimationFrame(() => w.__perf.inputDelay.push(performance.now() - t0)));
    },
    true,
  );
};

async function launch() {
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--enable-precise-memory-info'] });
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, hasTouch: false });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  return { browser, ctx, page, cdp };
}

// ---- 初回・2 回目の読み込み（--load） ----
async function loadAudit() {
  const net = NETWORKS[opt('network', '4g')];
  const { browser, ctx, page, cdp } = await launch();
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: false });
  await cdp.send('Network.clearBrowserCache').catch(() => {});
  await cdp.send('Network.emulateNetworkConditions', { offline: false, ...net });
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  const rows = [];
  for (const label of ['初回（キャッシュなし）', '2 回目（キャッシュあり）']) {
    let bytes = 0;
    let reqs = 0;
    const onFin = (e) => {
      bytes += e.encodedDataLength;
      reqs++;
    };
    cdp.on('Network.loadingFinished', onFin);
    await page.addInitScript(() => {
      window.__lcp = 0;
      try {
        new PerformanceObserver((l) => {
          for (const e of l.getEntries()) window.__lcp = e.startTime;
        }).observe({ type: 'largest-contentful-paint', buffered: true });
      } catch {
        // 非対応
      }
    });
    const t0 = Date.now();
    await page.goto(url, { waitUntil: 'load' });
    const tLoad = Date.now() - t0;
    // 操作できる状態（ボタンが出る）まで
    await page.waitForSelector('button', { timeout: 30000 }).catch(() => {});
    const tInteractive = Date.now() - t0;
    await sleep(1500);
    const lcp = await page.evaluate(() => window.__lcp);
    const nav = await page.evaluate(() => {
      const n = performance.getEntriesByType('navigation')[0];
      const fcp = performance.getEntriesByName('first-contentful-paint')[0];
      return { dcl: n?.domContentLoadedEventEnd ?? 0, fcp: fcp?.startTime ?? 0 };
    });
    cdp.off('Network.loadingFinished', onFin);
    rows.push({ label, load: tLoad, interactive: tInteractive, fcp: nav.fcp, lcp, kb: bytes / 1024, reqs });
  }
  await browser.close();
  console.log(`\n## 読み込み（${opt('network', '4g')} 相当、CPU ${throttle} 倍遅く、${width}×${height}）\n`);
  console.log('| 回 | load (ms) | 操作できるまで (ms) | FCP (ms) | LCP (ms) | 転送量 (KB) | リクエスト数 |');
  console.log('|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.label} | ${Math.round(r.load)} | ${Math.round(r.interactive)} | ${Math.round(r.fcp)} | ${Math.round(r.lcp)} | ${Math.round(r.kb)} | ${r.reqs} |`);
}

// ---- 遊びの計測 ----
async function playAudit() {
  const { browser, page, cdp } = await launch();
  await page.addInitScript(INIT);
  await cdp.send('Memory.getDOMCounters').catch(() => {});
  if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  if (flag('profile')) {
    await cdp.send('Profiler.enable');
    await cdp.send('Profiler.setSamplingInterval', { interval: 1000 });
  }
  await page.goto(url, { waitUntil: 'load' });
  await sleep(2500);
  const counters = async () => {
    const c = await cdp.send('Memory.getDOMCounters');
    const mem = await page.evaluate(() => (performance.memory ? performance.memory.usedJSHeapSize : 0));
    const dom = await page.evaluate(() => document.getElementsByTagName('*').length);
    return { nodes: c.nodes, listeners: c.jsEventListeners, heap: mem, dom };
  };
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const start = await counters();
  if (flag('profile')) await cdp.send('Profiler.start');
  const end = Date.now() + minutes * 60 * 1000;
  const samples = [];
  const sampler = setInterval(async () => {
    try {
      samples.push({ t: Math.round((Date.now() - (end - minutes * 60 * 1000)) / 1000), ...(await counters()) });
    } catch {
      // ページが閉じた
    }
  }, 30000);
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await PRESETS[preset](page, end);
  clearInterval(sampler);
  await cdp.send('HeapProfiler.collectGarbage').catch(() => {});
  const fin = await counters();
  const perf = await page.evaluate(() => window.__perf);
  let top = [];
  if (flag('profile')) {
    const { profile } = await cdp.send('Profiler.stop');
    const self = new Map();
    const byId = new Map(profile.nodes.map((n) => [n.id, n]));
    const dt = profile.timeDeltas;
    profile.samples.forEach((id, i) => {
      const n = byId.get(id);
      const key = `${n.callFrame.functionName || '(anonymous)'} ${n.callFrame.url.split('/').pop()}:${n.callFrame.lineNumber + 1}`;
      self.set(key, (self.get(key) ?? 0) + (dt[i] ?? 0));
    });
    top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  }
  await browser.close();

  const fr = perf.frames;
  const lt = perf.longtasks;
  const id = perf.inputDelay;
  console.log(`\n## 計測結果: ${url}\n\nプリセット ${preset}、${minutes} 分、CPU ${throttle} 倍遅く、${width}×${height}。エラー ${errors.length} 件${errors.length ? '（' + errors[0] + '）' : ''}\n`);
  console.log('| 項目 | 値 |');
  console.log('|---|---|');
  console.log(`| フレーム間隔 p50 / p95 / 最悪 (ms) | ${f1(pct(fr, 50))} / ${f1(pct(fr, 95))} / ${f1(Math.max(0, ...fr))} |`);
  console.log(`| フレームレート 平均 (fps) | ${f1(1000 / (fr.reduce((a, b) => a + b, 0) / Math.max(1, fr.length)))} |`);
  console.log(`| 50ms を超えたフレーム | ${fr.filter((x) => x > 50).length} / ${fr.length}（${f1((100 * fr.filter((x) => x > 50).length) / Math.max(1, fr.length))}%）、100ms 超 ${fr.filter((x) => x > 100).length} |`);
  console.log(`| Long Task（50ms 超）回数 / 最大 / 合計 | ${lt.length} / ${f1(Math.max(0, ...lt))} ms / ${f1(lt.reduce((a, b) => a + b, 0))} ms |`);
  console.log(`| 入力遅延 p50 / p95 / 最悪 (ms) | ${f1(pct(id, 50))} / ${f1(pct(id, 95))} / ${f1(Math.max(0, ...id))}（${id.length} 回） |`);
  console.log(`| JS ヒープ 開始 → 終了（GC 後） | ${f1(start.heap / 1048576)} MB → ${f1(fin.heap / 1048576)} MB（${fin.heap >= start.heap ? '+' : ''}${f1((fin.heap - start.heap) / 1048576)} MB） |`);
  console.log(`| DOM 要素数（開始 → 終了） | ${start.dom} → ${fin.dom} |`);
  console.log(`| DOM ノード（CDP）/ イベントリスナー（開始 → 終了） | ${start.nodes} → ${fin.nodes} / ${start.listeners} → ${fin.listeners} |`);
  if (samples.length) console.log(`| 30 秒ごとの JS ヒープ MB | ${samples.map((s) => f1(s.heap / 1048576)).join(', ')} |`);
  if (samples.length) console.log(`| 30 秒ごとの DOM 要素数 | ${samples.map((s) => s.dom).join(', ')} |`);
  if (samples.length) console.log(`| 30 秒ごとの DOM ノード（CDP。切り離された物も含む） | ${samples.map((s) => s.nodes).join(', ')} |`);
  if (samples.length) console.log(`| 30 秒ごとのイベントリスナー | ${samples.map((s) => s.listeners).join(', ')} |`);
  if (top.length) {
    console.log('\n### CPU プロファイル（自分の時間が長い順、ms）\n');
    for (const [k, v] of top) console.log(`- ${f1(v / 1000)} ms  ${k}`);
  }
  const out = opt('json', null);
  if (out) writeFileSync(out, JSON.stringify({ url, preset, minutes, throttle, frames: { p50: pct(fr, 50), p95: pct(fr, 95), max: Math.max(0, ...fr) }, longtasks: lt.length, start, fin, top }, null, 1));
}

if (flag('load')) await loadAudit();
else await playAudit();
