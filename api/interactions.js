import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from 'discord-interactions';
import { waitUntil } from '@vercel/functions';

import { listServers, findServer, searchServerNames, getGuildSettings } from '../lib/db.js';
import { pingServer, pingMany, normalizeName, formatAddress } from '../lib/mc.js';
import { readOptions, editOriginal, singleStatusEmbed, allStatusEmbed, listEmbed } from '../lib/discord.js';
import { addServerFromInput, removeServerByName, setAlertsChannel } from '../lib/service.js';

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// Visiting the URL in a browser is a quick "is it deployed?" check.
export function GET() {
  return new Response('Minecraft status bot is running. Discord should POST here.');
}

export async function POST(request) {
  // 1. Verify Discord's signature over the *raw* body. Discord rejects the endpoint without this.
  const signature = request.headers.get('x-signature-ed25519');
  const timestamp = request.headers.get('x-signature-timestamp');
  const rawBody = await request.text();

  // Trim whitespace/quotes that often sneak in when pasting into the Vercel dashboard.
  const publicKey = (process.env.DISCORD_PUBLIC_KEY ?? '').trim().replace(/^["']|["']$/g, '');
  if (!/^[0-9a-f]{64}$/i.test(publicKey)) {
    console.error(
      `DISCORD_PUBLIC_KEY looks wrong: expected 64 hex chars, got ${publicKey.length} chars. ` +
        'Copy "Public Key" (not Application ID / token / secret) and redeploy.',
    );
  }

  const isValid =
    Boolean(signature && timestamp) && (await verifyKey(rawBody, signature, timestamp, publicKey));
  if (!isValid) {
    console.warn(`Rejected request: ${signature ? 'signature did not verify' : 'no signature headers'}`);
    return new Response('Bad request signature', { status: 401 });
  }

  const interaction = JSON.parse(rawBody);

  switch (interaction.type) {
    case InteractionType.PING:
      return json({ type: InteractionResponseType.PONG });

    case InteractionType.APPLICATION_COMMAND_AUTOCOMPLETE:
      return json(await handleAutocomplete(interaction));

    case InteractionType.APPLICATION_COMMAND: {
      // Discord needs an answer within 3 s; DB + pings can take longer, so defer
      // now and finish in the background (waitUntil keeps the function alive).
      const ephemeral = interaction.data.name === 'server';
      waitUntil(runCommand(interaction));
      return json({
        type: InteractionResponseType.DEFERRED_CHANNEL_MESSAGE_WITH_SOURCE,
        ...(ephemeral && { data: { flags: InteractionResponseFlags.EPHEMERAL } }),
      });
    }

    default:
      return json({ error: 'Unknown interaction type' }, 400);
  }
}

async function handleAutocomplete(interaction) {
  const { focused } = readOptions(interaction.data);
  let choices = [];
  try {
    const docs = await searchServerNames(interaction.guild_id, String(focused ?? '').toLowerCase());
    choices = docs.map((d) => ({ name: `${d.name} (${formatAddress(d)})`.slice(0, 100), value: d.name }));
  } catch (err) {
    console.error('Autocomplete failed', err);
  }
  return { type: InteractionResponseType.APPLICATION_COMMAND_AUTOCOMPLETE_RESULT, data: { choices } };
}

async function runCommand(interaction) {
  try {
    if (!interaction.guild_id) {
      return editOriginal(interaction, { content: 'This bot only works inside a server.' });
    }
    const payload =
      interaction.data.name === 'status' ? await handleStatus(interaction) : await handleServer(interaction);
    await editOriginal(interaction, payload);
  } catch (err) {
    console.error('Command failed', err);
    await editOriginal(interaction, { content: `⚠️ Something went wrong: ${String(err?.message ?? err).slice(0, 300)}` });
  }
}

async function handleStatus(interaction) {
  const guildId = interaction.guild_id;
  const { values } = readOptions(interaction.data);

  if (values.name) {
    const name = normalizeName(values.name);
    const server = name && (await findServer(guildId, name));
    if (!server) return { content: `No server named **${String(values.name).slice(0, 32)}**. See \`/server list\`.` };
    const result = await pingServer(server);
    return { embeds: [singleStatusEmbed(server, result)] };
  }

  const servers = await listServers(guildId);
  if (!servers.length) return { content: 'No servers tracked yet. An admin can add one with `/server add`.' };
  const results = await pingMany(servers);
  return { embeds: [allStatusEmbed(servers, results)] };
}

async function handleServer(interaction) {
  const guildId = interaction.guild_id;
  const { subcommand, values } = readOptions(interaction.data);

  if (subcommand === 'list') {
    const [servers, settings] = await Promise.all([listServers(guildId), getGuildSettings(guildId)]);
    const embed = listEmbed(servers);
    embed.footer = {
      text: settings.alertsChannelId ? 'Alerts are on (see /server alerts)' : 'Alerts are off. Turn them on with /server alerts',
    };
    return { embeds: [embed] };
  }

  if (subcommand === 'remove') {
    const res = await removeServerByName(guildId, values.name);
    return { content: res.ok ? `🗑️ Removed **${res.name}**.` : res.error };
  }

  if (subcommand === 'add') {
    const res = await addServerFromInput(guildId, values, interaction.member?.user?.id ?? null);
    if (!res.ok) return { content: res.error };
    return { content: `✅ Added **${res.server.name}**. Current status:`, embeds: [singleStatusEmbed(res.server, res.result)] };
  }

  if (subcommand === 'alerts') {
    const res = await setAlertsChannel(guildId, values.channel ?? null);
    if (!res.ok) return { content: `⚠️ ${res.error}` };
    return {
      content: res.channelId
        ? `🔔 Alerts will be posted in <#${res.channelId}> when a server comes online or goes offline.`
        : '🔕 Alerts are off.',
    };
  }

  return { content: 'Unknown subcommand.' };
}
