// Run locally once (and again whenever lib/commands.js changes):
//   npm run register
import { COMMANDS } from '../lib/commands.js';

const { DISCORD_APPLICATION_ID: appId, DISCORD_BOT_TOKEN: token, DISCORD_GUILD_ID: guildId } = process.env;

if (!appId || !token) {
  console.error('Set DISCORD_APPLICATION_ID and DISCORD_BOT_TOKEN in .env first.');
  process.exit(1);
}

const url = guildId
  ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
  : `https://discord.com/api/v10/applications/${appId}/commands`;

// PUT overwrites the whole command set, so removed commands disappear too.
const res = await fetch(url, {
  method: 'PUT',
  headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(COMMANDS),
});

if (!res.ok) {
  console.error(`Failed (${res.status}):`, await res.text());
  process.exit(1);
}

const registered = await res.json();
console.log(
  `Registered ${registered.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}:`,
  registered.map((c) => `/${c.name}`).join(', '),
);
