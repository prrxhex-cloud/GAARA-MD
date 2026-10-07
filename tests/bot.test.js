import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import db from '../config/database.js';
import { validateMessage, extractText } from '../src/utils/antiBug.js';
import { formatFramedMessage, formatConnectedSetupMessage, resolveDestinationJid } from '../src/bot/format.js';
import { cacheMessage, getCachedMessage } from '../src/bot/cache.js';
import { handleEdit } from '../src/handlers/antiEdit.js';
import { handleRevoke } from '../src/handlers/antiDelete.js';
import cfSync from '../src/services/cfSync.js';
import worker from '../worker/index.js';
import { getBotStatus, resetSession, clearSessionFiles } from '../src/bot/socket.js';
import { handleIncomingMessage } from '../src/bot/handler.js';
import { allCommandCategories, commandMap, getCommand } from '../src/commands/index.js';
import { createServer } from '../src/server/app.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../config/constants.js';
import { dispatchBotLog } from '../src/bot/loggerNotifier.js';

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
        'mode', 'antiedit', 'anticall', 'antidelete', 'autostatus', 'block', 'unblock', 'broadcast', 'setprefix', 'eval', 'exec', 'clearcache', 'restart', 'join'
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
});

