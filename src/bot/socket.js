import {
    makeWASocket,
    makeVoidExtrasSocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason
} from '@sasa-dev/void-baileys';
import path from 'path';
import fs from 'fs';
import config from '../../config/index.js';
import db from '../../config/database.js';
import cfSync from '../services/cfSync.js';
import { baileysLogger } from '../utils/logger.js';
import logger from '../utils/logger.js';
import { handleIncomingMessage } from './handler.js';
import { handleRevoke } from '../handlers/antiDelete.js';
import { handleEdit } from '../handlers/antiEdit.js';
import { handleCall } from '../handlers/antiCall.js';
import { startScheduler, stopScheduler } from '../handlers/scheduler.js';
import { formatConnectedSetupMessage, getBotIconBuffer, getBotAdReplyContext, wrapSocketWithBranding } from './format.js';
import { checkMemoryGuard } from './extras.js';
import { dispatchBotLog } from './loggerNotifier.js';
import { messageCache } from './cache.js';

let sockInstance = null;
let memoryGuardInterval = null;
let currentPairingCode = null;
let connectionState = 'connecting'; // 'disconnected' | 'connecting' | 'open' | 'unlinked'
let isInitialSync = false;
let lastSetupSentPhone = null;
let lastSetupSentPin = null;
let botTelemetry = {
    connectedAt: null,
    phoneNumber: null,
    platform: 'Desktop (Windows)',
    messagesHandled: 0,
    callsIntercepted: 0,
    battery: null
};

// Register getter with database for phone binding authentication
db.registerBotPhoneGetter(() => botTelemetry.phoneNumber);

export function getBotStatus() {
    const isOnline = connectionState === 'open';
    const isOfflineOrUnlinked = connectionState === 'unlinked' || connectionState === 'disconnected';
    const statusText = isOnline ? 'ONLINE' : (isOfflineOrUnlinked ? 'OFFLINE / UNLINKED' : 'CONNECTING');

    return {
        connection: connectionState,
        isLinked: isOnline,
        statusText,
        pairingCode: currentPairingCode,
        telemetry: {
            ...botTelemetry,
            uptimeSeconds: botTelemetry.connectedAt ? Math.floor((Date.now() - botTelemetry.connectedAt) / 1000) : 0
        }
    };
}

export function _setConnectionStateForTesting(state) {
    connectionState = state;
}

export function getSocket() {
    return sockInstance;
}

/**
 * Completely purges stale authentication files from the session directory.
 */
export async function clearSessionFiles() {
    try {
        if (fs.existsSync(config.sessionDir)) {
            const files = fs.readdirSync(config.sessionDir);
            for (const file of files) {
                if (file === '.gitkeep') continue;
                const fullPath = path.join(config.sessionDir, file);
                try {
                    fs.rmSync(fullPath, { recursive: true, force: true });
                } catch (rmErr) {
                    logger.warn({ file, err: rmErr.message }, '[Bot] Failed to remove session file');
                }
            }
            logger.info('[Bot] Session directory files cleared');
        }
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error clearing session files');
    }
}

/**
 * Cleanly terminates the active socket and resets state to unlinked.
 */
export async function resetSession({ clearFiles = true } = {}) {
    try {
        logger.info('[Bot] Resetting bot session and socket engine...');
        stopScheduler();
        if (memoryGuardInterval) {
            clearInterval(memoryGuardInterval);
            memoryGuardInterval = null;
        }

        if (sockInstance) {
            try {
                sockInstance.ev?.removeAllListeners?.();
                sockInstance.ws?.close?.();
                sockInstance.end?.();
            } catch (sockErr) {
                logger.debug({ err: sockErr.message }, '[Bot] Socket cleanup notice');
            }
            sockInstance = null;
        }

        if (clearFiles) {
            await clearSessionFiles();
        }

        connectionState = 'unlinked';
        currentPairingCode = null;
        botTelemetry.connectedAt = null;
        botTelemetry.phoneNumber = null;
        lastSetupSentPhone = null;
        lastSetupSentPin = null;
        db.setActiveBotPhone(null);

        logger.info('[Bot] Session successfully reset to unlinked state');
        return true;
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error resetting session');
        throw err;
    }
}

/**
 * Cleanly restarts the bot socket preserving active credentials.
 */
export async function restartBotSocket() {
    logger.info('[Bot] Restarting bot socket engine...');
    await resetSession({ clearFiles: false });
    return await initBotSocket();
}

// Runtime sync listener: push settings updates immediately to Cloudflare D1 and dispatch bot logs
db.on('settingsUpdated', async (newSettings, options = {}) => {
    try {
        if (botTelemetry.phoneNumber) {
            cfSync.saveSettingsToCloudflare(botTelemetry.phoneNumber, newSettings).catch(() => {});
        }
        // Suppress during initial boot / sync or when explicitly flagged
        if (isInitialSync || options?.suppressLog || newSettings?._suppressLog) {
            return;
        }
        if (connectionState === 'open' && sockInstance && newSettings.botLogs !== false) {
            dispatchBotLog(sockInstance, {
                title: 'SETTINGS UPDATED',
                emoji: '⚙️',
                content: [
                    `🛠️ *Settings modified via Web Dashboard*`,
                    `🌐 *Mode:* ${(newSettings.mode || 'public').toUpperCase()}`,
                    `🕒 *Time:* ${new Date().toLocaleTimeString()}`
                ]
            }).catch(() => {});
        }
    } catch {}
});

/**
 * Initializes the GAARA X MD Baileys WhatsApp Socket.
 */
export async function initBotSocket() {
    try {
        const { state, saveCreds } = await useMultiFileAuthState(config.sessionDir);

        // Safe socket flags & anti-ban settings
        const socketConfig = {
            auth: state,
            logger: baileysLogger,
            printQRInTerminal: false,
            browser: Browsers.windows('Desktop'),
            lowMemoryMode: config.lowMemoryMode ?? true,
            alwaysOn: config.alwaysOn ?? true,
            alwaysOnline: config.alwaysOnline ?? true,
            memoryGuardMb: config.memoryGuardMb ?? 200,
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        };

        logger.info('[Bot] Initializing @sasa-dev/void-baileys socket engine...');
        const sock = makeWASocket(socketConfig);
        try {
            const extras = makeVoidExtrasSocket(sock);
            Object.assign(sock, extras);
        } catch (e) {
            logger.debug({ err: e.message }, '[Bot] makeVoidExtrasSocket attachment notice');
        }
        wrapSocketWithBranding(sock);
        sockInstance = sock;

        // Credentials update
        sock.ev.on('creds.update', saveCreds);

        // Connection updates
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (connection) {
                connectionState = connection;
                logger.info({ connection }, '[Bot] Connection state update');
            }

            if (connection === 'open') {
                connectionState = 'open';
                currentPairingCode = null;
                botTelemetry.connectedAt = Date.now();

                // Start active memory guard enforcement (checks threshold every 60s)
                if (!memoryGuardInterval) {
                    memoryGuardInterval = setInterval(() => checkMemoryGuard(config.memoryGuardMb || 200), 60000);
                }

                const myJid = sock.user?.id ? (sock.parseJid ? sock.parseJid(sock.user.id) : sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
                const phone = myJid ? myJid.split('@')[0] : 'Unknown';
                botTelemetry.phoneNumber = phone;
                db.setActiveBotPhone(phone);

                // Dynamic 6-Digit Password Rotation: generate fresh unique 6-digit password every time
                const sessionPin = db.generateSessionPassword();

                logger.info({ phone }, '[Bot] GAARA X MD Connected Successfully!');

                // Cloudflare D1 Persistent Restore (Settings & Data restored by phone)
                if (phone && phone !== 'Unknown') {
                    isInitialSync = true;
                    try {
                        await cfSync.syncFromCloudflare(phone);
                    } catch (cfErr) {
                        logger.warn({ err: cfErr.message }, '[Bot] Cloudflare restore skipped');
                    } finally {
                        isInitialSync = false;
                    }
                }

                // Start message scheduler
                startScheduler(sock);

                // Send Single Consolidated Connected Setup Message to 'Message Yourself'
                // (Suppresses redundant 'SETTINGS UPDATED' and 'SYSTEM LOG // ONLINE' messages)
                await sendInitialSetupMessage(sock, phone, myJid, sessionPin);
            }

            if (connection === 'close') {
                stopScheduler();
                if (memoryGuardInterval) {
                    clearInterval(memoryGuardInterval);
                    memoryGuardInterval = null;
                }
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

                logger.warn({ statusCode, isLoggedOut }, '[Bot] Connection closed');

                db.setActiveBotPhone(null);
                lastSetupSentPhone = null;
                lastSetupSentPin = null;

                if (isLoggedOut) {
                    connectionState = 'unlinked';
                    botTelemetry.phoneNumber = null;
                    botTelemetry.connectedAt = null;
                    logger.error('[Bot] Device logged out / unlinked. Clearing stale session files...');
                    clearSessionFiles().catch(() => {});
                } else {
                    connectionState = 'disconnected';
                    botTelemetry.connectedAt = null;
                }
            }
        });

        // Messages listener
        sock.ev.on('messages.upsert', async ({ messages, type }) => {
            if (!Array.isArray(messages)) return;
            for (const msg of messages) {
                botTelemetry.messagesHandled++;
                const text = msg?.message?.buttonsResponseMessage?.selectedDisplayText
                    ?? msg?.message?.templateButtonReplyMessage?.selectedDisplayText
                    ?? msg?.message?.ephemeralMessage?.message?.buttonsResponseMessage?.selectedDisplayText
                    ?? msg?.message?.ephemeralMessage?.message?.templateButtonReplyMessage?.selectedDisplayText;
                if (text) {
                    console.log('user tapped:', text);
                }
                await handleIncomingMessage(sock, msg);
            }
        });

        // Message deletions listener (Anti-Delete)
        sock.ev.on('messages.delete', async (item) => {
            if (!item) return;
            const keys = Array.isArray(item) ? item : (Array.isArray(item.keys) ? item.keys : []);
            for (const key of keys) {
                if (!key || key.fromMe) continue;
                await handleRevoke(sock, { key });
            }
            if (item.all && item.jid) {
                const allKeys = messageCache.keys();
                for (const k of allKeys) {
                    const cached = messageCache.get(k);
                    if (cached && cached.remoteJid === item.jid && !cached.fromMe) {
                        await handleRevoke(sock, { key: cached.key });
                    }
                }
            }
        });

        // Message updates listener (edits, protocol updates & revokes)
        sock.ev.on('messages.update', async (updates) => {
            if (!Array.isArray(updates)) return;
            for (const update of updates) {
                const protoMsg = update.update?.message?.protocolMessage ||
                                 update.update?.message?.ephemeralMessage?.message?.protocolMessage;
                const isRevoke = update.update?.messageStubType === 68 ||
                                 (update.update?.message === null && update.key?.id) ||
                                 protoMsg?.type === 0;

                if (isRevoke) {
                    await handleRevoke(sock, {
                        key: protoMsg?.key || update.key,
                        message: update.update?.message,
                        messageTimestamp: update.update?.messageTimestamp || Math.floor(Date.now() / 1000)
                    });
                    continue;
                }

                const isEdit = protoMsg?.type === 14 ||
                               update.update?.message?.editedMessage ||
                               update.update?.message?.editedMessage?.message ||
                               update.update?.message?.ephemeralMessage?.message?.editedMessage ||
                               update.update?.message?.ephemeralMessage?.message?.editedMessage?.message;

                if (isEdit) {
                    await handleEdit(sock, {
                        key: update.key,
                        message: update.update?.message,
                        messageTimestamp: update.update?.messageTimestamp || Math.floor(Date.now() / 1000)
                    });
                }
            }
        });

        // Calls listener (Anti-Call)
        sock.ev.on('call', async (calls) => {
            botTelemetry.callsIntercepted += calls.length;
            await handleCall(sock, calls);
        });

        return sock;
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Failed to initialize socket');
        throw err;
    }
}

/**
 * Requests a pairing code for a given phone number with timeout and clean state guarantee.
 */
export async function requestPairing(phoneNumber, { frontendUrl } = {}) {
    const cleanNum = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanNum || cleanNum.length < 9) {
        throw new Error('Invalid phone number format. Must include country code.');
    }

    if (frontendUrl && typeof frontendUrl === 'string' && !frontendUrl.includes('localhost') && !frontendUrl.includes('127.0.0.1')) {
        db.updateSettings({ lastKnownDashboardUrl: frontendUrl.trim().replace(/\/+$/, '') }, { suppressLog: true });
    }

    // Always cleanly reset previous/stale unlinked socket state before pairing request.
    // This terminates old sockets, clears unlinked session files, and guarantees
    // fresh WebSocket negotiation with WhatsApp servers so requestPairingCode never hangs.
    logger.info({ phone: cleanNum }, '[Bot] Resetting session before pairing request to ensure fresh state');
    await resetSession({ clearFiles: true });
    await initBotSocket();

    let timeoutTimer = null;
    try {
        logger.info({ phone: cleanNum }, '[Bot] Requesting pairing code from WhatsApp servers...');
        const timeoutMs = 22000;
        const pairPromise = (async () => {
            if (sockInstance.startPairing) {
                const pairResult = await sockInstance.startPairing(cleanNum);
                return pairResult.code;
            }
            return await sockInstance.requestPairingCode(cleanNum);
        })();

        const timeoutPromise = new Promise((_, reject) => {
            timeoutTimer = setTimeout(() => {
                reject(new Error('Pairing code request timed out from WhatsApp. Please verify your phone number and try again.'));
            }, timeoutMs);
        });

        const code = await Promise.race([pairPromise, timeoutPromise]);
        clearTimeout(timeoutTimer);
        currentPairingCode = code;
        return code;
    } catch (err) {
        if (timeoutTimer) clearTimeout(timeoutTimer);
        logger.error({ err: err.message }, '[Bot] Pairing code request failed');
        // Cleanly reset failed socket to avoid stale pairing-in-progress state on next attempt
        await resetSession({ clearFiles: true }).catch(() => {});
        throw err;
    }
}

/**
 * Sends initial connected setup message to 'Message Yourself'.
 */
async function sendInitialSetupMessage(sock, phoneNumber, selfJid, activePin = null) {
    try {
        if (!selfJid) return;

        const admin = db.getAdminUser();
        const settings = db.getSettings();

        // Check if already sent for this exact session PIN
        if (activePin && lastSetupSentPin === activePin) {
            return;
        }
        if (!activePin && lastSetupSentPhone === phoneNumber) {
            return;
        }

        const panelPass = activePin || admin?.lastGeneratedPassword || '(Configured in panel / .env)';

        // Discover best public Dashboard URL
        let dashboardUrl = settings.lastKnownDashboardUrl || config.appUrl;
        if (!dashboardUrl || dashboardUrl.includes('localhost') || dashboardUrl.includes('127.0.0.1')) {
            if (process.env.APP_URL && !process.env.APP_URL.includes('localhost') && !process.env.APP_URL.includes('127.0.0.1')) {
                dashboardUrl = process.env.APP_URL;
            } else if (process.env.RENDER_EXTERNAL_URL) {
                dashboardUrl = process.env.RENDER_EXTERNAL_URL;
            } else if (process.env.VERCEL_URL) {
                dashboardUrl = `https://${process.env.VERCEL_URL}`;
            }
        }

        const setupText = formatConnectedSetupMessage(phoneNumber, panelPass, dashboardUrl);
        const channelUrl = settings.channelUrl || 'https://whatsapp.com/channel/gaaraxmd';
        const iconBuffer = getBotIconBuffer();
        const adReply = getBotAdReplyContext({ title: `${settings.botName || 'GAARA X MD'} SETUP` });

        if (sock.sendButton) {
            try {
                await sock.sendButton(selfJid, {
                    text: setupText,
                    footer: settings.footerText || 'THIS BOT BUILT BY GAARA DEV OFC.',
                    buttons: [
                        { text: '📋 COPY PASSWORD', copy: panelPass },
                        { text: 'View channel', url: channelUrl }
                    ],
                    ...(iconBuffer ? { image: iconBuffer } : {}),
                    contextInfo: adReply
                });
                lastSetupSentPhone = phoneNumber;
                lastSetupSentPin = activePin || panelPass;
                return;
            } catch (btnErr) {
                logger.warn({ err: btnErr.message }, '[Bot] Failed sending setup message with buttons, falling back to text');
            }
        }

        await sock.sendMessage(selfJid, {
            text: setupText,
            contextInfo: adReply
        });
        lastSetupSentPhone = phoneNumber;
        lastSetupSentPin = activePin || panelPass;
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error sending initial setup message');
    }
}
