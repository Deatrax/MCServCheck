// JSON API for the web dashboard. One function with ?op= routing keeps the
// deployment well under the Hobby plan's per-deployment function limit.
//
//   GET    ?op=me                          signed-in user + Discord servers they can manage
//   GET    ?op=servers&guild=ID            tracked servers + alerts channel
//   POST   ?op=servers&guild=ID            add  { name, address, edition }
//   DELETE ?op=servers&guild=ID&name=N     remove
//   POST   ?op=check&guild=ID              ping every server now
//   GET    ?op=channels&guild=ID           text channels the alerts can go to
//   PUT    ?op=alerts&guild=ID             { channelId | null }
import { json, sessionFromRequest, isSameOriginWrite } from '../lib/auth.js';
import { listServers, getGuildSettings } from '../lib/db.js';
import { pingMany, formatAddress } from '../lib/mc.js';
import { botApi } from '../lib/discord.js';
import { addServerFromInput, removeServerByName, setAlertsChannel } from '../lib/service.js';

const INVITE_PERMISSIONS = String(1024 + 2048 + 16384); // View Channel, Send Messages, Embed Links

const serverView = (s) => ({
  name: s.name,
  address: formatAddress(s),
  edition: s.edition,
  status: s.status ?? null,
});

async function botGuildIds() {
  const guilds = await botApi('/users/@me/guilds?limit=200');
  return new Set(guilds.map((g) => g.id));
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handle(request) {
  if (!isSameOriginWrite(request)) return json({ error: 'Request blocked: bad origin.' }, 403);

  const session = await sessionFromRequest(request);
  if (!session) return json({ error: 'Sign in to continue.' }, 401);

  const url = new URL(request.url);
  const op = url.searchParams.get('op');
  const method = request.method;

  if (op === 'me' && method === 'GET') {
    const present = await botGuildIds().catch(() => new Set());
    return json({
      user: session.user,
      applicationId: process.env.DISCORD_APPLICATION_ID,
      invitePermissions: INVITE_PERMISSIONS,
      guilds: session.guilds.map((g) => ({ ...g, botPresent: present.has(g.id) })),
    });
  }

  // Everything else acts on one Discord server the user must be able to manage.
  const guildId = url.searchParams.get('guild');
  if (!guildId || !session.guilds.some((g) => g.id === guildId)) {
    return json({ error: 'You need Manage Server permission in that Discord server.' }, 403);
  }

  if (op === 'servers' && method === 'GET') {
    const [servers, settings] = await Promise.all([listServers(guildId), getGuildSettings(guildId)]);
    return json({ servers: servers.map(serverView), alertsChannelId: settings.alertsChannelId ?? null });
  }

  if (op === 'servers' && method === 'POST') {
    const body = await readBody(request);
    const res = await addServerFromInput(guildId, body, session.user.id);
    if (!res.ok) return json({ error: res.error }, 400);
    return json({ server: serverView(res.server), result: res.result }, 201);
  }

  if (op === 'servers' && method === 'DELETE') {
    const res = await removeServerByName(guildId, url.searchParams.get('name'));
    return res.ok ? json({ ok: true }) : json({ error: res.error }, 404);
  }

  if (op === 'check' && method === 'POST') {
    const servers = await listServers(guildId);
    const results = await pingMany(servers);
    return json({ results: servers.map((s, i) => ({ name: s.name, ...results[i] })) });
  }

  if (op === 'channels' && method === 'GET') {
    try {
      const channels = await botApi(`/guilds/${guildId}/channels`);
      return json({
        channels: channels
          .filter((c) => c.type === 0 || c.type === 5) // text + announcement
          .sort((a, b) => a.position - b.position)
          .map((c) => ({ id: c.id, name: c.name })),
      });
    } catch (err) {
      const status = err.status === 403 || err.status === 404 ? 409 : 502;
      return json({ error: 'The bot needs to be in this Discord server to list its channels.' }, status);
    }
  }

  if (op === 'alerts' && method === 'PUT') {
    const { channelId } = await readBody(request);
    const res = await setAlertsChannel(guildId, channelId || null);
    return res.ok ? json(res) : json({ error: res.error }, 400);
  }

  return json({ error: 'Unknown request.' }, 404);
}

async function safeHandle(request) {
  try {
    return await handle(request);
  } catch (err) {
    console.error('Dashboard API error', err);
    return json({ error: 'Something went wrong on the server. Check the Vercel logs.' }, 500);
  }
}

export const GET = safeHandle;
export const POST = safeHandle;
export const PUT = safeHandle;
export const DELETE = safeHandle;
