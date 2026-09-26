import { json, endSession, clearCookie, isSameOriginWrite, SESSION_COOKIE } from '../../lib/auth.js';

export async function POST(request) {
  if (!isSameOriginWrite(request)) return json({ error: 'Bad origin' }, 403);
  await endSession(request);
  return json({ ok: true }, 200, { 'Set-Cookie': clearCookie(SESSION_COOKIE) });
}
