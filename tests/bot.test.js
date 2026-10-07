import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import db from '../config/database.js';
import { validateMessage, extractText } from '../src/utils/antiBug.js';
import { formatFramedMessage, formatConnectedSetupMessage } from '../src/bot/format.js';
import { allCommandCategories, commandMap, getCommand } from '../src/commands/index.js';
import { createServer } from '../src/server/app.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../config/constants.js';

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
        'mode', 'anticall', 'antidelete', 'autostatus', 'block', 'unblock', 'broadcast', 'setprefix', 'eval', 'exec', 'clearcache', 'restart', 'join'
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
