// Business logic shared by the slash commands and the web dashboard,
// so both enforce exactly the same rules.
import { addServer, removeServer, setAlertsChannelId, MAX_SERVERS_PER_GUILD } from './db.js';
import { normalizeName, parseAddress, pingServer } from './mc.js';
import { botApi, postToChannel, explainChannelError } from './discord.js';

// Discord IDs ("snowflakes") are 17–20 digit numbers.
const SNOWFLAKE_RE = /^\d{17,20}$/;

/** @returns {Promise<{ok:true, server, result} | {ok:false, error:string}>} */
export async function addServerFromInput(guildId, { name, address, edition }, addedBy = null) {
  const cleanName = normalizeName(name);
  if (!cleanName) return { ok: false, error: 'Name must be 1–32 characters: letters, numbers, _ or -.' };

  const addr = parseAddress(address);
  if (!addr) return { ok: false, error: 'That address looks invalid. Use host or host:port.' };

  const server = {
    name: cleanName,
    host: addr.host,
    port: addr.port,
    edition: edition === 'bedrock' ? 'bedrock' : 'java',
    addedBy,
  };

  const outcome = await addServer(guildId, server);
  if (outcome === 'exists') return { ok: false, error: `"${cleanName}" already exists. Remove it first to change it.` };
  if (outcome === 'limit') return { ok: false, error: `You can track at most ${MAX_SERVERS_PER_GUILD} servers.` };

  // Ping once so a typo in the address shows up straight away.
  return { ok: true, server, result: await pingServer(server) };
}

export async function removeServerByName(guildId, rawName) {
  const name = normalizeName(rawName);
  const removed = name ? await removeServer(guildId, name) : false;
  return removed ? { ok: true, name } : { ok: false, error: `No server named "${String(rawName).slice(0, 32)}".` };
}

/**
 * Sets (or with null, turns off) the channel for online/offline alerts.
 * Posts a test message first so permission problems surface immediately.
 */
export async function setAlertsChannel(guildId, channelId) {
  if (!channelId) {
    await setAlertsChannelId(guildId, null);
    return { ok: true, channelId: null };
  }
  // The dashboard sends a raw channel ID, so check it before using it:
  // it must be a real ID (it goes into a URL path) and belong to this Discord server.
  if (!SNOWFLAKE_RE.test(String(channelId))) return { ok: false, error: "That isn't a valid channel." };
  let channel;
  try {
    channel = await botApi(`/channels/${channelId}`);
  } catch (err) {
    return { ok: false, error: explainChannelError(err) };
  }
  if (channel.guild_id !== guildId) return { ok: false, error: "That channel isn't in this Discord server." };
  if (channel.type !== 0 && channel.type !== 5) return { ok: false, error: 'Pick a text or announcement channel.' };

  try {
    await postToChannel(channelId, {
      content: '🔔 Server alerts will be posted here when a tracked Minecraft server comes online or goes offline.',
    });
  } catch (err) {
    return { ok: false, error: explainChannelError(err) };
  }
  await setAlertsChannelId(guildId, channelId);
  return { ok: true, channelId };
}
