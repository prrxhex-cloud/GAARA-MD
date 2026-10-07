import {
    makeWASocket,
    useMultiFileAuthState,
    Browsers,
    DisconnectReason
} from '@sasa-dev/void-baileys';
import path from 'path';
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

let sockInstance = null;
let currentPairingCode = null;
let connectionState = 'connecting'; // 'disconnected' | 'connecting' | 'open' | 'unlinked'
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

// Runtime sync listener: push settings updates immediately to Cloudflare D1
db.on('settingsUpdated', async (newSettings) => {
    try {
        if (botTelemetry.phoneNumber) {
            cfSync.saveSettingsToCloudflare(botTelemetry.phoneNumber, newSettings).catch(() => {});
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
                    try {
                        await cfSync.syncFromCloudflare(phone);
                    } catch (cfErr) {
                        logger.warn({ err: cfErr.message }, '[Bot] Cloudflare restore skipped');
                    }
                }

                // Start message scheduler
                startScheduler(sock);

                // Check and send Connected Setup Message to 'Message Yourself'
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
                    logger.error('[Bot] Device logged out / unlinked. Please re-pair via dashboard /pair');
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
 * Requests a pairing code for a given phone number.
 */
export async function requestPairing(phoneNumber) {
    if (!sockInstance) {
        await initBotSocket();
    }

    const cleanNum = phoneNumber.replace(/[^0-9]/g, '');
    if (!cleanNum || cleanNum.length < 9) {
        throw new Error('Invalid phone number format');
    }

    try {
        logger.info({ phone: cleanNum }, '[Bot] Requesting pairing code...');
        let code = '';
        if (sockInstance.startPairing) {
            const pairResult = await sockInstance.startPairing(cleanNum);
            code = pairResult.code;
        } else {
            code = await sockInstance.requestPairingCode(cleanNum);
        }

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
        const appUrl = config.appUrl || `http://localhost:${config.port}`;

        const setupText = formatConnectedSetupMessage(phoneNumber, panelPass, appUrl);
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
                db.updateSettings({ _lastSetupSentPhone: phoneNumber });
                return;
            } catch (btnErr) {
                logger.warn({ err: btnErr.message }, '[Bot] Failed sending setup message with buttons, falling back to text');
            }
        }

        await sock.sendMessage(selfJid, { text: setupText });
        db.updateSettings({ _lastSetupSentPhone: phoneNumber });
    } catch (err) {
        logger.error({ err: err.message }, '[Bot] Error sending initial setup message');
    }
}
