import {
    makeWASocket,
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
import { handleEdit } from '../handlers/antiEdit.js';
import { handleCall } from '../handlers/antiCall.js';
import { startScheduler, stopScheduler } from '../handlers/scheduler.js';
import { formatConnectedSetupMessage } from './format.js';
import { dispatchBotLog } from './loggerNotifier.js';

let sockInstance = null;
let currentPairingCode = null;
let connectionState = 'connecting'; // 'disconnected' | 'connecting' | 'open' | 'unlinked'
let isInitialSync = false;
let botTelemetry = {
    connectedAt: null,
    phoneNumber: null,
    platform: 'Desktop (Windows)',
    messagesHandled: 0,
    callsIntercepted: 0,
    battery: null
};

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

        // Reset setup message phone marker so new pair triggers setup card
        db.updateSettings({ _lastSetupSentPhone: null, _suppressLog: true });

        logger.info('[Bot] Session successfully reset to unlinked state');
        return true;
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error resetting session');
        throw err;
    }
}

// Runtime sync listener: push settings updates immediately to Cloudflare D1 and dispatch bot logs
db.on('settingsUpdated', async (newSettings) => {
    try {
        if (botTelemetry.phoneNumber) {
            cfSync.saveSettingsToCloudflare(botTelemetry.phoneNumber, newSettings).catch(() => {});
        }
        // Suppress during initial boot / sync or when explicitly flagged
        if (isInitialSync || newSettings?._suppressLog) {
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
            lowMemoryMode: config.lowMemoryMode,
            alwaysOn: config.alwaysOn,
            alwaysOnline: config.alwaysOnline,
            memoryGuardMb: config.memoryGuardMb,
            syncFullHistory: false,
            generateHighQualityLinkPreview: true,
            markOnlineOnConnect: true,
            connectTimeoutMs: 60000,
            defaultQueryTimeoutMs: 60000,
            keepAliveIntervalMs: 30000
        };

        logger.info('[Bot] Initializing @sasa-dev/void-baileys socket engine...');
        const sock = makeWASocket(socketConfig);
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

                const myJid = sock.user?.id ? (sock.parseJid ? sock.parseJid(sock.user.id) : sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
                const phone = myJid ? myJid.split('@')[0] : 'Unknown';
                botTelemetry.phoneNumber = phone;

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
                await sendInitialSetupMessage(sock, phone, myJid);
            }

            if (connection === 'close') {
                stopScheduler();
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const isLoggedOut = statusCode === DisconnectReason.loggedOut || statusCode === 401;

                logger.warn({ statusCode, isLoggedOut }, '[Bot] Connection closed');

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
                await handleIncomingMessage(sock, msg);
            }
        });

        // Message updates listener (edits & protocol updates)
        sock.ev.on('messages.update', async (updates) => {
            if (!Array.isArray(updates)) return;
            for (const update of updates) {
                if (update.update?.message?.protocolMessage?.type === 14) {
                    await handleEdit(sock, {
                        key: update.key,
                        message: update.update.message,
                        messageTimestamp: update.update.messageTimestamp || Math.floor(Date.now() / 1000)
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

    if (frontendUrl && typeof frontendUrl === 'string' && !frontendUrl.includes('localhost')) {
        db.updateSettings({ lastKnownDashboardUrl: frontendUrl.trim().replace(/\/+$/, ''), _suppressLog: true });
    }

    // Check if session directory contains stale / registered credentials
    const credsPath = path.join(config.sessionDir, 'creds.json');
    let hasRegisteredCreds = false;
    if (fs.existsSync(credsPath)) {
        try {
            const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'));
            if (creds && (creds.registered || creds.me)) {
                hasRegisteredCreds = true;
            }
        } catch {}
    }

    // If registered creds linger, or if socket is disconnected/unlinked/stale:
    // Reset cleanly so WhatsApp delivers the pair-device IQ stanza without hanging.
    if (hasRegisteredCreds || !sockInstance || connectionState === 'unlinked' || connectionState === 'disconnected') {
        logger.info('[Bot] Resetting previous/stale session before pairing request');
        await resetSession({ clearFiles: true });
        await initBotSocket();
    }

    if (!sockInstance) {
        await initBotSocket();
    }

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
            setTimeout(() => {
                reject(new Error('Pairing code request timed out from WhatsApp. Please verify your phone number and try again.'));
            }, timeoutMs);
        });

        const code = await Promise.race([pairPromise, timeoutPromise]);
        currentPairingCode = code;
        return code;
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Pairing code request failed');
        throw err;
    }
}

/**
 * Sends initial connected setup message to 'Message Yourself'.
 */
async function sendInitialSetupMessage(sock, phoneNumber, selfJid) {
    try {
        if (!selfJid) return;

        const admin = db.getAdminUser();
        const settings = db.getSettings();

        // Check if already sent for this phone number
        if (settings._lastSetupSentPhone === phoneNumber) {
            return;
        }

        const panelPass = admin?.lastGeneratedPassword || '(Configured in panel / .env)';

        // Discover best public Dashboard URL
        let dashboardUrl = settings.lastKnownDashboardUrl || config.appUrl;
        if (!dashboardUrl || dashboardUrl.includes('localhost') || dashboardUrl.includes('127.0.0.1')) {
            if (process.env.APP_URL && !process.env.APP_URL.includes('localhost')) {
                dashboardUrl = process.env.APP_URL;
            } else if (process.env.RENDER_EXTERNAL_URL) {
                dashboardUrl = process.env.RENDER_EXTERNAL_URL;
            } else if (process.env.VERCEL_URL) {
                dashboardUrl = `https://${process.env.VERCEL_URL}`;
            }
        }

        const setupText = formatConnectedSetupMessage(phoneNumber, panelPass, dashboardUrl);
        const channelUrl = settings.channelUrl || 'https://whatsapp.com/channel/gaaraxmd';

        if (sock.sendButton) {
            try {
                await sock.sendButton(selfJid, {
                    text: setupText,
                    footer: settings.footerText || 'THIS BOT BUILT BY GAARA DEV OFC.',
                    buttons: [
                        { text: '📋 COPY PASSWORD', copy: panelPass },
                        { text: 'View channel', url: channelUrl }
                    ]
                });
                db.updateSettings({ _lastSetupSentPhone: phoneNumber, _suppressLog: true });
                return;
            } catch (btnErr) {
                logger.warn({ err: btnErr.message }, '[Bot] Failed sending setup message with buttons, falling back to text');
            }
        }

        await sock.sendMessage(selfJid, { text: setupText });
        db.updateSettings({ _lastSetupSentPhone: phoneNumber, _suppressLog: true });
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error sending initial setup message');
    }
}
