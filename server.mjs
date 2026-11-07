/**
 * 直播画面本地服务：只做三件事
 *   1. 把 live-stage 目录当静态站点托管（给直播伴侣窗口捕获用）
 *   2. 把 douyin-live-pet 的 history.jsonl 读成 /feed，页面轮询渲染弹幕和回复
 *   3. 提供 /tts：给 douyin-live-pet 的「外接语音服务」用，返回 Edge TTS 合成的 mp3
 * 不连 DSH 的鉴权路由，所以不需要登录态。
 */
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const HISTORY = process.env.DOUYIN_HISTORY
  || 'C:\\Users\\STEPHEN\\.dsh\\douyin-live-pet\\history.jsonl';
const PORT = Number(process.env.STAGE_PORT || 4173);
const LIVE_WINDOW_MS = 90 * 1000;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.webm': 'video/webm',
  '.mp4': 'video/mp4',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
};

async function readFeed() {
  let text = '';
  let mtime = 0;
  try {
    const s = await stat(HISTORY);
    mtime = s.mtimeMs;
    text = await readFile(HISTORY, 'utf8');
  } catch {
    return { live: false, updatedAt: 0, events: [] };
  }
  const events = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const record = JSON.parse(line);
      events.push({
        ts: record.ts ?? 0,
        user: record.user ?? null,
        text: record.text ?? '',
        reply: record.reply ?? '',
        kind: record.kind ?? 'chat',
        ok: record.ok !== false,
      });
    } catch {
      /* 坏行跳过 */
    }
  }
  return {
    live: Date.now() - mtime < LIVE_WINDOW_MS,
    updatedAt: mtime,
    events: events.slice(-14),
  };
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

/** 合成一段 mp3；Edge TTS 偶尔返回空文件且不报错，这里用子进程 + 非空校验 + 重试 */
async function synthesize(text, voice) {
  const file = path.join(tmpdir(), `stage-tts-${randomUUID()}.mp3`);
  const child = spawn(process.execPath, [path.join(ROOT, 'tts-once.mjs'), file, voice || ''], {
    stdio: ['pipe', 'ignore', 'pipe'],
    windowsHide: true,
  });
  let errText = '';
  const startedAt = Date.now();
  child.stderr.on('data', (d) => (errText += d.toString()));
  const done = new Promise((resolve) => child.on('close', resolve));
  child.stdin.end(text, 'utf8');
  const timer = setTimeout(() => child.kill(), 25_000);
  const code = await done;
  const elapsed = Date.now() - startedAt;
  clearTimeout(timer);
  try {
    const info = await stat(file);
    if (!info.size) throw new Error(`tts empty audio (exit=${code} ${elapsed}ms)`);
    return await readFile(file);
  } catch (error) {
    throw new Error(errText.trim() || String(error?.message ?? error));
  } finally {
    unlink(file).catch(() => {});
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');

  if (url.pathname === '/tts' && req.method === 'POST') {
    const body = await readJson(req);
    const text = String(body.text ?? '').trim();
    if (!text) {
      res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('text required');
      return;
    }
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const audio = await synthesize(text, body.voice);
        res.writeHead(200, { 'content-type': 'audio/mpeg', 'cache-control': 'no-store' });
        res.end(audio);
        return;
      } catch (error) {
        if (attempt === 1) {
          res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
          res.end(String(error?.message ?? error));
        }
      }
    }
    return;
  }

  if (url.pathname === '/feed') {
    const feed = await readFeed();
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(JSON.stringify(feed));
    return;
  }

  const rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
  const file = path.join(ROOT, path.normalize(rel));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403);
    res.end('forbidden');
    return;
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'content-type': MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[live-stage] 直播画面已启动： http://127.0.0.1:${PORT}/`);
  console.log(`[live-stage] 弹幕来源： ${HISTORY}`);
});
