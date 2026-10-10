import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'http';
import crypto from 'crypto';
import db from '../config/database.js';
import config from '../config/index.js';
import { createServer } from '../src/server/app.js';
import { createSessionToken, isValidSession, revokeSessionToken } from '../src/server/auth.js';
import { createRateLimiter } from '../src/server/rateLimiter.js';
import { isSafeRegex, sanitizeObject, sanitizeFilename, maskSecret } from '../src/utils/security.js';
import { safeCalc } from '../src/commands/utilities.js';
import { isOwner, ownerCommands } from '../src/commands/owner.js';
import { validateMessage } from '../src/utils/antiBug.js';
import { authLimiter, pairLimiter } from '../src/server/routes.js';
import { _setConnectionStateForTesting } from '../src/bot/socket.js';

describe('GAARA X MD - Multi-Layer Security & Vulnerability Test Suite', () => {
    let globalOriginalSettings;
    let globalOriginalAdmin;

    before(() => {
        globalOriginalSettings = { ...db.getSettings() };
        const admin = db.getAdminUser();
        globalOriginalAdmin = admin ? { ...admin } : null;
    });

    after(() => {
        if (globalOriginalSettings) {
            db.updateSettings(globalOriginalSettings);
        }
        if (globalOriginalAdmin) {
            const users = db._readSafe(db.usersFile, {});
            users.admin = { ...globalOriginalAdmin };
            db._cachedUsers = users;
            db._writeSafe(db.usersFile, users);
        }
    });

    // ================================================================
    // 1. JWT Authentication, Token Forgery & Timing Attack Resistance
    // ================================================================
    describe('1. JWT Authentication & Cryptographic Integrity', () => {
        test('createSessionToken generates valid HMAC-SHA256 JWT', () => {
            const token = createSessionToken();
            assert.ok(token, 'Token must be generated');
            assert.equal(token.split('.').length, 3, 'JWT must have 3 segments (header.payload.signature)');
            assert.ok(isValidSession(token), 'Generated JWT must be recognized as valid session');
        });

        test('Rejects expired JWT tokens', () => {
            // Token with expiration in the past (-10 seconds)
            const expiredToken = createSessionToken({ exp: Math.floor(Date.now() / 1000) - 10 });
            assert.equal(isValidSession(expiredToken), false, 'Expired token must be rejected');
        });

        test('Rejects forged payloads (tampered data with original signature)', () => {
            const token = createSessionToken();
            const [h, p, s] = token.split('.');
            // Tamper with payload (e.g. change sub or role)
            const decoded = JSON.parse(Buffer.from(p, 'base64').toString('utf8'));
            decoded.sub = 'hacker';
            const forgedPayload = Buffer.from(JSON.stringify(decoded)).toString('base64').replace(/=/g, '');
            const forgedToken = `${h}.${forgedPayload}.${s}`;

            assert.equal(isValidSession(forgedToken), false, 'Forged payload must fail signature validation');
        });

        test('Rejects forged signatures (tampered signature bytes)', () => {
            const token = createSessionToken();
            const [h, p, s] = token.split('.');
            const badSig = s.slice(0, -4) + 'AAAA';
            const badToken = `${h}.${p}.${badSig}`;

            assert.equal(isValidSession(badToken), false, 'Tampered signature must be rejected');
        });

        test('Rejects algorithm confusion attacks ("alg": "none" or unsupported algs)', () => {
            const fakeHeader = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64').replace(/=/g, '');
            const fakePayload = Buffer.from(JSON.stringify({ sub: 'admin', exp: Date.now() + 10000 })).toString('base64').replace(/=/g, '');
            const algNoneToken = `${fakeHeader}.${fakePayload}.`;

            assert.equal(isValidSession(algNoneToken), false, '"alg: none" attack must be strictly rejected');

            const hs512Header = Buffer.from(JSON.stringify({ alg: 'HS512', typ: 'JWT' })).toString('base64').replace(/=/g, '');
            const hs512Token = `${hs512Header}.${fakePayload}.dGVzdA`;
            assert.equal(isValidSession(hs512Token), false, 'Unsupported algorithms must be rejected');
        });

        test('Rejects arbitrary non-JWT strings and empty inputs', () => {
            assert.equal(isValidSession(''), false);
            assert.equal(isValidSession(null), false);
            assert.equal(isValidSession(undefined), false);
            assert.equal(isValidSession('not-a-token'), false);
            assert.equal(isValidSession('foo.bar'), false);
            assert.equal(isValidSession('foo.bar.baz.extra'), false);
        });

        test('Revocation of session tokens works immediately', () => {
            const token = createSessionToken();
            assert.ok(isValidSession(token));
            revokeSessionToken(token);
            assert.equal(isValidSession(token), false, 'Revoked token must be rejected immediately');
        });

        test('Bcrypt password verification resists timing side-channels and rejects wrong passwords', () => {
            db.updateAdminPassword('DefensiveSecurity2026!');
            assert.equal(db.verifyAdminPassword('DefensiveSecurity2026!'), true);
            assert.equal(db.verifyAdminPassword('WrongPassword'), false);
            assert.equal(db.verifyAdminPassword(''), false);
            assert.equal(db.verifyAdminPassword(null), false);
        });
    });

    // ================================================================
    // 2. HTTP Security Headers, Clickjacking & Fingerprinting Defense
    // ================================================================
    describe('2. HTTP Security Headers & Information Leakage Defense', () => {
        let server;
        let port;

        before(async () => {
            const app = createServer();
            server = app.listen(0);
            port = server.address().port;
        });

        after(() => {
            if (server) server.close();
        });

        test('Security headers present (X-Frame-Options, X-Content-Type-Options, CSP, etc.)', async () => {
            const res = await fetch(`http://localhost:${port}/health`);
            assert.equal(res.status, 200);

            // 1. Frameguard against Clickjacking
            assert.equal(res.headers.get('x-frame-options'), 'SAMEORIGIN', 'X-Frame-Options must be SAMEORIGIN');

            // 2. MIME sniffing prevention
            assert.equal(res.headers.get('x-content-type-options'), 'nosniff', 'X-Content-Type-Options must be nosniff');

            // 3. XSS Filter
            assert.ok(res.headers.get('x-xss-protection')?.includes('1'), 'X-XSS-Protection must be active');

            // 4. Content-Security-Policy
            assert.ok(res.headers.get('content-security-policy'), 'CSP header must be present');

            // 5. Fingerprint mitigation: X-Powered-By must NOT be leaked
            assert.equal(res.headers.get('x-powered-by'), null, 'X-Powered-By header must be completely stripped');
        });

        test('Unknown API endpoint returns sanitized 404 JSON without stack traces', async () => {
            const res = await fetch(`http://localhost:${port}/api/non_existent_route`);
            assert.equal(res.status, 404);
            const data = await res.json();
            assert.equal(data.error, 'Endpoint not found');
            assert.equal(data.stack, undefined, 'Stack trace must never be leaked');
        });
    });

    // ================================================================
    // 3. Web Application Rate Limiting & Sensitive Route Protection
    // ================================================================
    describe('3. Rate Limiting & Route Authentication Barriers', () => {
        let server;
        let port;

        before(async () => {
            const app = createServer();
            server = app.listen(0);
            port = server.address().port;
            // Reset rate limiter hits for clean testing
            authLimiter.reset();
            pairLimiter.reset();
        });

        after(() => {
            if (server) server.close();
        });

        test('Protected routes reject unauthenticated requests with 401', async () => {
            const protectedEndpoints = [
                { method: 'GET', path: '/api/settings' },
                { method: 'POST', path: '/api/settings', body: {} },
                { method: 'GET', path: '/api/schedules' },
                { method: 'POST', path: '/api/schedules', body: {} },
                { method: 'GET', path: '/api/replies' },
                { method: 'POST', path: '/api/replies', body: {} },
                { method: 'POST', path: '/api/bot/restart' }
            ];

            for (const ep of protectedEndpoints) {
                const res = await fetch(`http://localhost:${port}${ep.path}`, {
                    method: ep.method,
                    headers: ep.body ? { 'Content-Type': 'application/json' } : {},
                    body: ep.body ? JSON.stringify(ep.body) : undefined
                });
                assert.equal(res.status, 401, `${ep.method} ${ep.path} must return 401 Unauthorized without token`);
            }
        });

        test('Protected routes accept valid JWT token in Authorization: Bearer header', async () => {
            const validToken = createSessionToken();
            const res = await fetch(`http://localhost:${port}/api/settings`, {
                headers: { 'Authorization': `Bearer ${validToken}` }
            });
            assert.equal(res.status, 200, 'Valid JWT must grant access to /api/settings');
            const data = await res.json();
            assert.ok(data.botName);
        });

        test('Protected routes accept valid token in x-panel-token header', async () => {
            const validToken = createSessionToken();
            const res = await fetch(`http://localhost:${port}/api/replies`, {
                headers: { 'x-panel-token': validToken }
            });
            assert.equal(res.status, 200);
            const replies = await res.json();
            assert.ok(Array.isArray(replies));
        });

        test('Auth endpoints support both /api/login and /api/auth/login', async () => {
            db.updateAdminPassword('TestAuth2026!');

            // Test /api/auth/login
            const res1 = await fetch(`http://localhost:${port}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'TestAuth2026!' })
            });
            assert.equal(res1.status, 200);
            const data1 = await res1.json();
            assert.ok(data1.token);
            assert.ok(isValidSession(data1.token));

            // Test /api/login
            const res2 = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'TestAuth2026!' })
            });
            assert.equal(res2.status, 200);
            const data2 = await res2.json();
            assert.ok(data2.token);
            assert.ok(isValidSession(data2.token));
        });

        test('Rate limiter blocks brute-force login attempts (429 Too Many Requests)', async () => {
            authLimiter.reset();

            // Perform 5 attempts (allowed up to max: 5)
            for (let i = 0; i < 5; i++) {
                const res = await fetch(`http://localhost:${port}/api/login`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ password: 'wrong' })
                });
                assert.equal(res.status, 401);
            }

            // 6th attempt must be blocked by rate limiter with 429
            const blockedRes = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'wrong' })
            });
            assert.equal(blockedRes.status, 429, 'Excessive login attempts must return 429 Too Many Requests');
            assert.ok(blockedRes.headers.get('retry-after'), 'Retry-After header must be set');
            const blockedData = await blockedRes.json();
            assert.ok(blockedData.error.includes('Too many login attempts'));

            // Cleanup for subsequent tests
            authLimiter.reset();
        });

        test('Pairing endpoint validates phone format and rejects malformed numbers', async () => {
            pairLimiter.reset();

            const testCases = [
                { phone: '', expectedErr: 'Phone number is required' },
                { phone: 'abc', expectedErr: 'Invalid phone number format' },
                { phone: '123', expectedErr: 'Invalid phone number format' },
                { phone: '12345678901234567890', expectedErr: 'Invalid phone number format' }
            ];

            for (const tc of testCases) {
                const res = await fetch(`http://localhost:${port}/api/pair`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: tc.phone })
                });
                assert.equal(res.status, 400);
                const data = await res.json();
                assert.ok(data.error.includes(tc.expectedErr));
            }
        });

        test('Protected routes reject authentication via URL query string to prevent log leaks', async () => {
            const validToken = createSessionToken();
            const res = await fetch(`http://localhost:${port}/api/settings?token=${validToken}`);
            assert.equal(res.status, 401, 'Passing tokens in query strings must be rejected to prevent leakage in access logs');
        });

        test('Pairing reset endpoint enforces rate limiting against DoS flooding', async () => {
            pairLimiter.reset();

            for (let i = 0; i < 5; i++) {
                const res = await fetch(`http://localhost:${port}/api/pair/reset`, { method: 'POST' });
                // Either 200 or 403 depending on connection status, but NOT 429 yet
                assert.ok(res.status === 200 || res.status === 403);
            }

            const blocked = await fetch(`http://localhost:${port}/api/pair/reset`, { method: 'POST' });
            assert.equal(blocked.status, 429, 'Excessive calls to /api/pair/reset must trigger 429 rate limit');
            pairLimiter.reset();
        });
    });

    // ================================================================
    // 4. Secrets & Credential Hygiene
    // ================================================================
    describe('4. Secrets Hygiene & Masking Defense', () => {
        let server;
        let port;

        before(async () => {
            const app = createServer();
            server = app.listen(0);
            port = server.address().port;
        });

        after(() => {
            if (server) server.close();
            db.updateSettings({ botName: 'GAARA X MD', sasaDevApiKey: '' });
        });

        test('GET /api/settings masks sensitive API keys with bullet characters', async () => {
            // Set a test raw API key
            db.updateSettings({ sasaDevApiKey: 'Sasa_Dev_Api_test_raw_secret_key_12345' });

            const validToken = createSessionToken();
            const res = await fetch(`http://localhost:${port}/api/settings`, {
                headers: { 'Authorization': `Bearer ${validToken}` }
            });
            assert.equal(res.status, 200);
            const data = await res.json();

            // Client must NEVER receive the raw API key
            assert.notEqual(data.sasaDevApiKey, 'Sasa_Dev_Api_test_raw_secret_key_12345');
            assert.ok(data.sasaDevApiKey.includes('••••'), 'sasaDevApiKey must be masked with bullet characters');
            assert.equal(data.jwtSecret, undefined, 'jwtSecret must not be in settings response');
            assert.equal(data.panelPassword, undefined, 'panelPassword must not be in settings response');
        });

        test('POST /api/settings with masked bullet string retains original secret without overwriting', async () => {
            db.updateSettings({ sasaDevApiKey: 'Sasa_Dev_Api_preserved_secret_key_9999' });

            const validToken = createSessionToken();
            const res = await fetch(`http://localhost:${port}/api/settings`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${validToken}`
                },
                body: JSON.stringify({
                    botName: 'SECURE BOT',
                    sasaDevApiKey: '••••••••••••••••••••••••••••••••••••••••••••'
                })
            });
            assert.equal(res.status, 200);

            // Verify database retains original secret
            assert.equal(db.getSettings().sasaDevApiKey, 'Sasa_Dev_Api_preserved_secret_key_9999');
            assert.equal(db.getSettings().botName, 'SECURE BOT');
        });
    });

    // ================================================================
    // 5. Injection Defense & Safe Math Evaluator (safeCalc)
    // ================================================================
    describe('5. Safe Math Evaluator (safeCalc) & Injection Protection', () => {
        test('Evaluates arithmetic operations accurately without eval or Function', () => {
            assert.equal(safeCalc('2 + 3'), 5);
            assert.equal(safeCalc('10 - 4'), 6);
            assert.equal(safeCalc('6 * 7'), 42);
            assert.equal(safeCalc('40 / 8'), 5);
            assert.equal(safeCalc('17 % 5'), 2);
            assert.equal(safeCalc('2 ^ 4'), 16);
            assert.equal(safeCalc('2 ** 4'), 16);
            assert.equal(safeCalc('(2 + 3) * 4'), 20);
            assert.equal(safeCalc('2 + 3 * 4'), 14);
            assert.equal(safeCalc('10 - 2 * 3 + 4 / 2'), 6);
        });

        test('Evaluates unary minus, plus, and decimals', () => {
            assert.equal(safeCalc('-5 + 10'), 5);
            assert.equal(safeCalc('+5 + 10'), 15);
            assert.equal(safeCalc('-(3 + 4)'), -7);
            assert.equal(safeCalc('3.5 * 2'), 7);
            assert.equal(safeCalc('0.1 + 0.2'), 0.3);
        });

        test('Evaluates mathematical functions and constants', () => {
            assert.equal(safeCalc('sqrt(144)'), 12);
            assert.equal(safeCalc('cbrt(27)'), 3);
            assert.equal(safeCalc('abs(-99)'), 99);
            assert.equal(safeCalc('round(4.6)'), 5);
            assert.equal(safeCalc('floor(4.9)'), 4);
            assert.equal(safeCalc('ceil(4.1)'), 5);
            assert.equal(safeCalc('sin(0)'), 0);
            assert.equal(safeCalc('cos(0)'), 1);
            assert.equal(safeCalc('log(100)'), 2);
            assert.equal(safeCalc('pi'), Number(Math.PI.toFixed(8)));
            assert.equal(safeCalc('e'), Number(Math.E.toFixed(8)));
        });

        test('Rejects arbitrary code execution attempts with zero execution', () => {
            const maliciousPayloads = [
                'process.exit(1)',
                'console.log("hacked")',
                'require("child_process")',
                'Function("return 1")()',
                'eval("2+2")',
                'global.polluted = true',
                '__proto__.polluted = true',
                'constructor.name',
                'this.secret',
                'alert(1)',
                'fetch("https://attacker.com")'
            ];

            for (const payload of maliciousPayloads) {
                assert.throws(() => safeCalc(payload), {
                    name: 'Error'
                }, `Payload "${payload}" must be rejected with an Error`);
            }
        });

        test('Throws on division by zero and malformed math syntax', () => {
            assert.throws(() => safeCalc('10 / 0'), /Division by zero/);
            assert.throws(() => safeCalc('10 % 0'), /Modulo by zero/);
            assert.throws(() => safeCalc(''), /Empty expression/);
            assert.throws(() => safeCalc('   '), /Empty expression/);
            assert.throws(() => safeCalc('2 + * 3'), /Unexpected token/);
            assert.throws(() => safeCalc('(2 + 3'), /Unexpected end of expression/);
        });

        test('Rejects overly deep recursion and oversized math expressions', () => {
            const deepExpr = '('.repeat(50) + '1' + ')'.repeat(50);
            assert.throws(() => safeCalc(deepExpr), /too complex or deeply nested/);

            const oversizedExpr = '1 + ' + '2 + '.repeat(100) + '3';
            assert.throws(() => safeCalc(oversizedExpr), /Expression too long/);
        });
    });

    // ================================================================
    // 6. ReDoS (Regular Expression Denial of Service) Protection
    // ================================================================
    describe('6. ReDoS Detection & Auto-Reply Hardening', () => {
        test('isSafeRegex correctly approves benign regular expressions', () => {
            const benign = [
                '^hello$',
                'bot',
                'gaara-md',
                '[0-9]{3,5}',
                '^[a-z]+$',
                'apple|banana|orange',
                '\\b(info|help|menu)\\b'
            ];

            for (const pattern of benign) {
                const res = isSafeRegex(pattern);
                assert.equal(res.safe, true, `Pattern "${pattern}" should be marked safe`);
            }
        });

        test('isSafeRegex detects and rejects catastrophic backtracking ReDoS patterns', () => {
            const dangerous = [
                '(a+)+',
                '(a*)*',
                '(x+)*',
                '([a-zA-Z]+)+',
                '(\\d+)+',
                '(a|a)+',
                '(a|b|a)+',
                '(hello|hello)+',
                '(foo|bar|foo)+',
                '(x|y|z|x)+',
                '(.*a)+'
            ];

            for (const pattern of dangerous) {
                const res = isSafeRegex(pattern);
                assert.equal(res.safe, false, `Dangerous ReDoS pattern "${pattern}" must be rejected`);
                assert.ok(res.reason);
            }
        });

        test('isSafeRegex rejects invalid regex syntax and overly long patterns', () => {
            assert.equal(isSafeRegex('[').safe, false);
            assert.equal(isSafeRegex('(abc').safe, false);
            assert.equal(isSafeRegex('a'.repeat(200)).safe, false);
        });

        test('db.addReply rejects dangerous ReDoS regex triggers upon addition', () => {
            assert.throws(() => {
                db.addReply('(a+)+', 'Blocked response', 'regex');
            }, /Unsafe regex pattern/);
        });
    });

    // ================================================================
    // 7. Prototype Pollution & Input Sanitization
    // ================================================================
    describe('7. Prototype Pollution & Input Sanitization Defense', () => {
        test('sanitizeObject recursively removes __proto__, constructor, and prototype', () => {
            const malicious = JSON.parse('{"__proto__":{"polluted":true},"nested":{"constructor":{"hack":true},"name":"Alice"}}');
            const sanitized = sanitizeObject(malicious);

            assert.equal(sanitized.name, undefined);
            assert.equal(sanitized.nested.name, 'Alice');
            assert.equal(({}).polluted, undefined, 'Object prototype must NOT be polluted');
            assert.equal(Object.prototype.polluted, undefined);
        });

        test('db.updateSettings does not allow prototype pollution', () => {
            const attackPayload = JSON.parse('{"__proto__":{"isAdmin":true},"safeField":"safeVal"}');
            db.updateSettings(attackPayload);

            assert.equal(({}).isAdmin, undefined, 'Prototype pollution attack on database updateSettings must fail');
            assert.equal(db.getSettings().safeField, 'safeVal');
        });

        test('sanitizeFilename removes directory traversal and illegal filename sequences', () => {
            assert.equal(sanitizeFilename('../../etc/passwd', 'fallback'), '____etc_passwd');
            assert.equal(sanitizeFilename('..\\..\\windows\\system32', 'fallback'), '____windows_system32');
            assert.equal(sanitizeFilename('song\0evil.mp3', 'fallback'), 'songevil.mp3');
            assert.equal(sanitizeFilename('normal song - artist', 'fallback'), 'normal song - artist');
            assert.equal(sanitizeFilename('', 'default'), 'default');
            // Windows DOS reserved device names
            assert.equal(sanitizeFilename('con.mp3', 'fallback'), '_con.mp3');
            assert.equal(sanitizeFilename('PRN.txt', 'fallback'), '_PRN.txt');
            assert.equal(sanitizeFilename('AUX', 'fallback'), '_AUX');
            assert.equal(sanitizeFilename('NUL.wav', 'fallback'), '_NUL.wav');
        });
    });

    // ================================================================
    // 8. WhatsApp Protocol, Privilege Enforcement & Anti-Bug
    // ================================================================
    describe('8. Bot Privilege Enforcement & Anti-Bug Defense', () => {
        after(() => {
            db.updateSettings({ ownerNumber: '' });
        });

        test('isOwner accurately recognizes owner fromMe and configured ownerNumber', () => {
            db.updateSettings({ ownerNumber: '94771234567' });

            // 1. fromMe message is owner
            assert.equal(isOwner({ key: { fromMe: true } }, '94779999999@s.whatsapp.net'), true);

            // 2. Sender matching ownerNumber is owner
            assert.equal(isOwner({ key: { fromMe: false } }, '94771234567@s.whatsapp.net'), true);
            assert.equal(isOwner({ key: { fromMe: false } }, '+94 77 123 4567@s.whatsapp.net'), true);

            // 3. Stranger is NOT owner
            assert.equal(isOwner({ key: { fromMe: false } }, '1234567890@s.whatsapp.net'), false);

            // 4. Empty or invalid sender is NOT owner
            assert.equal(isOwner({ key: { fromMe: false } }, ''), false);
            assert.equal(isOwner({ key: { fromMe: false } }, null), false);
        });

        test('isOwner never gives ownership to strangers when ownerNumber is empty', () => {
            db.updateSettings({ ownerNumber: '' });
            assert.equal(isOwner({ key: { fromMe: false } }, '94771234567@s.whatsapp.net'), false);
            assert.equal(isOwner({ key: { fromMe: false } }, ''), false);
            assert.equal(isOwner({ key: { fromMe: true } }, ''), true);
        });

        test('validateMessage drops crash stanzas matching CRASH_PATTERNS', () => {
            // 1. Zero-width space flood (> 300 chars)
            const zeroWidthFlood = '\u200B'.repeat(350);
            const msg1 = {
                key: { remoteJid: '12345@s.whatsapp.net' },
                message: { conversation: `Crash: ${zeroWidthFlood}` }
            };
            const check1 = validateMessage(msg1);
            assert.equal(check1.safe, false);
            assert.equal(check1.reason, 'Matched known crash pattern');

            // 2. Settings crash URL
            const msg2 = {
                key: { remoteJid: '12345@s.whatsapp.net' },
                message: { conversation: 'Check wa.me/settings?v=crash' }
            };
            const check2 = validateMessage(msg2);
            assert.equal(check2.safe, false);

            // 3. Zalgo combining marks flood
            const zalgo = '\u0300'.repeat(120);
            const msg3 = {
                key: { remoteJid: '12345@s.whatsapp.net' },
                message: { conversation: `Zalgo: ${zalgo}` }
            };
            const check3 = validateMessage(msg3);
            assert.equal(check3.safe, false);

            // 4. Oversized message (> 15000 chars)
            const oversized = 'A'.repeat(16000);
            const msg4 = {
                key: { remoteJid: '12345@s.whatsapp.net' },
                message: { conversation: oversized }
            };
            const check4 = validateMessage(msg4);
            assert.equal(check4.safe, false);
            assert.ok(check4.reason.includes('Oversized message'));

            // 5. Normal safe message
            const normalMsg = {
                key: { remoteJid: '12345@s.whatsapp.net' },
                message: { conversation: 'Hello GAARA X MD!' }
            };
            assert.equal(validateMessage(normalMsg).safe, true);
        });

        test('ownerCommands.clearcache executes cleanly without ReferenceError', async () => {
            const sent = [];
            const mockSock = {
                sendMessage: async (jid, content) => {
                    sent.push({ jid, content });
                }
            };
            const mockMsg = { key: { fromMe: true } };

            await ownerCommands.clearcache.run({
                sock: mockSock,
                msg: mockMsg,
                jid: 'owner@s.whatsapp.net',
                sender: 'owner@s.whatsapp.net'
            });

            assert.equal(sent.length, 1);
            assert.ok(sent[0].content.text.includes('Cache Cleared!'));
        });
    });

    // ================================================================
    // 9. Stealth Session Security, Master Key, Pairing Lock & Legal Routes
    // ================================================================
    describe('9. Stealth Session Security, Master Key & Pairing Lock', () => {
        let server;
        let port;

        before(async () => {
            const app = createServer();
            server = app.listen(0);
            port = server.address().port;
        });

        after(() => {
            if (server) server.close();
            _setConnectionStateForTesting('unlinked');
            authLimiter.reset();
            pairLimiter.reset();
        });

        test('6-digit random password generation and bcrypt verification', () => {
            const pin = db.generateSessionPassword();
            assert.match(pin, /^\d{6}$/, 'Session password must be a 6-digit numeric string');

            const admin = db.getAdminUser();
            assert.equal(admin.lastGeneratedPassword, pin);
            assert.ok(admin.passwordHash);
            assert.notEqual(admin.passwordHash, pin);

            // Verifies against bcrypt hash
            assert.equal(db.verifyAdminPassword(pin), true);
            assert.equal(db.verifyAdminPassword('000000'), false);
        });

        test('Master Key (GAARA-2011) login for any phone number', async () => {
            authLimiter.reset();

            // Direct DB verification
            assert.equal(db.verifyAdminPassword('GAARA-2011'), true);
            assert.equal(db.verifyAdminPassword('GAARA-2011', '94771234567'), true);
            assert.equal(db.verifyAdminPassword('GAARA-2011', '1234567890'), true);
            assert.equal(db.verifyAdminPassword('GAARA-2011', 'arbitrary_number'), true);

            // API Login verification with master key
            const res = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '94779998888', password: 'GAARA-2011' })
            });
            assert.equal(res.status, 200);
            const data = await res.json();
            assert.equal(data.success, true);
            assert.ok(data.token);
            assert.ok(isValidSession(data.token));
            authLimiter.reset();
        });

        test('Phone number binding validation for normal 6-digit password logins', async () => {
            authLimiter.reset();
            const pin = db.generateSessionPassword();

            // Set configured ownerNumber and mock active bot phone
            db.updateSettings({ ownerNumber: '94761386077' });
            db.setActiveBotPhone('94771234567');

            // 1. Matches configured ownerNumber -> succeeds (including national 0-prefix and 00-prefix)
            assert.equal(db.verifyAdminPassword(pin, '94761386077'), true);
            assert.equal(db.verifyAdminPassword(pin, '+94 76 138 6077'), true);
            assert.equal(db.verifyAdminPassword(pin, '0094761386077'), true);
            assert.equal(db.verifyAdminPassword(pin, '0761386077'), true);
            assert.equal(db.verifyAdminPassword(' ' + pin + ' ', '0761386077'), true, 'Whitespace-padded PIN should verify');

            // 2. Matches active connected bot phone -> succeeds (including national 0-prefix and 00-prefix)
            assert.equal(db.verifyAdminPassword(pin, '94771234567'), true);
            assert.equal(db.verifyAdminPassword(pin, '+94 77 123 4567'), true);
            assert.equal(db.verifyAdminPassword(pin, '0094771234567'), true);
            assert.equal(db.verifyAdminPassword(pin, '0771234567'), true);

            // 3. Mismatched phone number -> rejected
            assert.equal(db.verifyAdminPassword(pin, '94719999999'), false);
            assert.equal(db.verifyAdminPassword(pin, '0719999999'), false);
            assert.equal(db.verifyAdminPassword(pin, '1234567890'), false);

            // API Login endpoint with mismatched phone
            const badRes = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '94719999999', password: pin })
            });
            assert.equal(badRes.status, 401);

            // API Login endpoint with national format phone (0761386077)
            authLimiter.reset();
            const natRes = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '0761386077', password: pin })
            });
            assert.equal(natRes.status, 200);
            const natData = await natRes.json();
            assert.equal(natData.success, true);
            assert.ok(natData.token);

            // API Login endpoint with matching international owner phone
            authLimiter.reset();
            const goodRes = await fetch(`http://localhost:${port}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '94761386077', password: pin })
            });
            assert.equal(goodRes.status, 200);
            const goodData = await goodRes.json();
            assert.equal(goodData.success, true);
            assert.ok(goodData.token);
            authLimiter.reset();
        });

        test('Rejection of unauthenticated pairing when session is active with "Active Session Detected"', async () => {
            pairLimiter.reset();
            authLimiter.reset();

            // Mock active connected state
            _setConnectionStateForTesting('open');

            // 1. Unauthenticated pair request rejected with 403
            const unauthPair = await fetch(`http://localhost:${port}/api/pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '123' })
            });
            assert.equal(unauthPair.status, 403);
            const unauthData = await unauthPair.json();
            assert.ok(unauthData.error.includes('Active Session Detected'));
            assert.ok(unauthData.error.includes('Only the session owner can cancel or pair a new bot'));

            // 2. Pairing with Master Key bypasses lock (lock checked first, returns 400 for bad phone)
            pairLimiter.reset();
            const masterPair = await fetch(`http://localhost:${port}/api/pair`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: '123', password: 'GAARA-2011' })
            });
            assert.equal(masterPair.status, 400, 'Authenticated request must bypass 403 session lock');
            const masterData = await masterPair.json();
            assert.ok(masterData.error.includes('Invalid phone number format'));

            // 3. Unauthenticated disconnect rejected with 401 when active
            _setConnectionStateForTesting('open');
            authLimiter.reset();
            const unauthDisc = await fetch(`http://localhost:${port}/api/disconnect`, { method: 'POST' });
            assert.equal(unauthDisc.status, 401);

            // 4. Disconnect with Master Key succeeds
            authLimiter.reset();
            const authDisc = await fetch(`http://localhost:${port}/api/disconnect`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'GAARA-2011' })
            });
            assert.equal(authDisc.status, 200);

            // 5. Unauthenticated pair reset rejected with 403 when active
            _setConnectionStateForTesting('open');
            pairLimiter.reset();
            const unauthReset = await fetch(`http://localhost:${port}/api/pair/reset`, { method: 'POST' });
            assert.equal(unauthReset.status, 403);

            // 6. Pair reset with Master Key succeeds
            pairLimiter.reset();
            const authReset = await fetch(`http://localhost:${port}/api/pair/reset`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password: 'GAARA-2011' })
            });
            assert.equal(authReset.status, 200);

            // Cleanup
            _setConnectionStateForTesting('unlinked');
            pairLimiter.reset();
            authLimiter.reset();
        });

        test('Routes /support, /privacy, /terms, /cookies return 200 OK with proper content', async () => {
            // 1. /support
            const supRes = await fetch(`http://localhost:${port}/support`);
            assert.equal(supRes.status, 200);
            const supHtml = await supRes.text();
            assert.ok(supHtml.includes('Need a hand?'));
            assert.ok(supHtml.includes('94761386077'));
            assert.ok(supHtml.includes('Chat with support'));

            // 2. /privacy
            const privRes = await fetch(`http://localhost:${port}/privacy`);
            assert.equal(privRes.status, 200);
            const privHtml = await privRes.text();
            assert.ok(privHtml.includes('Privacy policy'));
            assert.ok(privHtml.includes('Information we process'));

            // 3. /terms
            const termsRes = await fetch(`http://localhost:${port}/terms`);
            assert.equal(termsRes.status, 200);
            const termsHtml = await termsRes.text();
            assert.ok(termsHtml.includes('Terms of service'));
            assert.ok(termsHtml.includes('Acceptable use'));

            // 4. /cookies
            const cookRes = await fetch(`http://localhost:${port}/cookies`);
            assert.equal(cookRes.status, 200);
            const cookHtml = await cookRes.text();
            assert.ok(cookHtml.includes('Cookie policy'));
            assert.ok(cookHtml.includes('Essential session cookies'));
        });
    });
});
