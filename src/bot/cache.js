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
 * Recursively unwraps nested message containers (deviceSentMessage, ephemeralMessage,
 * documentWithCaptionMessage, viewOnceMessage, viewOnceMessageV2, viewOnceMessageV2Extension).
 */
export function unwrapMessage(msgOrContent) {
    if (!msgOrContent) return null;
    let curr = msgOrContent.message || msgOrContent;
    while (curr) {
        if (curr.ephemeralMessage?.message) {
            curr = curr.ephemeralMessage.message;
        } else if (curr.deviceSentMessage?.message) {
            curr = curr.deviceSentMessage.message;
        } else if (curr.documentWithCaptionMessage?.message) {
            curr = curr.documentWithCaptionMessage.message;
        } else if (curr.viewOnceMessage?.message) {
            curr = curr.viewOnceMessage.message;
        } else if (curr.viewOnceMessageV2?.message) {
            curr = curr.viewOnceMessageV2.message;
        } else if (curr.viewOnceMessageV2Extension?.message) {
            curr = curr.viewOnceMessageV2Extension.message;
        } else if (curr.protocolMessage?.editedMessage?.message) {
            curr = curr.protocolMessage.editedMessage.message;
        } else if (curr.protocolMessage?.editedMessage) {
            curr = curr.protocolMessage.editedMessage;
        } else if (curr.editedMessage?.message) {
            curr = curr.editedMessage.message;
        } else if (curr.editedMessage) {
            curr = curr.editedMessage;
        } else {
            break;
        }
    }
    return curr;
}

/**
 * Stores a message into LRU cache for anti-delete and view-once recovery.
 * Guarantees that an existing valid message payload is NEVER overwritten by
 * an empty revoke stanza (protocolMessage.type === 0).
 */
export function cacheMessage(msg) {
    if (!msg || !msg.key || !msg.key.id) return;
    try {
        const id = msg.key.id;
        const unwrapped = unwrapMessage(msg);

        // Check if the incoming message is a revoke stanza (protocolMessage.type === 0)
        const isRevokeStanza = unwrapped?.protocolMessage?.type === 0;
        if (isRevokeStanza) {
            // NEVER overwrite or store empty revoke stanzas into message cache
            return;
        }

        // Check if we already have an existing cached entry
        const existing = messageCache.get(id);
        if (existing) {
            const existingUnwrapped = unwrapMessage(existing.message || existing.raw);
            const hasExistingContent = existingUnwrapped && (
                existingUnwrapped.conversation ||
                existingUnwrapped.extendedTextMessage?.text ||
                existingUnwrapped.imageMessage ||
                existingUnwrapped.videoMessage ||
                existingUnwrapped.audioMessage ||
                existingUnwrapped.documentMessage ||
                existingUnwrapped.stickerMessage ||
                existingUnwrapped.contactMessage ||
                existingUnwrapped.locationMessage ||
                existingUnwrapped.pollCreationMessage ||
                existingUnwrapped.pollCreationMessageV3
            );

            // If existing entry has valid text or media, and incoming message is empty or a protocol message, preserve existing
            if (hasExistingContent && (!unwrapped || unwrapped.protocolMessage)) {
                return;
            }
        }

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

export default {
    messageCache,
    rateLimitCache,
    unwrapMessage,
    cacheMessage,
    getCachedMessage,
    checkRateLimit
};
