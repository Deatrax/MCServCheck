import { listAllServers, getGuildSettingsMany, updateServerStatus } from './db.js';
import { pingMany } from './mc.js';
import { alertEmbed, postToChannel, explainChannelError } from './discord.js';

// A single failed ping is often just a hiccup, so "down" needs this many in a row.
// "Up" is reported on the first successful ping.
export const DOWN_CONFIRMATIONS = 2;

/**
 * Pure state machine: given the stored status and a fresh ping, returns the new
 * status and whether it counts as a change worth alerting about.
 * "Up" means a real online response; sleeping (Aternos placeholder) and offline are both "down".
 */
export function nextStatus(prev = {}, result, now = new Date()) {
  const isUp = result.state === 'online';
  const downStreak = isUp ? 0 : (prev.downStreak ?? 0) + 1;

  let up;
  if (prev.up === undefined) up = isUp; // first observation: record, don't alert
  else if (isUp) up = true;
  else if (downStreak >= DOWN_CONFIRMATIONS) up = false;
  else up = prev.up;

  const changed = prev.up !== undefined && up !== prev.up;
  const status = {
    up,
    state: result.state,
    downStreak,
    checkedAt: now,
    changedAt: changed || !prev.changedAt ? now : prev.changedAt,
    players: result.players ? { online: result.players.online, max: result.players.max } : null,
    version: result.version ?? null,
    error: result.error ?? null,
  };
  const previousFor = changed && prev.changedAt ? now - new Date(prev.changedAt) : null;
  return { status, changed, previousFor };
}

export async function pollAll() {
  const servers = await listAllServers();
  if (!servers.length) return { checked: 0, changes: [], alertErrors: [] };

  const results = await pingMany(servers);
  const settings = await getGuildSettingsMany([...new Set(servers.map((s) => s.guildId))]);
  const now = new Date();
  const changes = [];
  const alertErrors = [];

  await Promise.all(
    servers.map(async (server, i) => {
      const { status, changed, previousFor } = nextStatus(server.status, results[i], now);
      await updateServerStatus(server._id, status);
      if (!changed) return;

      changes.push({ guildId: server.guildId, name: server.name, up: status.up, state: status.state });
      const channelId = settings.get(server.guildId)?.alertsChannelId;
      if (!channelId) return;
      try {
        await postToChannel(channelId, { embeds: [alertEmbed(server, results[i], status.up, previousFor)] });
      } catch (err) {
        alertErrors.push({ guildId: server.guildId, name: server.name, error: explainChannelError(err) });
      }
    }),
  );

  return { checked: servers.length, changes, alertErrors };
}
