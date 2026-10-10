import express from 'express';
import path from 'path';
import fs from 'fs';
import config from '../../config/index.js';
import db from '../../config/database.js';
import { getBotStatus, requestPairing, initBotSocket, resetSession, restartBotSocket } from '../bot/socket.js';
import { createSessionToken, isValidSession, requireAuth } from './auth.js';
import { createRateLimiter } from './rateLimiter.js';
import { sanitizeObject, isSafeRegex } from '../utils/security.js';
import { allCommandCategories } from '../commands/index.js';
import cfSync from '../services/cfSync.js';
import logger from '../utils/logger.js';

// Dedicated Rate Limiters for sensitive endpoints
export const authLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Too many login attempts. Please wait 1 minute before trying again.'
});

export const pairLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 5,
    message: 'Too many pairing requests. Please wait 1 minute before trying again.'
});

export const reviewLimiter = createRateLimiter({
    windowMs: 60 * 1000,
    max: 10,
    message: 'Too many reviews submitted. Please wait 1 minute before trying again.'
});

export function setupRoutes(app) {
    const publicDir = path.join(config.rootDir, 'public');

    // ==========================================
    // Render & Cloudflare Keepalive Routes
    // ==========================================
    app.get('/health', (req, res) => {
        res.status(200).json({
            status: 'ok',
            service: config.botName,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        });
    });

    app.get('/ping', (req, res) => {
        res.status(200).send('pong');
    });

    // ==========================================
    // Frontend HTML Views
    // ==========================================
    app.get('/', (req, res) => {
        res.sendFile(path.join(publicDir, 'index.html'));
    });

    app.get('/about', (req, res) => {
        res.sendFile(path.join(publicDir, 'about.html'));
    });

    app.get('/reviews', (req, res) => {
        res.sendFile(path.join(publicDir, 'reviews.html'));
    });

    app.get('/pair', (req, res) => {
        res.sendFile(path.join(publicDir, 'pair.html'));
    });

    app.get('/settings', (req, res) => {
        res.sendFile(path.join(publicDir, 'settings.html'));
    });

    app.get('/status', (req, res) => {
        res.sendFile(path.join(publicDir, 'status.html'));
    });

    app.get('/support', (req, res) => {
        res.sendFile(path.join(publicDir, 'support.html'));
    });

    app.get('/privacy', (req, res) => {
        res.sendFile(path.join(publicDir, 'privacy.html'));
    });

    app.get('/terms', (req, res) => {
        res.sendFile(path.join(publicDir, 'terms.html'));
    });

    app.get('/cookies', (req, res) => {
        res.sendFile(path.join(publicDir, 'cookies.html'));
    });

    // ==========================================
    // Public Telemetry & Pairing API
    // ==========================================
    app.get('/api/status', (req, res) => {
        const botStatus = getBotStatus();
        const settings = db.getSettings();

        let totalCommands = 0;
        try {
            for (const cat of Object.values(allCommandCategories)) {
                for (const def of Object.values(cat)) {
                    if (!def.hidden) totalCommands++;
                }
            }
        } catch {
            totalCommands = 120;
        }

        const mem = process.memoryUsage();

        res.json({
            ...botStatus,
            botName: settings.botName,
            prefix: settings.prefix,
            mode: settings.mode,
            commandCount: totalCommands,
            connectedBots: botStatus.connection === 'open' ? 1 : 0,
            categories: Object.keys(allCommandCategories),
            serverUptime: Math.floor(process.uptime()),
            memory: {
                heapUsedMB: Math.round(mem.heapUsed / 1024 / 1024),
                rssMB: Math.round(mem.rss / 1024 / 1024)
            },
            platform: process.platform,
            nodeVersion: process.version
        });
    });

    // Real command registry explorer
    app.get('/api/commands', (req, res) => {
        const catalog = {};
        let total = 0;
        for (const [category, cmds] of Object.entries(allCommandCategories)) {
            catalog[category] = [];
            for (const [name, def] of Object.entries(cmds)) {
                if (def.hidden) continue;
                total++;
                catalog[category].push({
                    name,
                    description: def.description || 'Command handler',
                    usage: def.usage || `.${name}`,
                    aliases: def.aliases || [],
                    category
                });
            }
        }
        res.json({ total, categories: Object.keys(allCommandCategories), commands: catalog });
    });

    // Community reviews API (100% real user submissions)
    app.get('/api/reviews', (req, res) => {
        const stats = db.getReviewStats();
        const reviews = db.getReviews();
        res.json({ reviews, ...stats });
    });

    app.post('/api/reviews', reviewLimiter, (req, res) => {
        const { name, rating, review } = req.body || {};
        if (!name || typeof name !== 'string' || name.trim().length < 2) {
            return res.status(400).json({ error: 'Please enter a valid name (at least 2 characters)' });
        }
        if (!review || typeof review !== 'string' || review.trim().length < 5) {
            return res.status(400).json({ error: 'Please enter a review of at least 5 characters' });
        }
        const cleanRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));

        try {
            const created = db.addReview({
                name: name.trim().slice(0, 50),
                rating: cleanRating,
                review: review.trim().slice(0, 600)
            });
            const stats = db.getReviewStats();
            res.json({ success: true, review: created, stats });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    function isAuthorizedSessionRequest(req) {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-panel-token'];
        if (isValidSession(token)) return true;

        const passCandidate = req.headers['x-session-password'] || req.headers['x-panel-password'] || req.body?.password || req.body?.pin;
        if (passCandidate && db.verifyAdminPassword(passCandidate)) {
            return true;
        }
        return false;
    }

    app.post('/api/pair', pairLimiter, async (req, res) => {
        const status = getBotStatus();
        // Privilege protection: An active connected bot cannot be hijacked or reset without authentication
        if (status.connection === 'open') {
            if (!isAuthorizedSessionRequest(req)) {
                return res.status(403).json({ error: 'Active Session Detected: An active WhatsApp session is already connected. Only the session owner can cancel or pair a new bot.' });
            }
        }

        const { phone, frontendUrl } = req.body || {};
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
        }

        // Strict input validation: numeric digits only, valid international phone length
        const cleanPhone = String(phone).replace(/[^0-9]/g, '');
        if (cleanPhone.length < 8 || cleanPhone.length > 15) {
            return res.status(400).json({ error: 'Invalid phone number format. Must contain 8 to 15 digits.' });
        }

        let discoveredFrontend = frontendUrl;
        if (!discoveredFrontend && req.headers.origin) {
            discoveredFrontend = req.headers.origin;
        } else if (!discoveredFrontend && req.headers.referer) {
            try {
                discoveredFrontend = new URL(req.headers.referer).origin;
            } catch {}
        }

        try {
            const code = await requestPairing(cleanPhone, { frontendUrl: discoveredFrontend });
            res.json({ success: true, code });
        } catch (err) {
            logger.error({ err: err.message }, '[API] Pairing request error');
            const statusCode = (err.message && err.message.includes('timed out')) ? 504 : 500;
            res.status(statusCode).json({ error: err.message || 'Failed to request pairing code' });
        }
    });

    app.post('/api/pair/reset', pairLimiter, async (req, res) => {
        const status = getBotStatus();
        // Privilege protection: Active connected bot cannot be reset without authentication
        if (status.connection === 'open') {
            if (!isAuthorizedSessionRequest(req)) {
                return res.status(403).json({ error: 'Active session cannot be reset without panel authentication.' });
            }
        }

        try {
            logger.info('[API] Pairing session reset requested');
            await resetSession({ clearFiles: true });
            res.json({ success: true, message: 'Session reset successfully' });
        } catch (err) {
            logger.error({ err: err.message }, '[API] Failed to reset session');
            res.status(500).json({ error: err.message || 'Failed to reset session' });
        }
    });

    // Bot disconnect endpoint: protects active connection from unauthorized disconnection
    app.post('/api/disconnect', authLimiter, async (req, res) => {
        const status = getBotStatus();
        // If bot is actively connected (open), strictly require panel authentication
        if (status.connection === 'open') {
            if (!isAuthorizedSessionRequest(req)) {
                return res.status(401).json({ error: 'Unauthorized. Panel authentication required to disconnect active bot.' });
            }
        }

        try {
            logger.info('[API] Bot disconnect requested');
            await resetSession({ clearFiles: true });
            res.json({ success: true, message: 'Bot disconnected successfully' });
        } catch (err) {
            logger.error({ err: err.message }, '[API] Failed to disconnect bot');
            res.status(500).json({ error: err.message || 'Failed to disconnect bot' });
        }
    });

    // ==========================================
    // Authentication Endpoints (/api/login & /api/auth/login)
    // ==========================================
    const handleLoginRequest = (req, res) => {
        const { password, phone } = req.body || {};
        if (!password || typeof password !== 'string') {
            return res.status(400).json({ error: 'Password required' });
        }

        const valid = db.verifyAdminPassword(password, phone);
        if (!valid) {
            return res.status(401).json({ error: 'Incorrect panel password' });
        }

        const token = createSessionToken();
        res.json({ success: true, token });
    };

    app.post('/api/auth/login', authLimiter, handleLoginRequest);
    app.post('/api/login', authLimiter, handleLoginRequest);

    const handleAuthCheck = (req, res) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-panel-token'];
        res.json({ authenticated: isValidSession(token) });
    };

    app.get('/api/auth/check', handleAuthCheck);
    app.get('/api/check', handleAuthCheck);

    app.post('/api/auth/change-password', requireAuth, (req, res) => {
        const { newPassword } = req.body || {};
        if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 4) {
            return res.status(400).json({ error: 'Password must be at least 4 characters long' });
        }

        db.updateAdminPassword(newPassword);
        logger.info('[Auth] Admin panel password updated');
        res.json({ success: true, message: 'Password updated successfully' });
    });

    // ==========================================
    // Protected Settings API
    // ==========================================
    app.get('/api/settings', requireAuth, (req, res) => {
        const settings = db.getSettings();
        // Secrets hygiene: mask sensitive keys so client browsers never receive raw credentials
        res.json(db.maskSettings(settings));
    });

    app.post('/api/settings', requireAuth, (req, res) => {
        try {
            // Prototype pollution protection: sanitize all input keys
            const rawBody = sanitizeObject(req.body || {});
            const body = { ...rawBody };

            // Secrets hygiene: ignore masked dummy strings sent back from frontend
            if (body.sasaDevApiKey && (body.sasaDevApiKey.includes('••••') || body.sasaDevApiKey.trim() === '')) {
                delete body.sasaDevApiKey;
            }

            const updated = db.updateSettings(body);
            const status = getBotStatus();
            const phone = status.telemetry?.phoneNumber;
            if (phone) {
                cfSync.saveSettingsToCloudflare(phone, updated).catch(() => {});
            }

            res.json({ success: true, settings: db.maskSettings(updated) });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post('/api/upload/logo', requireAuth, (req, res) => {
        const { dataUrl } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid logo data' });
        }
        try {
            if (dataUrl.startsWith('http://') || dataUrl.startsWith('https://')) {
                db.updateSettings({ customLogoUrl: dataUrl });
                return res.json({ success: true, url: dataUrl });
            }
            const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid image format. Provide base64 or URL.' });
            }
            const buffer = Buffer.from(matches[2], 'base64');
            const fileName = `custom_logo_${Date.now()}.png`;
            const assetsDir = path.join(publicDir, 'assets');
            if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });
            const filePath = path.join(assetsDir, fileName);
            fs.writeFileSync(filePath, buffer);
            const publicUrl = `/assets/${fileName}`;
            db.updateSettings({ customLogoUrl: publicUrl });
            res.json({ success: true, url: publicUrl });
        } catch (err) {
            res.status(500).json({ error: 'Failed to process logo upload' });
        }
    });

    app.post('/api/upload/voice', requireAuth, (req, res) => {
        const { dataUrl, fileName: originalName } = req.body || {};
        if (!dataUrl || typeof dataUrl !== 'string') {
            return res.status(400).json({ error: 'Invalid voice data' });
        }
        try {
            const matches = dataUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid audio format. Provide base64 audio.' });
            }
            const buffer = Buffer.from(matches[2], 'base64');
            if (buffer.length > 15 * 1024 * 1024) {
                return res.status(400).json({ error: 'Audio file exceeds 15 MB limit' });
            }
            const safeName = `autocall_voice_${Date.now()}.mp3`;
            const targetDir = path.join(config.rootDir, 'data');
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });
            const filePath = path.join(targetDir, safeName);
            fs.writeFileSync(filePath, buffer);
            db.updateSettings({ autoCallVoiceFile: filePath });
            res.json({ success: true, fileName: safeName, path: filePath });
        } catch (err) {
            res.status(500).json({ error: 'Failed to save voice file' });
        }
    });

    // ==========================================
    // Protected Replies API
    // ==========================================
    app.get('/api/replies', requireAuth, (req, res) => {
        res.json(db.getReplies());
    });

    app.post('/api/replies', requireAuth, (req, res) => {
        const { trigger, response, matchType } = req.body || {};
        if (!trigger || !response) {
            return res.status(400).json({ error: 'Trigger and response are required' });
        }

        const cleanMatchType = matchType || 'contains';
        if (cleanMatchType === 'regex') {
            const check = isSafeRegex(trigger);
            if (!check.safe) {
                return res.status(400).json({ error: `Unsafe regex pattern: ${check.reason}` });
            }
        }

        try {
            const created = db.addReply(trigger, response, cleanMatchType);
            const status = getBotStatus();
            const phone = status.telemetry?.phoneNumber;
            if (phone) {
                cfSync.saveRepliesToCloudflare(phone, db.getReplies()).catch(() => {});
            }
            res.json({ success: true, reply: created });
        } catch (err) {
            res.status(400).json({ error: err.message });
        }
    });

    app.delete('/api/replies/:id', requireAuth, (req, res) => {
        const removed = db.removeReply(req.params.id);
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber;
        if (phone) {
            cfSync.saveRepliesToCloudflare(phone, db.getReplies()).catch(() => {});
        }
        res.json({ success: removed });
    });

    // ==========================================
    // Protected Schedules API
    // ==========================================
    app.get('/api/schedules', requireAuth, (req, res) => {
        res.json(db.getSchedules());
    });

    app.post('/api/schedules', requireAuth, (req, res) => {
        const { jid, message, type, time } = req.body || {};
        if (!jid || !message || !time) {
            return res.status(400).json({ error: 'Target JID/number, message, and time are required' });
        }
        const entry = db.addSchedule({ jid: String(jid).trim(), message: String(message).trim(), type: type || 'daily', time: String(time).trim() });
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber;
        if (phone) {
            cfSync.saveSchedulesToCloudflare(phone, db.getSchedules()).catch(() => {});
        }
        res.json({ success: true, schedule: entry });
    });

    app.delete('/api/schedules/:id', requireAuth, (req, res) => {
        const removed = db.removeSchedule(req.params.id);
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber;
        if (phone) {
            cfSync.saveSchedulesToCloudflare(phone, db.getSchedules()).catch(() => {});
        }
        res.json({ success: removed });
    });

    app.post('/api/schedules/:id/toggle', requireAuth, (req, res) => {
        const schedules = db.getSchedules();
        const found = schedules.find(s => s.id === req.params.id);
        if (!found) return res.status(404).json({ error: 'Schedule not found' });

        const updated = db.updateSchedule(req.params.id, { active: !found.active });
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber;
        if (phone) {
            cfSync.saveSchedulesToCloudflare(phone, db.getSchedules()).catch(() => {});
        }
        res.json({ success: true, schedule: updated });
    });

    // ==========================================
    // Cloudflare D1 Sync Management Endpoints
    // ==========================================
    app.post('/api/sync/pull', requireAuth, async (req, res) => {
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber || req.body?.phone;
        if (!phone) {
            return res.status(400).json({ error: 'Phone number required to pull from Cloudflare D1' });
        }
        const result = await cfSync.syncFromCloudflare(phone);
        res.json(result);
    });

    app.post('/api/sync/push', requireAuth, async (req, res) => {
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber || req.body?.phone;
        if (!phone) {
            return res.status(400).json({ error: 'Phone number required to push to Cloudflare D1' });
        }
        const result = await cfSync.syncToCloudflare(phone);
        res.json(result);
    });

    // ==========================================
    // Bot Management Actions
    // ==========================================
    app.post('/api/bot/restart', requireAuth, async (req, res) => {
        logger.info('[API] Bot restart requested via dashboard');
        try {
            await restartBotSocket();
            res.json({ success: true, message: 'Bot connection restarted' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
}

export default setupRoutes;
