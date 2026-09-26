import {
  appUrl, redirect, parseCookies, setCookie, clearCookie,
  exchangeCode, startSession, SESSION_COOKIE, STATE_COOKIE,
} from '../../lib/auth.js';

export async function GET(request) {
  const url = new URL(request.url);
  const home = appUrl(request);
  const fail = (reason) => redirect(`${home}/?error=${encodeURIComponent(reason)}`, [clearCookie(STATE_COOKIE)]);

  if (url.searchParams.get('error')) return fail('Sign-in was cancelled.');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state || state !== parseCookies(request)[STATE_COOKIE]) {
    return fail('Sign-in expired or was tampered with. Try again.');
  }

  try {
    const token = await exchangeCode(request, code);
    const session = await startSession(token.access_token, token.expires_in);
    return redirect(`${home}/`, [
      clearCookie(STATE_COOKIE),
      setCookie(SESSION_COOKIE, session.id, session.maxAge),
    ]);
  } catch (err) {
    console.error('OAuth callback failed', err);
    return fail('Discord sign-in failed. Check DISCORD_CLIENT_SECRET and the redirect URL.');
  }
}
