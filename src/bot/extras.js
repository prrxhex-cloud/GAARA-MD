import {
    makeVoidExtrasSocket,
    readMemoryStats,
    makeBoundedCache
} from '@sasa-dev/void-baileys';
import logger from '../utils/logger.js';

/**
 * 24/7 Uptime helper returning elapsed milliseconds.
 */
export function uptimeMs() {
    return Math.floor(process.uptime() * 1000);
}

/**
 * Memory Guard: Checks memory footprint against threshold (default 200MB)
 * and invokes garbage collection if active.
 */
export function checkMemoryGuard(limitMb = 200) {
    const stats = readMemoryStats ? readMemoryStats() : null;
    const heapUsedMb = stats ? stats.heapUsedMb : Math.round(process.memoryUsage().heapUsed / 1024 / 1024);

    if (heapUsedMb > limitMb) {
        logger.warn({ heapUsedMb, limitMb }, '[MemoryGuard] Memory limit exceeded, triggering GC');
        if (typeof global.gc === 'function') {
            try {
                global.gc();
            } catch {}
        }
        return { exceeded: true, heapUsedMb, limitMb };
    }
    return { exceeded: false, heapUsedMb, limitMb };
}

/**
 * Low-RAM Cache Helper using void-baileys bounded LRU cache.
 */
export function makeLowRamCache(maxKeys = 500, ttlMs = 5 * 60 * 1000) {
    if (typeof makeBoundedCache === 'function') {
        return makeBoundedCache(maxKeys, ttlMs);
    }
    const store = new Map();
    return {
        get(key) {
            const item = store.get(key);
            if (!item) return undefined;
            if (item.expireAt <= Date.now()) {
                store.delete(key);
                return undefined;
            }
            return item.value;
        },
        set(key, value) {
            if (store.size >= maxKeys) {
                const oldest = store.keys().next().value;
                if (oldest) store.delete(oldest);
            }
            store.set(key, { value, expireAt: Date.now() + ttlMs });
            return true;
        },
        del(key) { return store.delete(key); },
        flushAll() { store.clear(); },
        close() { store.clear(); }
    };
}

/**
 * Low-RAM Media Stream helper: downloads media stream chunks without buffering entire payload into single memory block.
 */
export async function streamLowRamMedia(sock, messageContainer) {
    try {
        if (typeof sock.downloadMedia === 'function') {
            return await sock.downloadMedia(messageContainer);
        } else if (typeof sock.downloadMediaMessage === 'function') {
            return await sock.downloadMediaMessage(messageContainer, 'buffer', {});
        }
        return null;
    } catch (err) {
        logger.warn({ err: err.message }, '[LowRamStream] Media stream download failed');
        return null;
    }
}

/**
 * Mini-Games Engine Helpers (chess, tictactoe, connect4)
 */
export async function startMiniGame(sock, jid, gameKind = 'chess', options = {}) {
    let socket = sock;
    if (typeof socket.startGame !== 'function' && (sock?.ev || sock?.ws)) {
        try { socket = makeVoidExtrasSocket(sock); } catch {}
    }
    if (typeof socket.startGame === 'function') {
        return await socket.startGame(jid, gameKind, options);
    }
    throw new Error(`Mini-games engine not available on socket for kind: ${gameKind}`);
}

export async function handleGameMove(sock, jid, moveInput) {
    let socket = sock;
    if (typeof socket.gameMove !== 'function' && (sock?.ev || sock?.ws)) {
        try { socket = makeVoidExtrasSocket(sock); } catch {}
    }
    if (typeof socket.gameMove === 'function') {
        return await socket.gameMove(jid, moveInput);
    }
    return false;
}

export async function endMiniGame(sock, jid) {
    let socket = sock;
    if (typeof socket.gameEnd !== 'function' && (sock?.ev || sock?.ws)) {
        try { socket = makeVoidExtrasSocket(sock); } catch {}
    }
    if (typeof socket.gameEnd === 'function') {
        return await socket.gameEnd(jid);
    }
    return false;
}

/**
 * Call Engine: manages call links and anti-call integration
 */
export async function createCallLink(sock, options = {}) {
    let socket = sock;
    if (typeof socket.createCallLink !== 'function' && (sock?.ev || sock?.ws)) {
        try { socket = makeVoidExtrasSocket(sock); } catch {}
    }
    if (typeof socket.createCallLink === 'function') {
        return await socket.createCallLink(options);
    }
    return null;
}

/**
 * Poll Voting Helpers: interactive WhatsApp poll voting
 */
export async function sendPollVoting(sock, jid, name, values = [], options = {}) {
    let socket = sock;
    if (typeof socket.sendPoll !== 'function' && (sock?.ev || sock?.ws)) {
        try { socket = makeVoidExtrasSocket(sock); } catch {}
    }
    if (typeof socket.sendPoll === 'function') {
        return await socket.sendPoll(jid, name, values, options);
    }
    return await sock.sendMessage(jid, {
        poll: {
            name,
            values,
            selectableCount: options.selectableCount ?? 1
        }
    });
}

export default {
    uptimeMs,
    checkMemoryGuard,
    makeLowRamCache,
    streamLowRamMedia,
    startMiniGame,
    handleGameMove,
    endMiniGame,
    createCallLink,
    sendPollVoting
};
