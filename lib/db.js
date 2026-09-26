import { MongoClient } from 'mongodb';
import { attachDatabasePool } from '@vercel/functions';

export const MAX_SERVERS_PER_GUILD = 25; // Discord embeds hold at most 25 fields

let collectionPromise;

/**
 * Returns the `servers` collection. The client is cached at module scope so warm
 * invocations reuse the same connection pool instead of reconnecting every time.
 */
function getCollection() {
  if (!collectionPromise) {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error('MONGODB_URI is not set');

    const client = new MongoClient(uri, {
      maxPoolSize: 5,
      serverSelectionTimeoutMS: 8000,
      appName: 'mc-status-bot',
    });
    // Lets Vercel close idle connections cleanly before the instance is suspended.
    attachDatabasePool(client);

    collectionPromise = client
      .connect()
      .then(async (c) => {
        const col = c.db(process.env.MONGODB_DB || 'mcstatus').collection('servers');
        await col.createIndex({ guildId: 1, name: 1 }, { unique: true });
        return col;
      })
      .catch((err) => {
        collectionPromise = undefined; // allow a retry on the next invocation
        throw err;
      });
  }
  return collectionPromise;
}

export async function listServers(guildId) {
  const col = await getCollection();
  return col.find({ guildId }).sort({ name: 1 }).toArray();
}

export async function findServer(guildId, name) {
  const col = await getCollection();
  return col.findOne({ guildId, name });
}

/** @returns {'added'|'exists'|'limit'} */
export async function addServer(guildId, server) {
  const col = await getCollection();
  const count = await col.countDocuments({ guildId });
  if (count >= MAX_SERVERS_PER_GUILD) return 'limit';
  try {
    await col.insertOne({ guildId, ...server, createdAt: new Date() });
    return 'added';
  } catch (err) {
    if (err?.code === 11000) return 'exists';
    throw err;
  }
}

/** @returns {boolean} whether something was deleted */
export async function removeServer(guildId, name) {
  const col = await getCollection();
  const res = await col.deleteOne({ guildId, name });
  return res.deletedCount > 0;
}

export async function searchServerNames(guildId, prefix, limit = 25) {
  const col = await getCollection();
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const docs = await col
    .find({ guildId, name: { $regex: `^${escaped}` } }, { projection: { name: 1, host: 1, port: 1 } })
    .sort({ name: 1 })
    .limit(limit)
    .toArray();
  return docs;
}
