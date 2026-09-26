import { formatAddress } from './mc.js';

export const API = 'https://discord.com/api/v10';

/** Calls the Discord API as the bot. Throws an Error with .status and .code on failure. */
export async function botApi(path, { method = 'GET', body } = {}, retried = false) {
  const token = process.env.DISCORD_BOT_TOKEN;
  if (!token) throw new Error('DISCORD_BOT_TOKEN is not set');
  const res = await fetch(API + path, {
    method,
    headers: { Authorization: `Bot ${token}`, ...(body && { 'Content-Type': 'application/json' }) },
    body: body && JSON.stringify(body),
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (res.status === 429 && !retried) {
    await new Promise((r) => setTimeout(r, Math.min((data?.retry_after ?? 1) * 1000, 5000)));
    return botApi(path, { method, body }, true);
  }
  if (!res.ok) {
    const err = new Error(data?.message || `Discord API error ${res.status}`);
    err.status = res.status;
    err.code = data?.code;
    throw err;
  }
  return data;
}

export async function postToChannel(channelId, payload) {
  return botApi(`/channels/${channelId}/messages`, {
    method: 'POST',
    body: { allowed_mentions: { parse: [] }, ...payload },
  });
}

/** Turns Discord's permission errors into instructions a server admin can act on. */
export function explainChannelError(err) {
  if (err?.code === 50001) return "The bot can't see that channel. Give it View Channel and Send Messages there.";
  if (err?.code === 50013) return 'The bot is missing Send Messages or Embed Links in that channel.';
  if (err?.code === 10003) return "That channel doesn't exist any more.";
  if (err?.status === 403) return "The bot isn't allowed to post there. Check its channel permissions.";
  return `Discord refused the message: ${err?.message ?? err}`;
}

const COLORS = { online: 0x2ecc71, sleeping: 0xf1c40f, offline: 0xe74c3c, mixed: 0xe67e22, info: 0x5865f2 };
const ICONS = { online: '🟢', sleeping: '🟡', offline: '🔴' };
const LABELS = { online: 'Online', sleeping: 'Sleeping / starting', offline: 'Offline' };

/** Flattens options, descending into a subcommand if there is one. */
export function readOptions(data) {
  let opts = data?.options ?? [];
  let subcommand = null;
  if (opts[0]?.type === 1) {
    subcommand = opts[0].name;
    opts = opts[0].options ?? [];
  }
  const values = Object.fromEntries(opts.map((o) => [o.name, o.value]));
  const focused = opts.find((o) => o.focused)?.value;
  return { subcommand, values, focused: focused ?? null };
}

/** Replaces the deferred "thinking…" message with the real reply. */
export async function editOriginal(interaction, payload) {
  const url = `${API}/webhooks/${interaction.application_id}/${interaction.token}/messages/@original`;
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
    });
    if (!res.ok) console.error('Failed to edit interaction reply', res.status, await res.text());
  } catch (err) {
    console.error('Could not reach Discord to edit reply', err);
  }
}

const clean = (s, max = 200) =>
  String(s ?? '').replace(/`/g, "'").replace(/\s+/g, ' ').trim().slice(0, max) || '—';

export function singleStatusEmbed(server, result) {
  const addr = formatAddress(server);
  const embed = {
    title: `${ICONS[result.state]} ${server.name} — ${LABELS[result.state]}`,
    color: COLORS[result.state],
    fields: [
      { name: 'Address', value: `\`${addr}\``, inline: true },
      { name: 'Edition', value: server.edition === 'bedrock' ? 'Bedrock' : 'Java', inline: true },
    ],
    timestamp: new Date().toISOString(),
  };

  if (result.state === 'offline') {
    embed.fields.push({ name: 'Reason', value: clean(result.error), inline: true });
    return embed;
  }

  embed.fields.push(
    { name: 'Players', value: `${result.players.online}/${result.players.max}`, inline: true },
    { name: 'Version', value: clean(result.version, 100), inline: true },
    { name: 'Latency', value: `${result.latency} ms`, inline: true },
    { name: 'MOTD', value: `\`${clean(result.motd, 250)}\`` },
  );
  if (result.players.sample.length) {
    embed.fields.push({ name: 'Online now', value: clean(result.players.sample.slice(0, 15).join(', '), 1000) });
  }
  if (result.state === 'sleeping') {
    embed.description = 'The host answered, but with a placeholder (e.g. an Aternos server that is asleep or still starting).';
  }
  return embed;
}

export function allStatusEmbed(servers, results) {
  const states = new Set(results.map((r) => r.state));
  const color = states.size === 1 ? COLORS[[...states][0]] : COLORS.mixed;
  const onlineCount = results.filter((r) => r.state === 'online').length;

  return {
    title: `Server status — ${onlineCount}/${servers.length} online`,
    color,
    fields: servers.map((s, i) => {
      const r = results[i];
      const detail =
        r.state === 'offline'
          ? clean(r.error, 60)
          : r.state === 'sleeping'
            ? clean(r.version, 60)
            : `${r.players.online}/${r.players.max} players · ${r.latency} ms`;
      return {
        name: `${ICONS[r.state]} ${s.name}`,
        value: `\`${formatAddress(s)}\`\n${LABELS[r.state]} · ${detail}`,
        inline: true,
      };
    }),
    timestamp: new Date().toISOString(),
  };
}

export function formatDuration(ms) {
  const m = Math.round(ms / 60000);
  if (m < 1) return 'under a minute';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

/** Message posted by the poller when a server changes between up and down. */
export function alertEmbed(server, result, up, previousFor) {
  const addr = `\`${formatAddress(server)}\``;
  const was = previousFor ? ` after ${formatDuration(previousFor)} ${up ? 'down' : 'up'}` : '';
  if (up) {
    return {
      title: `🟢 ${server.name} is online`,
      description: `${addr} is up${was}. ${result.players.online}/${result.players.max} players on ${clean(result.version, 60)}.`,
      color: COLORS.online,
      timestamp: new Date().toISOString(),
    };
  }
  const sleeping = result.state === 'sleeping';
  return {
    title: sleeping ? `🟡 ${server.name} went to sleep` : `🔴 ${server.name} went offline`,
    description: `${addr} shut down${was}.${sleeping ? '' : ` Last error: ${clean(result.error, 80)}.`}`,
    color: sleeping ? COLORS.sleeping : COLORS.offline,
    timestamp: new Date().toISOString(),
  };
}

export function listEmbed(servers) {
  return {
    title: `Tracked servers (${servers.length})`,
    color: COLORS.info,
    description: servers.length
      ? servers
          .map((s) => `**${s.name}** — \`${formatAddress(s)}\` (${s.edition === 'bedrock' ? 'Bedrock' : 'Java'})`)
          .join('\n')
      : 'No servers yet. Add one with `/server add`.',
  };
}
