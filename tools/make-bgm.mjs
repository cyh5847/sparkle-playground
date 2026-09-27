// 배경음악 만들기: Suno에서 받은 mp3 → sounds/bgm/*.mp3
// 쓰는 법: node tools/make-bgm.mjs <원본 폴더>   (원본 이름: 메뉴1·메뉴2·차분1·차분2·신나1·신나2 .mp3)
// 필요: ffmpeg (PATH 또는 환경변수 FFMPEG)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const SRC = process.argv[2];
if (!SRC) { console.error('원본 폴더를 적어 주세요'); process.exit(1); }
const OUT = path.join(ROOT, 'sounds', 'bgm');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const FFPROBE = process.env.FFPROBE || FFMPEG.replace(/ffmpeg(\.exe)?$/i, 'ffprobe$1');
const LUFS = -28;   // 목소리(-16)·실로폰(-26)보다 작게. 목소리가 나올 때는 게임에서 더 줄인다
const MAP = { '메뉴1': 'menu1', '메뉴2': 'menu2', '차분1': 'calm1', '차분2': 'calm2', '신나1': 'fun1', '신나2': 'fun2' };
fs.mkdirSync(OUT, { recursive: true });

for (const [ko, en] of Object.entries(MAP)) {
  const src = path.join(SRC, ko + '.mp3');
  if (!fs.existsSync(src)) { console.log('없음', src); continue; }
  // 끝의 무음을 잘라낸 길이
  const dur = parseFloat(execFileSync(FFPROBE, ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src]).toString());
  let end = dur;
  const log = spawnSync(FFMPEG, ['-hide_banner', '-nostats', '-i', src, '-af', 'silencedetect=n=-45dB:d=0.5', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = [...(log || '').matchAll(/silence_start: ([\d.]+)/g)].map(x => +x[1]).filter(t => t > dur - 10);
  if (m.length) end = m[m.length - 1];
  const fo = 3;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-t', end.toFixed(2), '-af',
    `afade=t=in:d=1.5,afade=t=out:st=${(end - fo).toFixed(2)}:d=${fo},loudnorm=I=${LUFS}:TP=-3:LRA=11,aresample=44100`,
    '-ac', '2', '-b:a', '64k', path.join(OUT, en + '.mp3')]);
  console.log(`${ko} → ${en}.mp3  ${end.toFixed(1)}초  ${Math.round(fs.statSync(path.join(OUT, en + '.mp3')).size / 1024)}KB`);
}
