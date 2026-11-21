// 効果音の音量の測定（ブラウザの eval で動かす。npm run dev 中に /survival-island/?dev を開き、「うけとる」を押してから）。
//   playwright-cli eval "$(cat scripts/measure-levels.js)"   → 各音のピーク・RMS（dBFS、コンプレッサーの出口で測る）。
// 雨音は別（?dev&weather=rainy で開き、このファイルは使わず README 相当: setRainSound を止めて 2.5 秒おいてから 3 秒録る）。
// 目安: 足音・採取・食べる・釣りの RMS が互いに 6dB 以内、全部のピークが 0dBFS 未満。
async () => {
  const S = window.__sound; if(!S) return 'no sound module';
  S.primeAudio();
  const Ctx = window.AudioContext;
  const rec = { on:false, bufs:[] };
  S.playUiTap(); await new Promise(r=>setTimeout(r,400));
  const m = S.masterForTest(); if(!m) return 'no master';
  const ctxRef = m.context; const proc = ctxRef.createScriptProcessor(2048,1,1);
  proc.onaudioprocess = (e)=>{ if(rec.on) rec.bufs.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  m.node.connect(proc); proc.connect(ctxRef.destination);
  const sleep = ms=>new Promise(r=>setTimeout(r,ms));
  const measure = async (name, fn, ms) => {
    rec.bufs=[]; rec.on=true; fn(); await sleep(ms); rec.on=false;
    let peak=0, sum=0, n=0, active=0;
    const all = rec.bufs; let len=0;
    for(const b of all){ for(let i=0;i<b.length;i++){ const v=Math.abs(b[i]); if(v>peak)peak=v; len++; if(v>0.002){ sum+=b[i]*b[i]; n++; } } }
    const rms = n? Math.sqrt(sum/n):0;
    return { name, peakDb: +(20*Math.log10(peak||1e-9)).toFixed(1), rmsDb: +(20*Math.log10(rms||1e-9)).toFixed(1), activeMs: Math.round(n/ (ctxRef?ctxRef.sampleRate:44100)*1000) };
  };
  const out=[];
  const list = [
    ['step', ()=>S.playStep(), 400], ['chop', ()=>S.playChop(), 500], ['mine', ()=>S.playMine(), 500], ['pick', ()=>S.playPick(), 500], ['dig', ()=>S.playDig(), 500], ['plant', ()=>S.playPlant(), 500],
    ['harvest', ()=>S.playHarvest(), 600], ['collect', ()=>S.playCollect(), 500], ['eat', ()=>S.playEat(), 1000], ['cast', ()=>S.playCast(), 600], ['catch', ()=>S.playCatch(false), 800], ['catchBig', ()=>S.playCatch(true), 900],
    ['build', ()=>S.playBuild(), 1200], ['gift', ()=>S.playGift(), 800], ['request', ()=>S.playRequestDone(), 1000], ['craft', ()=>S.playCraft(), 600], ['levelUp', ()=>S.playLevelUp(), 1200], ['fail', ()=>S.playFail(), 600], ['fell', ()=>S.playFell(), 800], ['pop', ()=>S.playPop(), 500], ['tap', ()=>S.playUiTap(), 400], ['place', ()=>S.playPlace(), 500],
  ];
  for (const [n,f,ms] of list){ await sleep(150); out.push(await measure(n,f,ms)); }
  out.push(await measure('rain', ()=>S.setRainSound(true), 3500));
  return JSON.stringify(out);
}
