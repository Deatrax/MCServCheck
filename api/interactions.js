import {
  verifyKey,
  InteractionType,
  InteractionResponseType,
  InteractionResponseFlags,
} from 'discord-interactions';
import { waitUntil } from '@vercel/functions';

import { listServers, findServer, addServer, removeServer, searchServerNames, MAX_SERVERS_PER_GUILD } from '../lib/db.js';
import { pingServer, parseAddress, normalizeName, formatAddress } from '../lib/mc.js';
import { readOptions, editOriginal, singleStatusEmbed, allStatusEmbed, listEmbed } from '../lib/discord.js';

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
  const results = await Promise.all(servers.map(pingServer));
  return { embeds: [allStatusEmbed(servers, results)] };
}

async function handleServer(interaction) {
  const guildId = interaction.guild_id;
  const { subcommand, values } = readOptions(interaction.data);

  if (subcommand === 'list') {
    return { embeds: [listEmbed(await listServers(guildId))] };
  }

  if (subcommand === 'remove') {
    const name = normalizeName(values.name);
    const removed = name && (await removeServer(guildId, name));
    return { content: removed ? `🗑️ Removed **${name}**.` : `No server named **${String(values.name).slice(0, 32)}**.` };
  }

  if (subcommand === 'add') {
    const name = normalizeName(values.name);
    if (!name) return { content: 'Name must be 1–32 characters: letters, numbers, `_` or `-`.' };

    const addr = parseAddress(values.address);
    if (!addr) return { content: 'That address looks invalid. Use `host` or `host:port`.' };

    const edition = values.edition === 'bedrock' ? 'bedrock' : 'java';
    const server = { name, host: addr.host, port: addr.port, edition, addedBy: interaction.member?.user?.id ?? null };

    const outcome = await addServer(guildId, server);
    if (outcome === 'exists') return { content: `**${name}** already exists. Remove it first to change it.` };
    if (outcome === 'limit') return { content: `This server already tracks the maximum of ${MAX_SERVERS_PER_GUILD}.` };

    // Ping once so a typo in the address is obvious straight away.
    const result = await pingServer(server);
    return { content: `✅ Added **${name}**. Current status:`, embeds: [singleStatusEmbed(server, result)] };
  }

  return { content: 'Unknown subcommand.' };
}
