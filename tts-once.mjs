// 单次 Edge TTS 合成（由 server.mjs 子进程调用，避免长驻进程里的连接状态问题）
// 用法：node tts-once.mjs <输出mp3路径> <voice>  文本从 stdin 读
import { createRequire } from 'node:module';
import path from 'node:path';

const WEB_NODE_MODULES = process.env.DSH_WEB_NODE_MODULES
  || 'C:\\Users\\STEPHEN\\.dsh\\profiles\\web\\node_modules';
const require = createRequire(path.join(WEB_NODE_MODULES, 'noop.js'));
const { EdgeTTS } = require('node-edge-tts');

const out = process.argv[2];
const voice = process.argv[3] || 'zh-CN-XiaoyiNeural';
if (!out) {
  console.error('out path required');
  process.exit(2);
}

let input = '';
for await (const chunk of process.stdin) input += chunk;
const text = input.trim();
if (!text) {
  console.error('empty text');
  process.exit(3);
}

const tts = new EdgeTTS({
  voice,
  lang: 'zh-CN',
  outputFormat: 'audio-24khz-48kbitrate-mono-mp3',
  rate: '+8%',
});
await tts.ttsPromise(text, out);
