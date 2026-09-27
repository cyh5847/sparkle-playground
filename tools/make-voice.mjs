// 안내 목소리 만들기: tools/voice-lines.json → sounds/voice/*.mp3 + manifest.json
// 필요: 환경변수 TYPECAST_API_KEY, ffmpeg (PATH 또는 환경변수 FFMPEG)
// 바뀐 문장만 새로 만든다(파일 이름 = 문장·설정의 해시). 대본에서 빠진 파일은 지운다.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const OUT = path.join(ROOT, 'sounds', 'voice');
const TMP = path.join(ROOT, 'tools', '.tmp');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const KEY = process.env.TYPECAST_API_KEY;
const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'voice-lines.json'), 'utf8'));
fs.mkdirSync(OUT, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

const ff = args => execFileSync(FFMPEG, ['-y', '-loglevel', 'error', ...args]);
const TRIM = 'silenceremove=start_periods=1:start_threshold=-40dB,areverse,silenceremove=start_periods=1:start_threshold=-40dB,areverse';
const VOICE_LUFS = -16, CHIME_LUFS = -26, CHIME_LEAD_MS = 750;   // 목소리는 크게, 실로폰은 작게(2026-09-27 영호님 확인)

// 실로폰 딩동댕(도·미·솔) — 한 번만 만든다
function chime() {
  const f = path.join(TMP, 'chime.wav');
  if (fs.existsSync(f)) return f;
  const bar = (hz, i) => {
    const o = path.join(TMP, `bar${i}.wav`);
    ff(['-f', 'lavfi', '-i', `aevalsrc='(0.6*sin(2*PI*${hz}*t)+0.25*sin(2*PI*${hz * 3.93}*t)*exp(-t*18)+0.08*sin(2*PI*${hz * 9.2}*t)*exp(-t*30))*exp(-t*4.5)*min(1,t*400)':s=44100:d=1.1`, o]);
    return o;
  };
  const b = [523.25, 659.25, 783.99].map(bar);
  ff(['-i', b[0], '-i', b[1], '-i', b[2], '-i', b[0], '-filter_complex',
    `[0]adelay=0[a];[1]adelay=260[b];[2]adelay=520[c];[3]volume=0.5,adelay=520[d];[a][b][c][d]amix=inputs=4:normalize=0,loudnorm=I=${CHIME_LUFS}:TP=-3:LRA=11,aresample=44100[o]`,
    '-map', '[o]', f]);
  return f;
}

async function tts(text, ctx, wav) {
  const res = await fetch('https://api.typecast.ai/v1/text-to-speech', {
    method: 'POST',
    headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_id: cfg.voice, text, model: cfg.model, language: 'kor', seed: cfg.seed,
      prompt: { emotion_type: 'smart', previous_text: ctx.prev || '', next_text: ctx.next || '' },
      output: { audio_format: 'wav' },
    }),
  });
  if (!res.ok) throw new Error(`「${text}」 ${res.status} ${(await res.text()).slice(0, 200)}`);
  fs.writeFileSync(wav, Buffer.from(await res.arrayBuffer()));
}

const manifest = {}, keep = new Set(['manifest.json']);
let made = 0, reused = 0, chars = 0;
for (const g of cfg.groups) {
  for (const [key, texts] of Object.entries(g.lines)) {
    manifest[key] = [];
    for (const text of texts) {
      const id = crypto.createHash('sha1').update(JSON.stringify([cfg.voice, cfg.model, cfg.seed, text, g.ctx, !!g.chime, VOICE_LUFS, CHIME_LUFS, CHIME_LEAD_MS])).digest('hex').slice(0, 10);
      const file = id + '.mp3';
      manifest[key].push([file, text]);
      keep.add(file);
      if (fs.existsSync(path.join(OUT, file))) { reused++; continue; }
      if (!KEY) throw new Error('TYPECAST_API_KEY 가 없음');
      const raw = path.join(TMP, id + '-raw.wav'), voice = path.join(TMP, id + '-v.wav');
      await tts(text, g.ctx, raw);
      ff(['-i', raw, '-af', `${TRIM},loudnorm=I=${VOICE_LUFS}:TP=-1.5:LRA=11,aresample=44100,pan=mono|c0=c0`, voice]);
      if (g.chime) ff(['-i', chime(), '-i', voice, '-filter_complex', `[1]adelay=${CHIME_LEAD_MS}[v];[0][v]amix=inputs=2:normalize=0,alimiter=limit=0.95[o]`, '-map', '[o]', '-ac', '1', '-b:a', '64k', path.join(OUT, file)]);
      else ff(['-i', voice, '-ac', '1', '-b:a', '64k', path.join(OUT, file)]);
      made++; chars += text.length;
      console.log('만듦', key, text);
    }
  }
}
let removed = 0;
for (const f of fs.readdirSync(OUT)) if (!keep.has(f)) { fs.unlinkSync(path.join(OUT, f)); removed++; }
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 0).replace(/\],"/g, '],\n"'));
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`새로 ${made}개(${chars}자) · 그대로 ${reused}개 · 지움 ${removed}개 · 키 ${Object.keys(manifest).length}개`);
