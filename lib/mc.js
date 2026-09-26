import mcu from 'minecraft-server-util';

const { status, statusBedrock } = mcu;

const PING_TIMEOUT_MS = 5000;
const DEFAULT_PORT = { java: 25565, bedrock: 19132 };

// Aternos (and some other hosts) keep a proxy answering pings while the real server is
// asleep. It reports a fake version like "⚠ Offline" / "◌ Starting" instead of a real one.
const PLACEHOLDER_VERSION_RE = /\b(offline|starting|loading|preparing|stopping|saving|queue)\b/i;
const PLACEHOLDER_MOTD_RE = /this server is (currently )?offline/i;

const NAME_RE = /^[a-z0-9_-]{1,32}$/;

export function normalizeName(raw) {
  const name = String(raw ?? '').trim().toLowerCase();
  return NAME_RE.test(name) ? name : null;
}

/**
 * Parses "host", "host:port" or "[ipv6]:port".
 * `port` is null when not given, so Java pings can use the SRV record
 * (important for Aternos, whose SRV record always points at the current port).
 */
export function parseAddress(raw) {
  const input = String(raw ?? '').trim().replace(/^minecraft:\/\//i, '');
  let host = input;
  let port = null;

  const bracketed = input.match(/^\[([^\]]+)\](?::(\d{1,5}))?$/);
  if (bracketed) {
    host = bracketed[1];
    port = bracketed[2] ? Number(bracketed[2]) : null;
  } else if ((input.match(/:/g) || []).length === 1) {
    const [h, p] = input.split(':');
    if (!/^\d{1,5}$/.test(p)) return null;
    host = h;
    port = Number(p);
  }

  if (!host || /\s|\//.test(host)) return null;
  if (port !== null && (port < 1 || port > 65535)) return null;
  return { host, port };
}

export function formatAddress({ host, port }) {
  const h = host.includes(':') ? `[${host}]` : host;
  return port ? `${h}:${port}` : h;
}

/**
 * @returns {Promise<{state:'online'|'sleeping'|'offline', players?, version?, motd?, latency?, error?}>}
 */
export async function pingServer({ host, port, edition = 'java' }) {
  const started = Date.now();
  try {
    if (edition === 'bedrock') {
      const r = await statusBedrock(host, port ?? DEFAULT_PORT.bedrock, { timeout: PING_TIMEOUT_MS });
      return {
        state: 'online',
        players: { online: r.players.online, max: r.players.max, sample: [] },
        version: r.version?.name ?? 'unknown',
        motd: r.motd?.clean ?? '',
        latency: Date.now() - started,
      };
    }

    const r = await status(host, port ?? DEFAULT_PORT.java, {
      timeout: PING_TIMEOUT_MS,
      enableSRV: port == null,
    });
    const version = r.version?.name ?? 'unknown';
    const motd = r.motd?.clean ?? '';
    const sleeping = PLACEHOLDER_VERSION_RE.test(version) || PLACEHOLDER_MOTD_RE.test(motd);

    return {
      state: sleeping ? 'sleeping' : 'online',
      players: {
        online: r.players?.online ?? 0,
        max: r.players?.max ?? 0,
        sample: (r.players?.sample ?? []).map((p) => p.name).filter(Boolean),
      },
      version,
      motd,
      latency: r.roundTripLatency ?? Date.now() - started,
    };
  } catch (err) {
    return { state: 'offline', error: shortError(err) };
  }
}

function shortError(err) {
  const msg = String(err?.message ?? err);
  if (/timed? ?out/i.test(msg)) return 'Timed out';
  if (/ECONNREFUSED/.test(msg)) return 'Connection refused';
  if (/ENOTFOUND|EAI_AGAIN/.test(msg)) return 'Host not found';
  if (/ECONNRESET/.test(msg)) return 'Connection reset';
  return msg.slice(0, 100);
}
