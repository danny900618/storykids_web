// 檢查 relay/setup.sh 內嵌的 Caddy 設定與 relay/Caddyfile 一致（修改轉發設定時兩邊都要改）
import { readFileSync } from 'node:fs';

const caddyfile = readFileSync(new URL('../relay/Caddyfile', import.meta.url), 'utf8').trim();
const setup = readFileSync(new URL('../relay/setup.sh', import.meta.url), 'utf8');
const embedded = setup.match(/<<'CADDYFILE'\n([\s\S]*?)\nCADDYFILE/)?.[1].trim();
if (embedded !== caddyfile) {
  console.error('❌ relay/setup.sh 內嵌的 Caddy 設定與 relay/Caddyfile 不一致');
  process.exit(1);
}
console.log('✅ relay/setup.sh 與 relay/Caddyfile 一致');
