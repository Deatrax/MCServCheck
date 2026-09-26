// Called every few minutes by an external scheduler (cron-job.org etc).
// Auth: "Authorization: Bearer <CRON_SECRET>" header (preferred) or ?key=<CRON_SECRET>.
import { timingSafeEqual } from 'node:crypto';
import { pollAll } from '../lib/monitor.js';
import { json } from '../lib/auth.js';

function authorized(request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  const provided = header || new URL(request.url).searchParams.get('key') || '';
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function GET(request) {
  if (!process.env.CRON_SECRET) return json({ error: 'CRON_SECRET is not set' }, 500);
  if (!authorized(request)) return json({ error: 'Unauthorized' }, 401);
  try {
    const summary = await pollAll();
    if (summary.alertErrors.length) console.warn('Alert delivery problems', summary.alertErrors);
    return json({ ok: true, ...summary });
  } catch (err) {
    console.error('Poll failed', err);
    return json({ ok: false, error: String(err?.message ?? err) }, 500);
  }
}

export const POST = GET;
