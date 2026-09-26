// Ping a server from your machine using the exact same code the bot uses.
//   npm run check -- Animos900.aternos.me
//   npm run check -- play.example.com:19132 --bedrock
import { parseAddress, pingServer, formatAddress } from '../lib/mc.js';

const args = process.argv.slice(2);
const edition = args.includes('--bedrock') ? 'bedrock' : 'java';
const addresses = args.filter((a) => !a.startsWith('--'));

if (!addresses.length) {
  console.error('Usage: npm run check -- <host[:port]> [more hosts...] [--bedrock]');
  process.exit(1);
}

const ICON = { online: '🟢', sleeping: '🟡', offline: '🔴' };

for (const raw of addresses) {
  const addr = parseAddress(raw);
  if (!addr) {
    console.log(`❌ ${raw}: invalid address`);
    continue;
  }
  const r = await pingServer({ ...addr, edition });
  console.log(`${ICON[r.state]} ${formatAddress(addr)} (${edition}): ${r.state}`);
  if (r.state === 'offline') {
    console.log(`   reason:  ${r.error}`);
  } else {
    console.log(`   version: ${r.version}`);
    console.log(`   players: ${r.players.online}/${r.players.max}${r.players.sample.length ? ` (${r.players.sample.join(', ')})` : ''}`);
    console.log(`   latency: ${r.latency} ms`);
    console.log(`   motd:    ${r.motd.replace(/\s+/g, ' ').trim()}`);
  }
}
