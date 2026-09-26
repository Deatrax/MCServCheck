import { formatAddress } from './mc.js';

const API = 'https://discord.com/api/v10';

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
