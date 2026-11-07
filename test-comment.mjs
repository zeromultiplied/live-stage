/**
 * 本地模拟一条直播间弹幕，走完整条链路：
 *   弹幕 → 桌宠生成回复 → 写入 history.jsonl（直播页轮询显示）→ 插件 TTS 朗读
 *
 * 用法：node live-stage/test-comment.mjs "观众名" "弹幕内容"
 * 不带参数则用默认测试数据。
 */
import fs from 'node:fs';
import path from 'node:path';

const user = process.argv[2] || '测试观众';
const text = process.argv[3] || '哦鲸鲸你今天在干嘛呀';

const PET = 'http://127.0.0.1:3080/dsh-pet-7340/chat?pet=main&surface=desktop';
const SAY = 'http://127.0.0.1:3080/douyin-live-pet/say';
const HISTORY =
  process.env.DOUYIN_HISTORY ||
  path.join(process.env.USERPROFILE || '', '.dsh', 'douyin-live-pet', 'history.jsonl');
const FEED = `http://127.0.0.1:${process.env.STAGE_PORT || 4173}/feed`;

const prompt = `直播间里，观众「${user}」发了一条弹幕：${text}\n请用哦鲸鲸的口吻直接回一句，30 字以内，口语化，不要解释，也不要加引号。`;

let reply = null;
try {
  const res = await fetch(PET, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text: prompt }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json().catch(() => null);
  if (body?.ok && typeof body.text === 'string') reply = body.text.trim();
  else console.log(`桌宠没回话：${JSON.stringify(body)}`);
} catch (e) {
  console.log(`桌宠连不上：${e.message}`);
}

if (!reply) {
  reply = `${user}，我在听呢～`;
  console.log('改用兜底回复');
}

const record = {
  ts: Date.now(),
  kind: 'chat',
  user,
  text,
  reply,
  reason: 'test',
  ok: true,
};
fs.mkdirSync(path.dirname(HISTORY), { recursive: true });
fs.appendFileSync(HISTORY, `${JSON.stringify(record)}\n`, 'utf8');
console.log(`已写入 ${HISTORY}`);
console.log(`弹幕：${user}：${text}`);
console.log(`回复：${reply}`);

// 等直播页轮到这一条
await new Promise((r) => setTimeout(r, 1200));
try {
  const feed = await (await fetch(FEED)).json();
  const hit = (feed.events || []).some((e) => e.ts === record.ts);
  console.log(`直播页轮询：${hit ? '已显示 ✓' : '没拿到 ✗'}（live=${feed.live}）`);
} catch (e) {
  console.log(`直播页服务没响应：${e.message}`);
}

// 试听同一句（由插件的 Edge TTS 朗读）
try {
  const res = await fetch(SAY, {
    method: 'POST',
    headers: { 'content-type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ text: reply }),
    signal: AbortSignal.timeout(60_000),
  });
  const body = await res.json().catch(() => null);
  console.log(`TTS：${body?.ok ? `已朗读（${body.engine}）` : `失败 ${body?.error ?? ''}`}`);
} catch (e) {
  console.log(`TTS 调用失败：${e.message}`);
}
