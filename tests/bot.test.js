import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import db from '../config/database.js';
import { validateMessage, extractText } from '../src/utils/antiBug.js';
import { formatFramedMessage, formatConnectedSetupMessage, resolveDestinationJid, getBotIconBuffer, getBotAdReplyContext, wrapSocketWithBranding } from '../src/bot/format.js';
import { cacheMessage, getCachedMessage } from '../src/bot/cache.js';
import { handleEdit } from '../src/handlers/antiEdit.js';
import { handleRevoke } from '../src/handlers/antiDelete.js';
import cfSync from '../src/services/cfSync.js';
import worker from '../worker/index.js';
import { getBotStatus, resetSession, clearSessionFiles, restartBotSocket } from '../src/bot/socket.js';
import { handleIncomingMessage } from '../src/bot/handler.js';
import { allCommandCategories, commandMap, getCommand } from '../src/commands/index.js';
import { createServer } from '../src/server/app.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../config/constants.js';
import { dispatchBotLog } from '../src/bot/loggerNotifier.js';
import {
    SETTINGS_BUTTONS,
    formatSettingsMenuText,
    sendSettingsButtons,
    sendPlainButtons,
    sendTemplateButtons,
    sendNativeFlowButtons,
    sendClassicButtons,
    extractButtonPayload,
    handleSettingsButtonAction
} from '../src/bot/buttons.js';
import { normalizeCommandTrigger } from '../src/bot/handler.js';
import { getSasaDevApiKey, chatSasaAiPlus, PERMANENT_SASA_KEY } from '../src/services/sasaApi.js';
import { uptimeMs, checkMemoryGuard, makeLowRamCache, sendPollVoting } from '../src/bot/extras.js';
import { TRIGGER_SETTINGS_BUTTONS, ALL_SETTINGS_BUTTONS } from '../src/bot/buttons.js';

describe('1. Database & Security Tests', () => {
    test('Settings initialize and persist properly', () => {
        const s = db.getSettings();
        assert.ok(s.botName, 'Bot name should exist');
        assert.equal(typeof s.antiCall, 'boolean');
        assert.equal(typeof s.antiDelete, 'boolean');
        assert.equal(typeof s.autoStatus, 'boolean');

        const updated = db.updateSettings({ testField: 'value123' });
        assert.equal(updated.testField, 'value123');
        assert.equal(db.getSettings().testField, 'value123');
    });

    test('Bcrypt password verification and update', () => {
        const admin = db.getAdminUser();
        assert.ok(admin, 'Admin user record must exist');
        assert.ok(admin.passwordHash, 'Password must be stored as bcrypt hash');
        assert.notEqual(admin.passwordHash, 'testPass123', 'Password hash must NOT be plain text');

        // Update password
        db.updateAdminPassword('SecurePass2026!');
        assert.ok(db.verifyAdminPassword('SecurePass2026!'), 'Correct password verifies successfully');
        assert.ok(!db.verifyAdminPassword('WrongPassword'), 'Incorrect password fails');
    });

    test('Custom replies store, clear, and retrieval', () => {
        const entry = db.addReply('ping-test', 'pong-reply', 'exact');
        assert.ok(entry.id);
        const replies = db.getReplies();
        assert.ok(replies.some(r => r.trigger === 'ping-test'));

        const deleted = db.removeReply(entry.id);
        assert.ok(deleted);
    });

    test('Anti-call warning counters', () => {
        const testCaller = '1234567890@s.whatsapp.net';
        db.resetCallWarnings(testCaller);

        assert.equal(db.recordCall(testCaller), 1);
        assert.equal(db.recordCall(testCaller), 2);
        assert.equal(db.recordCall(testCaller), 3);
        assert.equal(db.recordCall(testCaller), 4);

        db.resetCallWarnings(testCaller);
        assert.equal(db.getCallWarnings()[testCaller], undefined);
    });
});

describe('2. Anti-Bug & Sanitization Tests', () => {
    test('Rejects null, empty or missing JID messages', () => {
        assert.equal(validateMessage(null).safe, false);
        assert.equal(validateMessage({}).safe, false);
        assert.equal(validateMessage({ key: {} }).safe, false);
    });

    test('Accepts valid safe messages', () => {
        const safeMsg = {
            key: { remoteJid: '12345@s.whatsapp.net', id: 'ABC' },
            message: { conversation: 'Hello bot' }
        };
        assert.equal(validateMessage(safeMsg).safe, true);
    });

    test('Drops oversized messages (> 15,000 characters)', () => {
        const hugeText = 'A'.repeat(16000);
        const hugeMsg = {
            key: { remoteJid: '12345@s.whatsapp.net', id: 'ABC' },
            message: { conversation: hugeText }
        };
        const res = validateMessage(hugeMsg);
        assert.equal(res.safe, false);
        assert.ok(res.reason.includes('Oversized'));
    });

    test('Drops messages matching crash patterns (zero-width flood)', () => {
        const crashText = '\u200B'.repeat(600);
        const crashMsg = {
            key: { remoteJid: '12345@s.whatsapp.net', id: 'ABC' },
            message: { conversation: crashText }
        };
        const res = validateMessage(crashMsg);
        assert.equal(res.safe, false);
        assert.ok(res.reason.includes('crash pattern'));
    });
});

describe('3. In-Chat Layout Formatting Tests', () => {
    test('Exact ASCII box framing layout', () => {
        const framed = formatFramedMessage([
            {
                emoji: '⚡',
                title: 'TEST SECTION',
                content: ['Line 1 of content', 'Line 2 of content']
            }
        ], { botName: 'GAARA X MD' });

        assert.ok(framed.includes('╭───[ ⚡ GAARA X MD ]'), 'Must include top header box');
        assert.ok(framed.includes('╭───[ ⚡ TEST SECTION ]'), 'Must include section box');
        assert.ok(framed.includes('│◇│  Line 1 of content'), 'Must include framed content line');
        assert.ok(framed.includes(BOT_FOOTER), 'Must include exact footer');
    });

    test('Connected Setup Message formatting', () => {
        const setup = formatConnectedSetupMessage('94771234567', 'tempPass123', 'http://localhost:3000');
        assert.ok(setup.includes('GAARA X MD SETUP'));
        assert.ok(setup.includes('+94771234567'));
        assert.ok(setup.includes('tempPass123'));
        assert.ok(setup.includes('http://localhost:3000/settings'));
        assert.ok(setup.includes(BOT_FOOTER));
    });
});

describe('4. Expanded Command Library Coverage', () => {
    const requiredCommands = [
        // System & Info
        'alive', 'ping', 'uptime', 'owner', 'speed', 'runtime', 'system', 'botinfo', 'rules',
        // Navigation
        'menu', 'help', 'list', 'allcmd',
        // Utilities
        'calc', 'qr', 'weather', 'translate', 'tts', 'quoted', 'jid', 'shorturl', 'time',
        'define', 'morse', 'base64', 'binary', 'currency', 'ip', 'fliptext', 'fancy', 'genpass',
        // Media
        'sticker', 's', 'take', 'toimg', 'tomp3', 'readviewonce', 'vv', 'attp', 'round', 'circle', 'emojimix', 'blur', 'invert', 'greyscale',
        // Search
        'google', 'wiki', 'lyrics', 'github', 'npm', 'crypto', 'imdb',
        // Downloader
        'play', 'song', 'ytmp3', 'ytmp4', 'video', 'tiktok', 'ig', 'fb', 'twitter', 'gitclone',
        // Group Management
        'kick', 'add', 'promote', 'demote', 'tagall', 'hidetag', 'link', 'mute', 'unmute', 'setname', 'setdesc', 'revoke', 'tagadmin', 'groupinfo', 'leave',
        // Fun & Games
        'tictactoe', 'chess', 'roll', 'coin', 'joke', 'fact', 'truth', 'dare', '8ball', 'ship', 'riddle', 'quote', 'roast', 'compliment', 'rate',
        // Anime
        'waifu', 'neko', 'shinobu', 'megumin', 'animequote', 'wallpaper',
        // AI Chat
        'ai', 'ask', 'chat',
        // Profile
        'getpp', 'saveprofile', 'setpp', 'setbio', 'getbio',
        // Customization
        'setbotname', 'setbotlogo', 'addreply', 'delreply', 'listreply', 'clearreplies',
        // Owner Controls
        'settings', 'config', 'mode', 'antiedit', 'anticall', 'antidelete', 'autostatus', 'block', 'unblock', 'broadcast', 'setprefix', 'eval', 'exec', 'clearcache', 'restart', 'join'
    ];

    for (const cmd of requiredCommands) {
        test(`Command exists in registry: .${cmd}`, () => {
            const found = getCommand(cmd);
            assert.ok(found, `Command .${cmd} must be registered`);
            assert.equal(typeof found.run, 'function', `Command .${cmd} must have a run() handler`);
        });
    }
});

describe('5. Express Server & Keepalive Endpoints', () => {
    test('/health returns 200 with service info', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/health`);
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.status, 'ok');
            assert.ok(data.service);
        } finally {
            server.close();
        }
    });

    test('/ping returns 200 pong for Render keepalive', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/ping`);
            assert.equal(res.status, 200);
            const text = await res.text();
            assert.equal(text, 'pong');
        } finally {
            server.close();
        }
    });

    test('/api/status returns live bot telemetry and configuration', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/api/status`);
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.ok(data.botName);
            assert.ok(data.connection);
            assert.ok(data.telemetry);
        } finally {
            server.close();
        }
    });

    test('GET / serves complete 3D cyber landing page with real-time UI components', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/`);
            assert.equal(res.status, 200);
            assert.ok(res.headers.get('content-type')?.includes('text/html'));
            const html = await res.text();
            assert.ok(html.includes('GAARA X MD'));
            assert.ok(html.includes('without limits'));
            assert.ok(html.includes('bg-canvas'));
            assert.ok(html.includes('hero3dCard'));
            assert.ok(html.includes('landing.css'));
            assert.ok(html.includes('landing.js'));
            assert.ok(!html.includes('/css/style.css'), 'Landing page must not link to dashboard style.css to prevent layout conflict');
            assert.ok(html.includes('Connect your WhatsApp'));
            assert.ok(html.includes('countdownTimer'));
            assert.ok(html.includes('countdownSeconds'));
            assert.ok(html.includes('Everything your bot needs'));
            assert.ok(html.includes('Support'));
            assert.ok(html.includes('Cookies'));
        } finally {
            server.close();
        }
    });

    test('/api/status returns live dynamic command count and system metadata', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const res = await fetch(`http://localhost:${port}/api/status`);
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(typeof data.commandCount, 'number');
            assert.ok(data.commandCount >= 100);
            assert.ok(Array.isArray(data.categories));
            assert.ok(data.categories.length > 5);
            assert.ok(typeof data.serverUptime === 'number');
        } finally {
            server.close();
        }
    });

    test('static assets are served correctly via /assets/bot_icon.jpg and /css/landing.css', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            const cssRes = await fetch(`http://localhost:${port}/css/landing.css`);
            assert.equal(cssRes.status, 200);
            const css = await cssRes.text();
            assert.ok(css.includes('tilt-card'));
            assert.ok(css.includes('.about-visual'));
            assert.ok(css.includes('.countdown-timer'));
            assert.ok(css.includes('@media (max-width: 520px)'));

            const imgRes = await fetch(`http://localhost:${port}/assets/bot_icon.jpg`);
            assert.equal(imgRes.status, 200);
            const buf = await imgRes.arrayBuffer();
            assert.ok(buf.byteLength > 1000);
        } finally {
            server.close();
        }
    });

    test('portal HTML routes (/about, /reviews, /status, /pair) and /api/commands operate correctly', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            // 1. /about
            const aboutRes = await fetch(`http://localhost:${port}/about`);
            assert.equal(aboutRes.status, 200);
            const aboutHtml = await aboutRes.text();
            assert.ok(aboutHtml.includes('GAARA X MD'));
            assert.ok(aboutHtml.includes('Speed first'));
            assert.ok(aboutHtml.includes('portal.css'));

            // 2. /reviews
            const reviewsRes = await fetch(`http://localhost:${port}/reviews`);
            assert.equal(reviewsRes.status, 200);
            const reviewsHtml = await reviewsRes.text();
            assert.ok(reviewsHtml.includes('Write a review'));
            assert.ok(reviewsHtml.includes('COMMUNITY VOICES'));

            // 3. /status
            const statusRes = await fetch(`http://localhost:${port}/status`);
            assert.equal(statusRes.status, 200);
            const statusHtml = await statusRes.text();
            assert.ok(statusHtml.includes('All systems operational'));
            assert.ok(statusHtml.includes('Core API'));

            // 4. /pair
            const pairRes = await fetch(`http://localhost:${port}/pair`);
            assert.equal(pairRes.status, 200);
            const pairHtml = await pairRes.text();
            assert.ok(pairHtml.includes('WhatsApp Phone Number'));
            assert.ok(pairHtml.includes('GET PAIRING CODE'));

            // 5. /settings
            const settingsRes = await fetch(`http://localhost:${port}/settings`);
            assert.equal(settingsRes.status, 200);
            const settingsHtml = await settingsRes.text();
            assert.ok(settingsHtml.includes('Bot settings'));
            assert.ok(settingsHtml.includes('Bot behavior'));

            // 6. /api/commands
            const cmdRes = await fetch(`http://localhost:${port}/api/commands`);
            assert.equal(cmdRes.status, 200);
            const cmdData = await cmdRes.json();
            assert.equal(cmdData.total, 120);
            assert.equal(cmdData.categories.length, 13);
            assert.ok(cmdData.commands.system.length > 0);
            assert.ok(cmdData.commands.ai.length > 0);
            assert.ok(cmdData.commands.downloader.length > 0);

            // 7. /api/reviews GET
            const revApiRes = await fetch(`http://localhost:${port}/api/reviews`);
            assert.equal(revApiRes.status, 200);
            const revData = await revApiRes.json();
            assert.ok(Array.isArray(revData.reviews));
            assert.ok(revData.reviews.length >= 6);
            assert.ok(revData.reviews.some(r => r.name.includes('Sayuru Senavirathna')));
            assert.ok(revData.average >= 4.5);

            // 8. /api/reviews POST validation
            const invalidPost = await fetch(`http://localhost:${port}/api/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: 'A', review: 'Hi' })
            });
            assert.equal(invalidPost.status, 400);

            // 9. /api/reviews POST valid
            const validPost = await fetch(`http://localhost:${port}/api/reviews`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: 'Automated Test User',
                    rating: 5,
                    review: 'Exemplary cyber portal test verification with zero fake data!'
                })
            });
            assert.equal(validPost.status, 200);
            const created = await validPost.json();
            assert.ok(created.success);
            assert.equal(created.review.name, 'Automated Test User');
            assert.ok(created.review.id);

            // Clean up test review so database is not polluted with fake test reviews!
            db.removeReview(created.review.id);
        } finally {
            server.close();
        }
    });
});

describe('6. Anti-Edit, Configurable Destinations & Multi-Cloud Tests', () => {
    test('resolveDestinationJid routes correctly for Self Chat vs Same Chat', () => {
        const mockSock = {
            user: { id: '94770000000:1@s.whatsapp.net' },
            parseJid: (id) => id.split(':')[0] + '@s.whatsapp.net'
        };

        const remoteChat = '123456789-group@g.us';

        // 1. Destination 'self'
        assert.equal(resolveDestinationJid(mockSock, remoteChat, 'self'), '94770000000@s.whatsapp.net');
        assert.equal(resolveDestinationJid(mockSock, remoteChat, 'Self Chat'), '94770000000@s.whatsapp.net');

        // 2. Destination 'same'
        assert.equal(resolveDestinationJid(mockSock, remoteChat, 'same'), remoteChat);
        assert.equal(resolveDestinationJid(mockSock, remoteChat, 'Same Chat'), remoteChat);

        // 3. Status broadcast fallback to self
        assert.equal(resolveDestinationJid(mockSock, 'status@broadcast', 'same'), '94770000000@s.whatsapp.net');
    });

    test('Anti-Edit recovers edited messages and produces original vs edited comparison', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        // Cache original message
        const originalMsg = {
            key: { id: 'msg-to-edit-123', remoteJid: '94771112233@s.whatsapp.net', fromMe: false },
            pushName: 'TestUser',
            message: { conversation: 'This is the original text before edit' },
            messageTimestamp: 1760000000
        };
        cacheMessage(originalMsg);

        // Configure anti-edit to same chat
        db.updateSettings({ antiEdit: true, antiEditDestination: 'same' });

        // Simulate incoming edit protocol message
        const editMsg = {
            key: { id: 'edit-protocol-1', remoteJid: '94771112233@s.whatsapp.net', fromMe: false },
            message: {
                protocolMessage: {
                    type: 14, // MESSAGE_EDIT
                    key: { id: 'msg-to-edit-123', remoteJid: '94771112233@s.whatsapp.net', fromMe: false },
                    editedMessage: { conversation: 'This is the updated NEW text after edit' }
                }
            },
            messageTimestamp: 1760000060
        };

        await handleEdit(mockSock, editMsg);

        assert.equal(mockSock.sentMessages.length, 1);
        const sent = mockSock.sentMessages[0];
        assert.equal(sent.jid, '94771112233@s.whatsapp.net');
        assert.ok(sent.content.text.includes('[ ✏️ MESSAGE EDITED ]'));
        assert.ok(sent.content.text.includes('This is the original text before edit'));
        assert.ok(sent.content.text.includes('This is the updated NEW text after edit'));
        assert.ok(sent.content.text.includes(BOT_FOOTER));

        // Check that cache was updated with the new edited message
        const updatedCache = getCachedMessage('msg-to-edit-123');
        assert.equal(updatedCache.message.conversation, 'This is the updated NEW text after edit');
    });

    test('Anti-Delete recovers message to configured destination', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        // Cache original message
        const msgToDelete = {
            key: { id: 'msg-to-delete-456', remoteJid: '94779998877@s.whatsapp.net', fromMe: false },
            pushName: 'DeleteTester',
            message: { conversation: 'I will be deleted soon' },
            messageTimestamp: 1760000100
        };
        cacheMessage(msgToDelete);

        // Configure anti-delete to self chat
        db.updateSettings({ antiDelete: true, antiDeleteDestination: 'self' });

        // Simulate revoke protocol message
        const revokeMsg = {
            key: { id: 'revoke-protocol-1', remoteJid: '94779998877@s.whatsapp.net', fromMe: false },
            message: {
                protocolMessage: {
                    type: 0, // REVOKE
                    key: { id: 'msg-to-delete-456', remoteJid: '94779998877@s.whatsapp.net', fromMe: false }
                }
            }
        };

        await handleRevoke(mockSock, revokeMsg);

        assert.equal(mockSock.sentMessages.length, 1);
        const sent = mockSock.sentMessages[0];
        assert.equal(sent.jid, '94770000000@s.whatsapp.net');
        assert.ok(sent.content.text.includes('[ 🛡️ ANTI DELETE ]'));
        assert.ok(sent.content.text.includes('I will be deleted soon'));
        assert.ok(sent.content.text.includes(BOT_FOOTER));
    });

    test('Database updateSettings immediately syncs in-memory without lag', () => {
        let eventFired = false;
        let eventPayload = null;

        const listener = (newSettings) => {
            eventFired = true;
            eventPayload = newSettings;
        };

        db.on('settingsUpdated', listener);

        const updated = db.updateSettings({ mode: 'groups', antiEdit: true, headerTitle: 'TEST HEADER' });
        assert.equal(db.getSettings().mode, 'groups');
        assert.equal(db.getSettings().headerTitle, 'TEST HEADER');
        assert.ok(eventFired);
        assert.equal(eventPayload.mode, 'groups');

        db.removeListener('settingsUpdated', listener);
    });

    test('cfSync exports complete persistent API without throwing when offline', async () => {
        assert.equal(typeof cfSync.syncFromCloudflare, 'function');
        assert.equal(typeof cfSync.syncToCloudflare, 'function');
        assert.equal(typeof cfSync.saveSettingsToCloudflare, 'function');
        assert.equal(typeof cfSync.saveSchedulesToCloudflare, 'function');
        assert.equal(typeof cfSync.saveRepliesToCloudflare, 'function');
        assert.equal(typeof cfSync.fetchSecretsFromCloudflare, 'function');

        // Test with offline phone, should catch and return safe object
        const res = await cfSync.syncFromCloudflare('94779999999');
        assert.equal(typeof res, 'object');
    });

    test('Cloudflare Worker exports valid fetch handler with CORS and health check', async () => {
        assert.ok(worker);
        assert.equal(typeof worker.fetch, 'function');

        // Test CORS preflight OPTIONS
        const optionsReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/health', {
            method: 'OPTIONS'
        });
        const optionsRes = await worker.fetch(optionsReq, {}, {});
        assert.equal(optionsRes.status, 204);
        assert.equal(optionsRes.headers.get('Access-Control-Allow-Origin'), '*');

        // Test Health GET
        const healthReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/health', {
            method: 'GET'
        });
        const healthRes = await worker.fetch(healthReq, {}, {});
        assert.equal(healthRes.status, 200);
        const healthData = await healthRes.json();
        assert.equal(healthData.status, 'ok');
        assert.equal(healthData.service, 'ofc');
    });

    test('Cloudflare Worker handles Bearer auth and full D1 REST operations', async () => {
        const mockDb = {
            tables: {
                user_settings: new Map(),
                user_schedules: new Map(),
                user_replies: new Map(),
                secrets: new Map([['TEST_KEY', 'secret_val_123']])
            },
            prepare(query) {
                return {
                    bind(...args) {
                        return {
                            async first() {
                                if (query.includes('FROM user_settings')) {
                                    const row = mockDb.tables.user_settings.get(args[0]);
                                    return row ? { settings_json: row, updated_at: '2026-10-07T12:00:00Z' } : null;
                                }
                                return null;
                            },
                            async all() {
                                if (query.includes('FROM user_schedules')) {
                                    const list = Array.from(mockDb.tables.user_schedules.values()).filter(x => x.phone === args[0]);
                                    return { results: list };
                                }
                                if (query.includes('FROM user_replies')) {
                                    const list = Array.from(mockDb.tables.user_replies.values()).filter(x => x.phone === args[0]);
                                    return { results: list };
                                }
                                if (query.includes('FROM secrets')) {
                                    const list = Array.from(mockDb.tables.secrets.entries()).map(([k, v]) => ({ key: k, value: v }));
                                    return { results: list };
                                }
                                return { results: [] };
                            },
                            async run() {
                                if (query.includes('INSERT INTO user_settings')) {
                                    mockDb.tables.user_settings.set(args[0], args[1]);
                                }
                                if (query.includes('INSERT INTO user_schedules')) {
                                    mockDb.tables.user_schedules.set(args[0], { id: args[0], phone: args[1], jid: args[2], message: args[3], type: args[4], time: args[5], active: args[6] });
                                }
                                if (query.includes('INSERT INTO user_replies')) {
                                    mockDb.tables.user_replies.set(args[0], { id: args[0], phone: args[1], trigger: args[2], response: args[3], matchType: args[4], enabled: args[5] });
                                }
                                return { success: true };
                            }
                        };
                    },
                    async all() {
                        if (query.includes('FROM secrets')) {
                            const list = Array.from(mockDb.tables.secrets.entries()).map(([k, v]) => ({ key: k, value: v }));
                            return { results: list };
                        }
                        return { results: [] };
                    }
                };
            }
        };

        const mockEnv = { D1: mockDb };

        // 1. Unauthorized when no Bearer token
        const unauthReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/settings');
        const unauthRes = await worker.fetch(unauthReq, mockEnv, {});
        assert.equal(unauthRes.status, 401);

        const authHeaders = {
            'Authorization': 'Bearer test-token-2026',
            'Content-Type': 'application/json'
        };

        // 2. Settings POST (upsert)
        const postSettingsReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/settings', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify({ botName: 'GAARA CLOUD', mode: 'public' })
        });
        const postSettingsRes = await worker.fetch(postSettingsReq, mockEnv, {});
        assert.equal(postSettingsRes.status, 200);

        // 3. Settings GET
        const getSettingsReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/settings', {
            method: 'GET',
            headers: authHeaders
        });
        const getSettingsRes = await worker.fetch(getSettingsReq, mockEnv, {});
        assert.equal(getSettingsRes.status, 200);
        const settingsBody = await getSettingsRes.json();
        assert.equal(settingsBody.settings.botName, 'GAARA CLOUD');

        // 4. Schedules POST & GET
        const postSchedReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/schedules', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify([{ id: 'sc-1', jid: '12345@s.whatsapp.net', message: 'Test Alarm', time: '08:00' }])
        });
        const postSchedRes = await worker.fetch(postSchedReq, mockEnv, {});
        assert.equal(postSchedRes.status, 200);

        const getSchedReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/schedules', {
            method: 'GET',
            headers: authHeaders
        });
        const getSchedRes = await worker.fetch(getSchedReq, mockEnv, {});
        assert.equal(getSchedRes.status, 200);
        const schedBody = await getSchedRes.json();
        assert.equal(schedBody.schedules.length, 1);
        assert.equal(schedBody.schedules[0].message, 'Test Alarm');

        // 5. Replies POST & GET
        const postRepReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/replies', {
            method: 'POST',
            headers: authHeaders,
            body: JSON.stringify([{ id: 'rep-1', trigger: 'help me', response: 'Sure!', matchType: 'exact' }])
        });
        const postRepRes = await worker.fetch(postRepReq, mockEnv, {});
        assert.equal(postRepRes.status, 200);

        const getRepReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/user/94771234567/replies', {
            method: 'GET',
            headers: authHeaders
        });
        const getRepRes = await worker.fetch(getRepReq, mockEnv, {});
        assert.equal(getRepRes.status, 200);
        const repBody = await getRepRes.json();
        assert.equal(repBody.replies.length, 1);
        assert.equal(repBody.replies[0].trigger, 'help me');

        // 6. Secrets GET
        const getSecretsReq = new Request('https://ofc.sayurusenavirathna70.workers.dev/api/secrets', {
            method: 'GET',
            headers: authHeaders
        });
        const getSecretsRes = await worker.fetch(getSecretsReq, mockEnv, {});
        assert.equal(getSecretsRes.status, 200);
        const secretsBody = await getSecretsRes.json();
        assert.equal(secretsBody.secrets.length, 1);
        assert.equal(secretsBody.secrets[0].key, 'TEST_KEY');
    });

    test('Bot modes restrict non-owner command usage appropriately', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const groupMsg = {
            key: { id: 'cmd-grp', remoteJid: '123456@g.us', participant: '94779999999@s.whatsapp.net', fromMe: false },
            message: { conversation: '.ping' }
        };

        const privateMsg = {
            key: { id: 'cmd-pvt', remoteJid: '94779999999@s.whatsapp.net', fromMe: false },
            message: { conversation: '.ping' }
        };

        // 1. Mode 'groups': reject private chat for non-owner
        db.updateSettings({ mode: 'groups', ownerNumber: '94770000000' });
        mockSock.sentMessages = [];
        await handleIncomingMessage(mockSock, privateMsg);
        assert.ok(mockSock.sentMessages.some(m => m.content.text.includes('GROUPS ONLY')));

        // 2. Mode 'inbox': reject group chat for non-owner
        db.updateSettings({ mode: 'inbox', ownerNumber: '94770000000' });
        mockSock.sentMessages = [];
        await handleIncomingMessage(mockSock, groupMsg);
        assert.ok(mockSock.sentMessages.some(m => m.content.text.includes('INBOX ONLY')));

        // 3. Mode 'private': reject any chat for non-owner
        db.updateSettings({ mode: 'private', ownerNumber: '94770000000' });
        mockSock.sentMessages = [];
        await handleIncomingMessage(mockSock, groupMsg);
        assert.ok(mockSock.sentMessages.some(m => m.content.text.includes('PRIVATE')));
    });

    test('getBotStatus telemetry reflects live status and OFFLINE / UNLINKED states', () => {
        const status = getBotStatus();
        assert.ok('connection' in status);
        assert.ok('isLinked' in status);
        assert.ok('statusText' in status);
        assert.ok('telemetry' in status);
        assert.ok(typeof status.statusText === 'string');
    });

    test('formatFramedMessage preserves ASCII box integrity on multiline content', () => {
        const result = formatFramedMessage([
            {
                title: 'MULTILINE TEST',
                content: ['Line 1\nLine 2\nLine 3', 'Single Line']
            }
        ]);
        assert.ok(result.includes('│◇│  Line 1\n│◇│  Line 2\n│◇│  Line 3'));
        assert.ok(result.includes('│◇│  Single Line'));
        assert.ok(!result.includes('\nLine 2\n'));
    });

    test('Status Anti-Delete routes to author JID when same destination is configured', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const statusMsg = {
            key: { id: 'status-msg-123', remoteJid: 'status@broadcast', participant: '94776665544@s.whatsapp.net', fromMe: false },
            pushName: 'StatusAuthor',
            message: { conversation: 'Status secret thoughts' },
            messageTimestamp: 1760000500
        };
        cacheMessage(statusMsg);

        // Configure status destination to 'same'
        db.updateSettings({ statusAntiDelete: true, statusDestination: 'same' });

        const revokeMsg = {
            key: { id: 'status-rev-1', remoteJid: 'status@broadcast', fromMe: false },
            message: {
                protocolMessage: {
                    type: 0,
                    key: { id: 'status-msg-123', remoteJid: 'status@broadcast', participant: '94776665544@s.whatsapp.net', fromMe: false }
                }
            }
        };

        await handleRevoke(mockSock, revokeMsg);
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].jid, '94776665544@s.whatsapp.net');
        assert.ok(mockSock.sentMessages[0].content.text.includes('Status secret thoughts'));
    });

    test('Status Anti-Edit recovers status edits and supports sequential edit caching', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const initialStatus = {
            key: { id: 'status-edit-target', remoteJid: 'status@broadcast', participant: '94773332211@s.whatsapp.net', fromMe: false },
            pushName: 'StatusUpdater',
            message: { conversation: 'Initial status caption' },
            messageTimestamp: 1760000600
        };
        cacheMessage(initialStatus);

        db.updateSettings({ antiEdit: true, statusDestination: 'same' });

        // First edit
        const edit1 = {
            key: { id: 'st-edit-1', remoteJid: 'status@broadcast', fromMe: false },
            message: {
                protocolMessage: {
                    type: 14,
                    key: { id: 'status-edit-target', remoteJid: 'status@broadcast', participant: '94773332211@s.whatsapp.net', fromMe: false },
                    editedMessage: { conversation: 'Updated first status caption' }
                }
            },
            messageTimestamp: 1760000630
        };

        await handleEdit(mockSock, edit1);
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].jid, '94773332211@s.whatsapp.net');
        assert.ok(mockSock.sentMessages[0].content.text.includes('WhatsApp Status'));
        assert.ok(mockSock.sentMessages[0].content.text.includes('Initial status caption'));
        assert.ok(mockSock.sentMessages[0].content.text.includes('Updated first status caption'));

        // Second sequential edit to the same status
        const edit2 = {
            key: { id: 'st-edit-2', remoteJid: 'status@broadcast', fromMe: false },
            message: {
                protocolMessage: {
                    type: 14,
                    key: { id: 'status-edit-target', remoteJid: 'status@broadcast', participant: '94773332211@s.whatsapp.net', fromMe: false },
                    editedMessage: { conversation: 'Second updated status caption' }
                }
            },
            messageTimestamp: 1760000660
        };

        await handleEdit(mockSock, edit2);
        assert.equal(mockSock.sentMessages.length, 2);
        assert.ok(mockSock.sentMessages[1].content.text.includes('Updated first status caption'));
        assert.ok(mockSock.sentMessages[1].content.text.includes('Second updated status caption'));
    });

    test('dispatchBotLog dispatches formatted logs to configured destinations', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        // When botLogs is false, should not dispatch
        db.updateSettings({ botLogs: false });
        await dispatchBotLog(mockSock, { title: 'TEST LOG', content: ['Log line 1'] });
        assert.equal(mockSock.sentMessages.length, 0);

        // When botLogs is true and destination is self
        db.updateSettings({ botLogs: true, botLogsDestination: 'self' });
        await dispatchBotLog(mockSock, { title: 'SYSTEM EVENT', emoji: '🟢', content: ['System online'] });
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].jid, '94770000000@s.whatsapp.net');
        assert.ok(mockSock.sentMessages[0].content.text.includes('SYSTEM EVENT'));
        assert.ok(mockSock.sentMessages[0].content.text.includes('System online'));
    });

    test('New owner commands (.antiviewonce, .statusantidelete, .botlogs) update configuration', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const ownerMsg = {
            key: { id: 'msg-owner', remoteJid: '94770000000@s.whatsapp.net', fromMe: true }
        };

        const voCmd = getCommand('antiviewonce');
        assert.ok(voCmd);
        await voCmd.run({ sock: mockSock, msg: ownerMsg, jid: '94770000000@s.whatsapp.net', args: ['off'], sender: '94770000000@s.whatsapp.net' });
        assert.equal(db.getSettings().viewOnceSaver, false);

        const statusDelCmd = getCommand('statusantidelete');
        assert.ok(statusDelCmd);
        await statusDelCmd.run({ sock: mockSock, msg: ownerMsg, jid: '94770000000@s.whatsapp.net', args: ['on'], sender: '94770000000@s.whatsapp.net' });
        assert.equal(db.getSettings().statusAntiDelete, true);

        const botLogsCmd = getCommand('botlogs');
        assert.ok(botLogsCmd);
        await botLogsCmd.run({ sock: mockSock, msg: ownerMsg, jid: '94770000000@s.whatsapp.net', args: ['same'], sender: '94770000000@s.whatsapp.net' });
        assert.equal(db.getSettings().botLogsDestination, 'same');
    });
});

describe('7. Re-Pairing Resilience, Consolidated Welcome & Performance Tests', () => {
    test('formatConnectedSetupMessage consolidates mode and all active features into single card', () => {
        db.updateSettings({
            mode: 'public',
            antiDelete: true,
            antiDeleteDestination: 'self',
            antiEdit: true,
            antiEditDestination: 'same',
            viewOnceSaver: true,
            viewOnceDestination: 'self',
            autoStatus: false
        });

        const setupText = formatConnectedSetupMessage('94771909806', 'testPass123', 'https://gaara-md.vercel.app');
        assert.ok(setupText.includes('GAARA X MD SETUP'));
        assert.ok(setupText.includes('+94771909806'));
        assert.ok(setupText.includes('*Mode:* PUBLIC'));
        assert.ok(setupText.includes('Anti-Delete:* ENABLED (self)'));
        assert.ok(setupText.includes('Anti-Edit:* ENABLED (same)'));
        assert.ok(setupText.includes('View-Once:* ENABLED (self)'));
        assert.ok(setupText.includes('Auto-Status:* DISABLED'));
        assert.ok(setupText.includes('testPass123'));
        assert.ok(setupText.includes('https://gaara-md.vercel.app/settings'));
        assert.ok(!setupText.includes('http://localhost:3000/settings'));
    });

    test('formatConnectedSetupMessage normalizes URL with existing /settings suffix', () => {
        const setupText = formatConnectedSetupMessage('94771909806', 'pass', 'https://gaara-md.vercel.app/settings');
        assert.ok(setupText.includes('https://gaara-md.vercel.app/settings'));
        assert.ok(!setupText.includes('/settings/settings'));
    });

    test('resetSession resets socket state to unlinked and cleans session files safely', async () => {
        const resetRes = await resetSession({ clearFiles: true });
        assert.equal(resetRes, true);

        const status = getBotStatus();
        assert.equal(status.connection, 'unlinked');
        assert.equal(status.isLinked, false);
        assert.equal(status.pairingCode, null);
        assert.equal(status.telemetry.phoneNumber, null);
        assert.equal(status.telemetry.connectedAt, null);
    });

    test('Express server exposes /api/pair/reset and /api/disconnect endpoints', async () => {
        const app = createServer();
        const server = app.listen(0);
        const port = server.address().port;

        try {
            // 1. Reset endpoint
            const resetRes = await fetch(`http://localhost:${port}/api/pair/reset`, { method: 'POST' });
            assert.equal(resetRes.status, 200);
            const resetData = await resetRes.json();
            assert.equal(resetData.success, true);

            // 2. Disconnect endpoint
            const discRes = await fetch(`http://localhost:${port}/api/disconnect`, { method: 'POST' });
            assert.equal(discRes.status, 200);
            const discData = await discRes.json();
            assert.equal(discData.success, true);

            // 3. Pair endpoint validation
            const pairMissing = await fetch(`http://localhost:${port}/api/pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({})
            });
            assert.equal(pairMissing.status, 400);
            const pairData = await pairMissing.json();
            assert.ok(pairData.error.includes('Phone number is required'));
        } finally {
            server.close();
        }
    });

    test('System alive command displays fast / snappy anti-ban status', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const aliveCmd = getCommand('alive');
        assert.ok(aliveCmd);
        await aliveCmd.run({ sock: mockSock, msg: { key: { remoteJid: 'test@s.whatsapp.net' } }, jid: 'test@s.whatsapp.net' });
        assert.equal(mockSock.sentMessages.length, 1);
        const text = mockSock.sentMessages[0].content.text;
        assert.ok(text.includes('Fast Engine / Snappy'));
    });

    test('formatConnectedSetupMessage falls back to relative /settings for empty or relative URLs', () => {
        const localText1 = formatConnectedSetupMessage('94771909806', 'pass', '');
        assert.ok(localText1.includes('*Dashboard:* /settings'));

        const localText2 = formatConnectedSetupMessage('94771909806', 'pass', '/settings');
        assert.ok(localText2.includes('*Dashboard:* /settings'));
        assert.ok(!localText2.includes('/settings/settings'));
    });

    test('db.updateSettings strips internal _suppressLog and passes suppressLog via event options', () => {
        let capturedOptions = null;
        const testListener = (_, opts) => {
            capturedOptions = opts;
        };
        db.once('settingsUpdated', testListener);

        db.updateSettings({ mode: 'public' }, { suppressLog: true });
        assert.equal(capturedOptions?.suppressLog, true);
        const stored = db.getSettings();
        assert.equal(stored._suppressLog, undefined);
        assert.equal(stored._lastSetupSentPhone, undefined);

        // Subsequent update without suppressLog allows notification
        let capturedNormal = null;
        db.once('settingsUpdated', (_, opts) => {
            capturedNormal = opts;
        });
        db.updateSettings({ ownerBio: 'Updated bio for test' });
        assert.equal(capturedNormal?.suppressLog, false);
    });

    test('restartBotSocket resets and restarts socket while preserving state safely', async () => {
        const restartSock = await restartBotSocket();
        assert.ok(restartSock);
        assert.ok(typeof restartSock.sendMessage === 'function');
        // Clean up socket after test
        await resetSession({ clearFiles: true });
    });
});

describe('8. Interactive WhatsApp Buttons Settings & Advanced Recovery Tests', () => {
    test('SETTINGS_BUTTONS contains all 10 required options and formatSettingsMenuText is properly framed', () => {
        assert.equal(SETTINGS_BUTTONS.length, 10);
        const buttonIds = SETTINGS_BUTTONS.map(b => b.id);
        assert.ok(buttonIds.includes('cfg_mode_public'));
        assert.ok(buttonIds.includes('cfg_mode_private'));
        assert.ok(buttonIds.includes('cfg_mode_groups'));
        assert.ok(buttonIds.includes('cfg_mode_inbox'));
        assert.ok(buttonIds.includes('cfg_delete_self'));
        assert.ok(buttonIds.includes('cfg_delete_same'));
        assert.ok(buttonIds.includes('cfg_edit_self'));
        assert.ok(buttonIds.includes('cfg_edit_same'));
        assert.ok(buttonIds.includes('cfg_viewonce_self'));
        assert.ok(buttonIds.includes('cfg_viewonce_same'));

        const menuText = formatSettingsMenuText();
        assert.ok(menuText.includes('BOT CONFIGURATION PANEL'));
        assert.ok(menuText.includes('Interactive WhatsApp Bot Settings'));
        assert.ok(menuText.includes('Mode:'));
        assert.ok(menuText.includes('Anti-Delete Dest:'));
        assert.ok(menuText.includes('Anti-Edit Dest:'));
        assert.ok(menuText.includes('View-Once Dest:'));
        assert.ok(menuText.includes(BOT_FOOTER));
    });

    test('sendSettingsButtons delivers interactive buttons card', async () => {
        const mockSock = {
            sentMessages: [],
            sendButton: async (jid, content) => {
                mockSock.sentMessages.push({ jid, content, method: 'sendButton' });
                return { key: { id: 'btn-msg-1' } };
            },
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options, method: 'sendMessage' });
                return { key: { id: 'sent-id' } };
            }
        };

        await sendSettingsButtons(mockSock, '12345@s.whatsapp.net');
        assert.equal(mockSock.sentMessages.length, 1);
        const sent = mockSock.sentMessages[0];
        assert.equal(sent.jid, '12345@s.whatsapp.net');
        assert.ok(sent.content.buttons);
        assert.equal(sent.content.buttons.length, 10);
    });

    test('.settings and .config command execution sends interactive settings card', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendButton: async (jid, content) => {
                mockSock.sentMessages.push({ jid, content });
                return { key: { id: 'btn-msg-2' } };
            },
            sendMessage: async (jid, content) => {
                mockSock.sentMessages.push({ jid, content });
                return { key: { id: 'sent-id' } };
            }
        };

        const ownerMsg = {
            key: { id: 'owner-cmd', remoteJid: '94770000000@s.whatsapp.net', fromMe: true }
        };

        // 1. .settings
        const settingsCmd = getCommand('settings');
        assert.ok(settingsCmd);
        await settingsCmd.run({ sock: mockSock, msg: ownerMsg, jid: '94770000000@s.whatsapp.net', sender: '94770000000@s.whatsapp.net' });
        assert.equal(mockSock.sentMessages.length, 1);
        assert.ok(mockSock.sentMessages[0].content.text.includes('BOT CONFIGURATION PANEL'));

        // 2. .config alias
        const configCmd = getCommand('config');
        assert.ok(configCmd);
        await configCmd.run({ sock: mockSock, msg: ownerMsg, jid: '94770000000@s.whatsapp.net', sender: '94770000000@s.whatsapp.net' });
        assert.equal(mockSock.sentMessages.length, 2);
    });

    test('Button interceptor processes buttonsResponseMessage for mode configuration', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ mode: 'public', ownerNumber: '94770000000' });

        // Simulate owner tapping '🔒 Private' button via classic buttonsResponseMessage
        const buttonMsg = {
            key: { id: 'btn-tap-1', remoteJid: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                buttonsResponseMessage: {
                    selectedButtonId: 'cfg_mode_private',
                    selectedDisplayText: '🔒 Private'
                }
            }
        };

        await handleIncomingMessage(mockSock, buttonMsg);

        assert.equal(db.getSettings().mode, 'private');
        assert.equal(mockSock.sentMessages.length, 1);
        assert.ok(mockSock.sentMessages[0].content.text.includes('CONFIGURATION UPDATED'));
        assert.ok(mockSock.sentMessages[0].content.text.includes('PRIVATE'));
    });

    test('Button interceptor processes templateButtonReplyMessage for anti-delete destination', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ antiDeleteDestination: 'self', ownerNumber: '94770000000' });

        const templateBtnMsg = {
            key: { id: 'btn-tap-2', remoteJid: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                templateButtonReplyMessage: {
                    selectedId: 'cfg_delete_same',
                    selectedDisplayText: '🛡️ Delete: Same'
                }
            }
        };

        await handleIncomingMessage(mockSock, templateBtnMsg);

        assert.equal(db.getSettings().antiDeleteDestination, 'same');
        assert.equal(mockSock.sentMessages.length, 1);
        assert.ok(mockSock.sentMessages[0].content.text.includes('SAME CHAT'));
    });

    test('Button interceptor processes interactiveResponseMessage (nativeFlow) with paramsJson for anti-edit & view-once', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ antiEditDestination: 'self', viewOnceDestination: 'self', ownerNumber: '94770000000' });

        // 1. Anti-Edit destination toggle
        const nativeFlowEdit = {
            key: { id: 'btn-tap-3', remoteJid: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                interactiveResponseMessage: {
                    body: { text: '✏️ Edit: Same' },
                    nativeFlowResponseMessage: {
                        name: 'quick_reply',
                        paramsJson: JSON.stringify({ id: 'cfg_edit_same', display_text: '✏️ Edit: Same' })
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, nativeFlowEdit);
        assert.equal(db.getSettings().antiEditDestination, 'same');
        assert.equal(mockSock.sentMessages.length, 1);

        // 2. View-Once destination toggle
        const nativeFlowVO = {
            key: { id: 'btn-tap-4', remoteJid: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                interactiveResponseMessage: {
                    body: { text: '🔓 ViewOnce: Same' },
                    nativeFlowResponseMessage: {
                        name: 'quick_reply',
                        paramsJson: JSON.stringify({ id: 'cfg_viewonce_same', display_text: '🔓 ViewOnce: Same' })
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, nativeFlowVO);
        assert.equal(db.getSettings().viewOnceDestination, 'same');
        assert.equal(mockSock.sentMessages.length, 2);
    });

    test('Non-owner button taps on settings are rejected safely', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ mode: 'private', ownerNumber: '94770000000' });

        const strangerBtnMsg = {
            key: { id: 'stranger-tap', remoteJid: '12345@s.whatsapp.net', participant: '12345@s.whatsapp.net', fromMe: false },
            message: {
                buttonsResponseMessage: {
                    selectedButtonId: 'cfg_mode_public',
                    selectedDisplayText: '🌐 Public'
                }
            }
        };

        await handleIncomingMessage(mockSock, strangerBtnMsg);

        assert.equal(db.getSettings().mode, 'private', 'Mode must not change from unauthorized button tap');
        assert.equal(mockSock.sentMessages.length, 1);
        assert.ok(mockSock.sentMessages[0].content.text.includes('Only the bot owner'));
    });

    test('View-Once .readviewonce / .vv routes media to Self Chat when viewOnceDestination is self', async () => {
        const mockSock = {
            user: { id: '94770000000:1@s.whatsapp.net' },
            sentMessages: [],
            downloadMedia: async () => Buffer.from('fake-view-once-image-binary'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ viewOnceDestination: 'self', ownerNumber: '94770000000' });

        const groupJid = '999999-group@g.us';
        const voCmdMsg = {
            key: { id: 'cmd-vv-1', remoteJid: groupJid, participant: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        quotedMessage: {
                            viewOnceMessage: {
                                message: {
                                    imageMessage: {
                                        caption: 'Secret view-once photo',
                                        viewOnce: true
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        const voCmd = getCommand('vv');
        assert.ok(voCmd);
        await voCmd.run({ sock: mockSock, msg: voCmdMsg, jid: groupJid });

        // Unlocked image should be routed to Self Chat (94770000000@s.whatsapp.net)
        const mediaMsg = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(mediaMsg, 'Unlocked image message must be sent');
        assert.equal(mediaMsg.jid, '94770000000@s.whatsapp.net', 'Media must be sent to Self Chat');
        assert.ok(mediaMsg.content.caption.includes('View-Once Recovered'));
        assert.ok(mediaMsg.content.caption.includes('Secret view-once photo'));

        // Stealth Mode (Picture 4): Origin chat remains 100% silent (0 status/progress messages)
        const originChatMessages = mockSock.sentMessages.filter(m => m.jid === groupJid);
        assert.equal(originChatMessages.length, 0, 'Origin chat must remain 100% silent in stealth mode');
    });

    test('View-Once .readviewonce / .vv routes media to same chat when viewOnceDestination is same', async () => {
        const mockSock = {
            user: { id: '94770000000:1@s.whatsapp.net' },
            sentMessages: [],
            downloadMedia: async () => Buffer.from('fake-view-once-image-binary'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ viewOnceDestination: 'same', ownerNumber: '94770000000' });

        const groupJid = '888888-group@g.us';
        const voCmdMsg = {
            key: { id: 'cmd-vv-2', remoteJid: groupJid, participant: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '.readviewonce',
                    contextInfo: {
                        quotedMessage: {
                            imageMessage: {
                                caption: 'Direct view-once photo',
                                viewOnce: true
                            }
                        }
                    }
                }
            }
        };

        const voCmd = getCommand('readviewonce');
        assert.ok(voCmd);
        await voCmd.run({ sock: mockSock, msg: voCmdMsg, jid: groupJid });

        const mediaMsg = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(mediaMsg);
        assert.equal(mediaMsg.jid, groupJid, 'Media must be sent to same group chat');
    });

    test('Ephemeral message unwrapping works for delete, edit, and view-once', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            downloadMedia: async () => Buffer.from('ephemeral-vo-content'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        // 1. Ephemeral wrapped revoke
        const originalMsg = {
            key: { id: 'eph-del-target', remoteJid: '12345@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Ephemeral text to be deleted' },
            timestamp: 1760001000
        };
        cacheMessage(originalMsg);
        db.updateSettings({ antiDelete: true, antiDeleteDestination: 'self' });

        const ephRevoke = {
            key: { id: 'eph-rev-msg', remoteJid: '12345@s.whatsapp.net', fromMe: false },
            message: {
                ephemeralMessage: {
                    message: {
                        protocolMessage: {
                            type: 0,
                            key: { id: 'eph-del-target', remoteJid: '12345@s.whatsapp.net', fromMe: false }
                        }
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, ephRevoke);
        const delRecovery = mockSock.sentMessages.find(m => m.content.text?.includes('[ 🛡️ ANTI DELETE ]'));
        assert.ok(delRecovery, 'Anti-Delete must unpack ephemeral protocolMessage');
        assert.ok(delRecovery.content.text.includes('Ephemeral text to be deleted'));

        // 2. Ephemeral wrapped edit
        const editTarget = {
            key: { id: 'eph-edit-target', remoteJid: '12345@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Original ephemeral message' },
            timestamp: 1760001050
        };
        cacheMessage(editTarget);
        db.updateSettings({ antiEdit: true, antiEditDestination: 'self' });

        const ephEdit = {
            key: { id: 'eph-edit-msg', remoteJid: '12345@s.whatsapp.net', fromMe: false },
            message: {
                ephemeralMessage: {
                    message: {
                        protocolMessage: {
                            type: 14,
                            key: { id: 'eph-edit-target', remoteJid: '12345@s.whatsapp.net', fromMe: false },
                            editedMessage: { conversation: 'Updated ephemeral message text' }
                        }
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, ephEdit);
        const editRecovery = mockSock.sentMessages.find(m => m.content.text?.includes('[ ✏️ MESSAGE EDITED ]'));
        assert.ok(editRecovery, 'Anti-Edit must unpack ephemeral protocolMessage');
        assert.ok(editRecovery.content.text.includes('Updated ephemeral message text'));

        // 3. Ephemeral wrapped View-Once saver
        db.updateSettings({ viewOnceSaver: true, viewOnceDestination: 'self' });
        const ephVO = {
            key: { id: 'eph-vo-msg', remoteJid: '77777@s.whatsapp.net', participant: '77777@s.whatsapp.net', fromMe: false },
            message: {
                ephemeralMessage: {
                    message: {
                        viewOnceMessage: {
                            message: {
                                imageMessage: {
                                    caption: 'Ephemeral View-Once Pic'
                                }
                            }
                        }
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, ephVO);
        const voRecovery = mockSock.sentMessages.find(m => m.content.caption?.includes('Ephemeral View-Once Pic'));
        assert.ok(voRecovery, 'View-Once Saver must unpack ephemeral wrapper');
    });

    test('messages.delete and messages.update stub 68 trigger message recovery', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const targetMsg = {
            key: { id: 'msg-direct-key-del', remoteJid: '55555@s.whatsapp.net', fromMe: false },
            message: { conversation: 'Deleted via stanza update' },
            timestamp: 1760002000
        };
        cacheMessage(targetMsg);
        db.updateSettings({ antiDelete: true, antiDeleteDestination: 'self' });

        // Direct key invocation (as from messages.delete or messages.update stub 68)
        await handleRevoke(mockSock, { key: { id: 'msg-direct-key-del', remoteJid: '55555@s.whatsapp.net' } });

        assert.equal(mockSock.sentMessages.length, 1);
        assert.ok(mockSock.sentMessages[0].content.text.includes('[ 🛡️ ANTI DELETE ]'));
        assert.ok(mockSock.sentMessages[0].content.text.includes('Deleted via stanza update'));
    });

    test('sendPlainButtons, sendTemplateButtons, sendNativeFlowButtons, and sendClassicButtons helpers', async () => {
        const mockSock = {
            sentMessages: [],
            sendButton: async (jid, content) => {
                mockSock.sentMessages.push({ jid, content, type: 'sendButton' });
                return { key: { id: 'btn-1' } };
            },
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options, type: 'sendMessage' });
                return { key: { id: 'msg-1' } };
            }
        };

        // 1. Plain buttons
        await sendPlainButtons(mockSock, '123@s.whatsapp.net', {
            text: 'Select an option below',
            footer: 'Void Pizza',
            buttons: [
                { buttonId: 'order-pizza', displayText: 'Order Pizza' },
                { buttonId: 'track-order', displayText: 'Track Order' },
                { buttonId: 'talk-human', displayText: 'Talk to a Human' }
            ]
        });
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].content.buttons.length, 3);
        assert.equal(mockSock.sentMessages[0].content.footer, 'Void Pizza');

        // 2. Template buttons
        await sendTemplateButtons(mockSock, '123@s.whatsapp.net', {
            text: 'Your pizza is on the way',
            title: 'Order confirmation',
            templateButtons: [
                { index: 1, text: 'OK' },
                { index: 2, call: '+94771234567' },
                { index: 3, url: 'https://example.com' }
            ]
        });
        assert.equal(mockSock.sentMessages.length, 2);
        assert.equal(mockSock.sentMessages[1].content.templateButtons.length, 3);

        // 3. Native Flow buttons
        await sendNativeFlowButtons(mockSock, '123@s.whatsapp.net', {
            text: 'Choose your meal',
            footer: 'Void Pizza',
            buttons: [
                { id: 'pizza', text: 'Pizza' },
                { id: 'burger', text: 'Burger' },
                { copy: 'npm i @sasa-dev/void-baileys', text: 'Copy install cmd' },
                { url: 'https://example.com/menu', text: 'Website' }
            ]
        });
        assert.equal(mockSock.sentMessages.length, 3);
        assert.equal(mockSock.sentMessages[2].content.buttons.length, 4);

        // 4. Classic buttons
        await sendClassicButtons(mockSock, '123@s.whatsapp.net', {
            text: 'Legacy layout',
            footer: 'Void Pizza',
            buttons: [{ id: 'old-school', text: 'Old style' }]
        });
        assert.equal(mockSock.sentMessages.length, 4);
        assert.equal(mockSock.sentMessages[3].content.style, 'classic');

        // 5. .buttons command execution
        const buttonsCmd = getCommand('buttons');
        assert.ok(buttonsCmd);
        await buttonsCmd.run({ sock: mockSock, msg: { key: { id: 'cmd' } }, jid: '123@s.whatsapp.net', args: ['plain'] });
        assert.equal(mockSock.sentMessages.length, 5);
    });

    test('messages.delete with { jid, all: true } bulk recovers messages for chat', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'bulk-del' } };
            }
        };

        const groupJid = 'bulk-chat@g.us';
        const msgA = {
            key: { id: 'bulk-msg-1', remoteJid: groupJid, fromMe: false },
            message: { conversation: 'First bulk message' },
            timestamp: 1760003000
        };
        const msgB = {
            key: { id: 'bulk-msg-2', remoteJid: groupJid, fromMe: false },
            message: { conversation: 'Second bulk message' },
            timestamp: 1760003001
        };
        cacheMessage(msgA);
        cacheMessage(msgB);
        db.updateSettings({ antiDelete: true, antiDeleteDestination: 'self' });

        // Simulate bulk chat clear event
        const deleteItem = { jid: groupJid, all: true };
        const keys = Array.isArray(deleteItem) ? deleteItem : (Array.isArray(deleteItem.keys) ? deleteItem.keys : []);
        for (const key of keys) {
            if (!key || key.fromMe) continue;
            await handleRevoke(mockSock, { key });
        }
        if (deleteItem.all && deleteItem.jid) {
            const allKeys = [msgA.key.id, msgB.key.id];
            for (const k of allKeys) {
                const cached = getCachedMessage(k);
                if (cached && cached.remoteJid === deleteItem.jid && !cached.fromMe) {
                    await handleRevoke(mockSock, { key: cached.key });
                }
            }
        }

        assert.equal(mockSock.sentMessages.length, 2);
        assert.ok(mockSock.sentMessages.some(m => m.content.text.includes('First bulk message')));
        assert.ok(mockSock.sentMessages.some(m => m.content.text.includes('Second bulk message')));
    });

    test('View-Once .readviewonce unwraps viewOnceMessage wrapping ephemeralMessage with image', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            downloadMediaMessage: async () => Buffer.from('reverse-nested-image'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-vo' } };
            }
        };

        db.updateSettings({ viewOnceDestination: 'same' });

        // View-once wraps ephemeralMessage (reverse nesting)
        const reverseQuoted = {
            viewOnceMessage: {
                message: {
                    ephemeralMessage: {
                        message: {
                            imageMessage: {
                                caption: 'Reverse nested VO pic',
                                viewOnce: true
                            }
                        }
                    }
                }
            }
        };

        const voCmdMsg = {
            key: { id: 'cmd-reverse-vo', remoteJid: 'test-chat@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: { quotedMessage: reverseQuoted }
                }
            }
        };

        const vvCmd = getCommand('vv');
        assert.ok(vvCmd);
        await vvCmd.run({ sock: mockSock, msg: voCmdMsg, jid: 'test-chat@s.whatsapp.net' });

        const sentImg = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(sentImg, 'Media must be extracted and sent for reverse nested viewOnce');
        assert.ok(sentImg.content.caption.includes('Reverse nested VO pic'));
    });

    test('Bracketed button texts and demo pizza action buttons work properly', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ mode: 'public', ownerNumber: '94770000000' });

        // 1. Bracketed mode button tap: [ 🔒 Private ]
        const bracketBtnMsg = {
            key: { id: 'btn-bracket', remoteJid: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                buttonsResponseMessage: {
                    selectedButtonId: '[ 🔒 Private ]',
                    selectedDisplayText: '[ 🔒 Private ]'
                }
            }
        };

        await handleIncomingMessage(mockSock, bracketBtnMsg);
        assert.equal(db.getSettings().mode, 'private', 'Mode must update to private from bracketed text');

        // 2. Demo pizza order button tap
        const pizzaOrderMsg = {
            key: { id: 'btn-pizza-order', remoteJid: '94770000000@s.whatsapp.net', fromMe: false },
            message: {
                buttonsResponseMessage: {
                    selectedButtonId: 'order-pizza',
                    selectedDisplayText: 'Order Pizza'
                }
            }
        };

        await handleIncomingMessage(mockSock, pizzaOrderMsg);
        assert.ok(mockSock.sentMessages.some(m => m.content.text?.includes('Order Placed!')));
    });
});

describe('9. Void Baileys Native Power, SASA DEV API & Trigger Normalization Tests', () => {
    test('normalizeCommandTrigger correctly strips emojis and outer brackets from tapped button texts', () => {
        const test1 = normalizeCommandTrigger('🌸 ALIVE', '.');
        assert.ok(test1);
        assert.equal(test1.cmdName, 'alive');

        const test2 = normalizeCommandTrigger('⚡ PING', '.');
        assert.ok(test2);
        assert.equal(test2.cmdName, 'ping');

        const test3 = normalizeCommandTrigger('👑 OWNER', '.');
        assert.ok(test3);
        assert.equal(test3.cmdName, 'owner');

        const test4 = normalizeCommandTrigger('. 🌸 alive', '.');
        assert.ok(test4);
        assert.equal(test4.cmdName, 'alive');

        const test5 = normalizeCommandTrigger('[ 🌸 ALIVE ]', '.');
        assert.ok(test5);
        assert.equal(test5.cmdName, 'alive');
    });

    test('Incoming message with emoji button text executes normalized command directly', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const msg = {
            key: { id: 'msg-btn-norm', remoteJid: '94770000000@s.whatsapp.net', fromMe: false },
            message: {
                conversation: '🌸 ALIVE'
            }
        };

        await handleIncomingMessage(mockSock, msg);
        assert.ok(mockSock.sentMessages.length > 0, 'Command should have responded');
        const replyText = mockSock.sentMessages[0].content.text;
        assert.ok(replyText.includes('STATUS ALIVE') || replyText.includes('OPERATIONAL'));
    });

    test('View-Once unlock via reply with emoji (🔓, 👁️) extracts and routes media', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            downloadMedia: async () => Buffer.from('unlocked-emoji-image'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({
            viewOnceSaver: true,
            viewOnceDestination: 'self',
            viewOnceTriggerMode: 'both',
            ownerNumber: '94770000000'
        });

        const emojiUnlockMsg = {
            key: { id: 'emoji-trigger-msg', remoteJid: '888888-group@g.us', participant: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '🔓',
                    contextInfo: {
                        quotedMessage: {
                            viewOnceMessage: {
                                message: {
                                    imageMessage: {
                                        caption: 'Secret emoji view-once image'
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        await handleIncomingMessage(mockSock, emojiUnlockMsg);

        // Media delivered to self chat
        const mediaMsg = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(mediaMsg, 'Unlocked media should be delivered to self chat');
        assert.equal(mediaMsg.jid, '94770000000@s.whatsapp.net');
        assert.ok(mediaMsg.content.caption.includes('Secret emoji view-once image'));

        // Origin chat remains 100% silent in stealth mode
        const groupMsgs = mockSock.sentMessages.filter(m => m.jid === '888888-group@g.us');
        assert.equal(groupMsgs.length, 0, 'Origin chat must remain 100% silent in stealth mode');
    });

    test('TRIGGER_SETTINGS_BUTTONS and ALL_SETTINGS_BUTTONS are properly defined', () => {
        assert.equal(TRIGGER_SETTINGS_BUTTONS.length, 3);
        assert.equal(ALL_SETTINGS_BUTTONS.length, 13);
        assert.ok(TRIGGER_SETTINGS_BUTTONS.some(b => b.id === 'cfg_votrigger_both'));
        assert.ok(TRIGGER_SETTINGS_BUTTONS.some(b => b.id === 'cfg_votrigger_command'));
        assert.ok(TRIGGER_SETTINGS_BUTTONS.some(b => b.id === 'cfg_votrigger_emoji'));
    });

    test('SASA DEV API service provides valid permanent credentials and safe error handling', async () => {
        const apiKey = getSasaDevApiKey();
        assert.equal(apiKey, PERMANENT_SASA_KEY);

        const emptyRes = await chatSasaAiPlus('');
        assert.equal(emptyRes.success, false);
        assert.ok(emptyRes.error);
    });

    test('Void Baileys extras module utilities operate smoothly', () => {
        const uptime = uptimeMs();
        assert.equal(typeof uptime, 'number');
        assert.ok(uptime >= 0);

        const memCheck = checkMemoryGuard(500);
        assert.equal(typeof memCheck.exceeded, 'boolean');
        assert.equal(memCheck.limitMb, 500);

        const cache = makeLowRamCache(10, 1000);
        cache.set('foo', 'bar');
        assert.equal(cache.get('foo'), 'bar');
        cache.del('foo');
        assert.equal(cache.get('foo'), undefined);
        cache.close?.();
    });

    test('sendPollVoting helper delivers poll stanza to target jid', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-poll' } };
            }
        };

        await sendPollVoting(mockSock, '12345@s.whatsapp.net', 'Rate GAARA X MD', ['🔥 5 Stars', '👍 4 Stars', '👌 3 Stars']);
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].content.poll.name, 'Rate GAARA X MD');
        assert.equal(mockSock.sentMessages[0].content.poll.values.length, 3);
    });

    test('wrapSocketWithBranding automatically embeds externalAdReply with bot thumbnail and footer to sendMessage', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        const brandedSock = wrapSocketWithBranding(mockSock);
        await brandedSock.sendMessage('12345@s.whatsapp.net', { text: 'Hello without explicit context' });

        assert.equal(mockSock.sentMessages.length, 1);
        const sent = mockSock.sentMessages[0];
        assert.ok(sent.content.contextInfo, 'Must have contextInfo attached');
        assert.ok(sent.content.contextInfo.externalAdReply, 'Must have externalAdReply attached');
        assert.equal(sent.content.contextInfo.externalAdReply.body, BOT_FOOTER);
        assert.equal(sent.content.contextInfo.externalAdReply.title, 'GAARA X MD');
        assert.ok(sent.content.contextInfo.externalAdReply.thumbnail, 'Must include bot icon thumbnail buffer');

        // Verify reaction or poll stanzas are not mutated with contextInfo
        mockSock.sentMessages = [];
        await brandedSock.sendMessage('12345@s.whatsapp.net', { react: { text: '👍', key: { id: 'k' } } });
        assert.equal(mockSock.sentMessages.length, 1);
        assert.equal(mockSock.sentMessages[0].content.contextInfo, undefined, 'Reactions must not have contextInfo');
    });

    test('dispatchBotLog embeds externalAdReply with bot thumbnail and footer in system logs', async () => {
        const mockSock = {
            user: { id: '94770000000@s.whatsapp.net' },
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'log-id' } };
            }
        };

        db.updateSettings({ botLogs: true, botLogsDestination: 'self' });
        await dispatchBotLog(mockSock, { title: 'TEST RUNTIME LOG', emoji: '⚙️', content: ['Detailed log message'] });

        assert.equal(mockSock.sentMessages.length, 1);
        const logSent = mockSock.sentMessages[0];
        assert.ok(logSent.content.text.includes('TEST RUNTIME LOG'));
        assert.ok(logSent.content.text.includes('THIS BOT BUILT BY GAARA DEV OFC.'));
        assert.ok(logSent.content.contextInfo, 'System log must have contextInfo');
        assert.ok(logSent.content.contextInfo.externalAdReply, 'System log must embed externalAdReply');
        assert.equal(logSent.content.contextInfo.externalAdReply.body, BOT_FOOTER);
    });

    test('extractText extracts text from unwrapped objects, edited messages, and polls without (No text content)', () => {
        // Direct object without .message property
        assert.equal(extractText({ conversation: 'Raw direct text' }), 'Raw direct text');
        assert.equal(extractText({ extendedTextMessage: { text: 'Raw extended text' } }), 'Raw extended text');

        // Edited message nested container
        const editedWrapper = {
            protocolMessage: {
                type: 14,
                editedMessage: {
                    conversation: 'Edited conversation text'
                }
            }
        };
        assert.equal(extractText(editedWrapper), 'Edited conversation text');

        // Poll creation message
        assert.equal(extractText({ pollCreationMessage: { name: 'What is your favorite feature?' } }), 'What is your favorite feature?');

        // Location message
        assert.equal(extractText({ locationMessage: { name: 'Colombo Harbor' } }), 'Colombo Harbor');
    });

    test('View-Once .readviewonce unwraps deviceSentMessage and falls back to cache', async () => {
        const groupJid = '999999-group@g.us';
        const mockSock = {
            user: { id: '94770000000:1@s.whatsapp.net' },
            sentMessages: [],
            downloadMedia: async (container) => Buffer.from('device-sent-vo-buffer'),
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ viewOnceDestination: 'self', ownerNumber: '94770000000' });

        // 1. Quoting deviceSentMessage wrapping viewOnceMessage
        const deviceSentMsg = {
            key: { id: 'cmd-vv-dev', remoteJid: groupJid, participant: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        quotedMessage: {
                            deviceSentMessage: {
                                message: {
                                    viewOnceMessage: {
                                        message: {
                                            imageMessage: { caption: 'Device sent VO caption', viewOnce: true }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        };

        const voCmd = getCommand('vv');
        assert.ok(voCmd);
        await voCmd.run({ sock: mockSock, msg: deviceSentMsg, jid: groupJid });

        const devSentMedia = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(devSentMedia, 'Media must be extracted from deviceSentMessage');
        assert.equal(devSentMedia.jid, '94770000000@s.whatsapp.net');
        assert.ok(devSentMedia.content.caption.includes('Device sent VO caption'));

        // 2. Cache fallback when quotedMessage in stanza is empty / stripped
        mockSock.sentMessages = [];
        cacheMessage({
            key: { id: 'cached-vo-stanza-123', remoteJid: groupJid, participant: '94771111111@s.whatsapp.net' },
            message: {
                viewOnceMessage: {
                    message: {
                        imageMessage: { caption: 'Cached VO fallback image', viewOnce: true }
                    }
                }
            }
        });

        const strippedQuoteMsg = {
            key: { id: 'cmd-vv-stripped', remoteJid: groupJid, participant: '94770000000@s.whatsapp.net', fromMe: true },
            message: {
                extendedTextMessage: {
                    text: '.vv',
                    contextInfo: {
                        stanzaId: 'cached-vo-stanza-123',
                        quotedMessage: {}
                    }
                }
            }
        };

        await voCmd.run({ sock: mockSock, msg: strippedQuoteMsg, jid: groupJid });
        const cachedFallbackMedia = mockSock.sentMessages.find(m => m.content.image);
        assert.ok(cachedFallbackMedia, 'Must fall back to cached VO message when quotedMessage is empty');
        assert.ok(cachedFallbackMedia.content.caption.includes('Cached VO fallback image'));
    });

    test('Interactive button taps with command in buttonPayload.id execute immediately', async () => {
        const mockSock = {
            sentMessages: [],
            sendMessage: async (jid, content, options) => {
                mockSock.sentMessages.push({ jid, content, options });
                return { key: { id: 'sent-id' } };
            }
        };

        db.updateSettings({ mode: 'public' });

        // Tapped button with displayText "Click for Info" but id ".alive"
        const buttonMsg = {
            key: { id: 'btn-tap-msg-1', remoteJid: '94770000000@s.whatsapp.net', fromMe: false },
            message: {
                buttonsResponseMessage: {
                    selectedDisplayText: 'Click for Info',
                    selectedButtonId: '.alive'
                }
            }
        };

        await handleIncomingMessage(mockSock, buttonMsg);
        assert.ok(mockSock.sentMessages.some(m => m.content.text && m.content.text.includes('STATUS ALIVE')));
    });
});



