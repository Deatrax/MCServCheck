import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

export const MAX_SERVERS_PER_GUILD = 25; // Discord embeds hold at most 25 fields

let dbPromise;

/**
 * Cached at module scope so warm invocations reuse one connection pool.
 * Collections: servers, guilds (per-Discord-server settings, _id = guildId), sessions.
 */
export function getDb() {
  if (!dbPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');

    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      appName: 'mc-status-bot',
    });
    attachDatabasePool(client); // lets Vercel close idle connections before suspending

    dbPromise = client
      .connect()
      .then(async (c) => {
        const db = c.db(process.env.MONGODB_DB || 'mcstatus');
        await Promise.all([
          db.collection('servers').createIndex({ guildId: 1, name: 1 }, { unique: true }),
          db.collection('sessions').createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
        ]);
        return db;
      })
      .catch((err) => {
        dbPromise = undefined; // allow a retry on the next invocation
        throw err;
      });
  }
  return dbPromise;
}

const col = async (name) => (await getDb()).collection(name);

// ---------- servers ----------

export async function listServers(guildId) {
  return (await col('servers')).find({ guildId }).sort({ name: 1 }).toArray();
}

export async function listAllServers() {
  return (await col('servers')).find({}).toArray();
}

export async function findServer(guildId, name) {
  return (await col('servers')).findOne({ guildId, name });
}

/** @returns {'added'|'exists'|'limit'} */
export async function addServer(guildId, server) {
  const servers = await col('servers');
  if ((await servers.countDocuments({ guildId })) >= MAX_SERVERS_PER_GUILD) return 'limit';
  try {
    await servers.insertOne({ guildId, ...server, createdAt: new Date() });
    return 'added';
  } catch (err) {
    if (err?.code === 11000) return 'exists';
    throw err;
  }
}

export async function removeServer(guildId, name) {
  const res = await (await col('servers')).deleteOne({ guildId, name });
  return res.deletedCount > 0;
}

export async function updateServerStatus(id, status) {
  await (await col('servers')).updateOne({ _id: id }, { $set: { status } });
}

export async function searchServerNames(guildId, prefix, limit = 25) {
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return (await col('servers'))
    .find({ guildId, name: { $regex: `^${escaped}` } }, { projection: { name: 1, host: 1, port: 1 } })
    .sort({ name: 1 })
    .limit(limit)
    .toArray();
}

// ---------- per-guild settings ----------

export async function getGuildSettings(guildId) {
  return (await (await col('guilds')).findOne({ _id: guildId })) ?? { _id: guildId };
}

export async function getGuildSettingsMany(guildIds) {
  const docs = await (await col('guilds')).find({ _id: { $in: guildIds } }).toArray();
  return new Map(docs.map((d) => [d._id, d]));
}

export async function setAlertsChannelId(guildId, channelId) {
  await (await col('guilds')).updateOne(
    { _id: guildId },
    { $set: { alertsChannelId: channelId ?? null, updatedAt: new Date() } },
    { upsert: true },
  );
}

// ---------- dashboard sessions ----------

export async function createSession(doc) {
  await (await col('sessions')).insertOne(doc);
}

export async function getSession(id) {
  const s = await (await col('sessions')).findOne({ _id: id });
  return s && s.expiresAt > new Date() ? s : null;
}

export async function updateSession(id, fields) {
  await (await col('sessions')).updateOne({ _id: id }, { $set: fields });
}

export async function deleteSession(id) {
  await (await col('sessions')).deleteOne({ _id: id });
}
