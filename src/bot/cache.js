import NodeCache from 'node-cache';
import logger from '../utils/logger.js';

// Cache messages for up to 3 hours (10800 seconds), maximum ~3000 keys
export const messageCache = new NodeCache({
    stdTTL: 10800,
    checkperiod: 600,
    maxKeys: 3000
});

// Cache for recent call logs / rate limiting
export const rateLimitCache = new NodeCache({
    stdTTL: 60,
    checkperiod: 30,
    maxKeys: 5000
});

/**
 * Stores a message into LRU cache for anti-delete and view-once recovery.
 */
export function cacheMessage(msg) {
    if (!msg || !msg.key || !msg.key.id) return;
    try {
        const id = msg.key.id;
        const entry = {
            id,
            key: msg.key,
            pushName: msg.pushName || 'Unknown',
            remoteJid: msg.key.remoteJid,
            participant: msg.key.participant || msg.key.remoteJid,
            fromMe: !!msg.key.fromMe,
            timestamp: msg.messageTimestamp,
            message: msg.message,
            raw: msg
        };
        messageCache.set(id, entry);
    } catch (err) {
        logger.error({ err: err.message }, '[Cache] Error caching message');
    }
}

/**
 * Retrieves a cached message by ID.
 */
export function getCachedMessage(id) {
    if (!id) return null;
    return messageCache.get(id) || null;
}

/**
 * Rate limiter check: returns true if allowed, false if limit exceeded.
 */
export function checkRateLimit(jid, maxPerMinute = 20) {
    const key = `ratelimit_${jid}`;
    const count = rateLimitCache.get(key) || 0;
    if (count >= maxPerMinute) {
        return false;
    }
    rateLimitCache.set(key, count + 1);
    return true;
}
