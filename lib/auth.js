import { randomBytes } from 'node:crypto';
import { API } from './discord.js';
import { createSession, getSession, updateSession, deleteSession } from './db.js';

export const SESSION_COOKIE = 'mcs_session';
export const STATE_COOKIE = 'mcs_oauth_state';
const SESSION_TTL_S = 7 * 24 * 3600; // matches Discord's access-token lifetime
const GUILD_REFRESH_MS = 5 * 60 * 1000;

const ADMINISTRATOR = 0x8n;
const MANAGE_GUILD = 0x20n;

// ---------- small HTTP helpers ----------

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers },
  });

export function redirect(location, cookies = []) {
  const headers = new Headers({ Location: location, 'Cache-Control': 'no-store' });
  for (const c of cookies) headers.append('Set-Cookie', c);
  return new Response(null, { status: 302, headers });
}

export function appUrl(request) {
  return (process.env.APP_URL || new URL(request.url).origin).replace(/\/+$/, '');
}

export const redirectUri = (request) => `${appUrl(request)}/api/auth/callback`;

export function parseCookies(request) {
  const out = {};
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export const clearCookie = (name) => setCookie(name, '', 0);

export const newToken = (bytes = 32) => randomBytes(bytes).toString('base64url');

/**
 * Basic CSRF defence for state-changing requests: the session cookie is SameSite=Lax,
 * and we additionally require a JSON body and (when sent) a same-origin Origin header.
 */
export function isSameOriginWrite(request) {
  if (request.method === 'GET') return true;
  const origin = request.headers.get('origin');
  if (origin && origin !== appUrl(request)) return false;
  return (request.headers.get('content-type') ?? '').includes('application/json') || request.method === 'DELETE';
}

// ---------- Discord OAuth ----------

async function discordUserApi(path, accessToken) {
  const res = await fetch(API + path, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = new Error(`Discord API ${path} failed with ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

export async function exchangeCode(request, code) {
  const res = await fetch(`${API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri(request),
      client_id: process.env.DISCORD_APPLICATION_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
    }),
  });
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  return res.json();
}

const canManage = (g) => g.owner || (BigInt(g.permissions ?? 0) & (ADMINISTRATOR | MANAGE_GUILD)) !== 0n;

/** Only keeps the Discord servers where this user may manage the bot (Manage Server or Admin). */
async function fetchManageableGuilds(accessToken) {
  const guilds = await discordUserApi('/users/@me/guilds', accessToken);
  return guilds.filter(canManage).map((g) => ({ id: g.id, name: g.name, icon: g.icon }));
}

export async function startSession(accessToken, expiresIn) {
  const [user, guilds] = await Promise.all([
    discordUserApi('/users/@me', accessToken),
    fetchManageableGuilds(accessToken),
  ]);
  const ttl = Math.min(expiresIn || SESSION_TTL_S, SESSION_TTL_S);
  const id = newToken();
  await createSession({
    _id: id,
    user: { id: user.id, name: user.global_name || user.username, avatar: user.avatar },
    accessToken,
    guilds,
    guildsFetchedAt: new Date(),
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + ttl * 1000),
  });
  return { id, maxAge: ttl };
}

export async function sessionFromRequest(request) {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (!id) return null;
  const session = await getSession(id);
  if (!session) return null;

  // Keep permissions reasonably fresh (someone may have lost Manage Server).
  if (Date.now() - new Date(session.guildsFetchedAt).getTime() > GUILD_REFRESH_MS) {
    try {
      session.guilds = await fetchManageableGuilds(session.accessToken);
      session.guildsFetchedAt = new Date();
      await updateSession(id, { guilds: session.guilds, guildsFetchedAt: session.guildsFetchedAt });
    } catch (err) {
      if (err.status === 401) {
        await deleteSession(id); // token revoked: force a fresh sign-in
        return null;
      }
      // Rate limited or Discord hiccup: keep using the cached list.
    }
  }
  return session;
}

export async function endSession(request) {
  const id = parseCookies(request)[SESSION_COOKIE];
  if (id) await deleteSession(id);
}
