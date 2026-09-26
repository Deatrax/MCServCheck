import { redirectUri, redirect, setCookie, newToken, STATE_COOKIE } from '../../lib/auth.js';

export function GET(request) {
  if (!process.env.DISCORD_APPLICATION_ID || !process.env.DISCORD_CLIENT_SECRET) {
    return new Response('DISCORD_APPLICATION_ID and DISCORD_CLIENT_SECRET must be set.', { status: 500 });
  }
  const state = newToken(16);
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_APPLICATION_ID,
    response_type: 'code',
    scope: 'identify guilds',
    redirect_uri: redirectUri(request),
    state,
    prompt: 'none', // skip the consent screen after the first time
  });
  return redirect(`https://discord.com/oauth2/authorize?${params}`, [setCookie(STATE_COOKIE, state, 600)]);
}
