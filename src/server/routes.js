import express from 'express';
import path from 'path';
import config from '../../config/index.js';
import db from '../../config/database.js';
import { getBotStatus, requestPairing, initBotSocket, resetSession, restartBotSocket } from '../bot/socket.js';
import { createSessionToken, isValidSession, requireAuth } from './auth.js';
import cfSync from '../services/cfSync.js';
import logger from '../utils/logger.js';

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
        res.sendFile(path.join(publicDir, 'settings.html'));
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

    // ==========================================
    // Public Telemetry & Pairing API
    // ==========================================
    app.get('/api/status', (req, res) => {
        const botStatus = getBotStatus();
        const settings = db.getSettings();
        res.json({
            ...botStatus,
            botName: settings.botName,
            prefix: settings.prefix,
            mode: settings.mode
        });
    });

    app.post('/api/pair', async (req, res) => {
        const { phone, frontendUrl } = req.body;
        if (!phone) {
            return res.status(400).json({ error: 'Phone number is required' });
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
            const code = await requestPairing(phone, { frontendUrl: discoveredFrontend });
            res.json({ success: true, code });
        } catch (err) {
            logger.error({ err: err.message }, '[API] Pairing request error');
            const statusCode = (err.message && err.message.includes('timed out')) ? 504 : 500;
            res.status(statusCode).json({ error: err.message || 'Failed to request pairing code' });
        }
    });

    app.post('/api/pair/reset', async (req, res) => {
        try {
            logger.info('[API] Explicit pairing session reset requested');
            await resetSession({ clearFiles: true });
            res.json({ success: true, message: 'Session reset successfully' });
        } catch (err) {
            logger.error({ err: err.message }, '[API] Failed to reset session');
            res.status(500).json({ error: err.message || 'Failed to reset session' });
        }
    });

    app.post('/api/disconnect', async (req, res) => {
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
    // Authentication Endpoints
    // ==========================================
    app.post('/api/auth/login', (req, res) => {
        const { password } = req.body;
        if (!password) {
            return res.status(400).json({ error: 'Password required' });
        }

        const valid = db.verifyAdminPassword(password);
        if (!valid) {
            return res.status(401).json({ error: 'Incorrect panel password' });
        }

        const token = createSessionToken();
        res.json({ success: true, token });
    });

    app.get('/api/auth/check', (req, res) => {
        const authHeader = req.headers.authorization;
        const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : req.headers['x-panel-token'];
        res.json({ authenticated: isValidSession(token) });
    });

    app.post('/api/auth/change-password', requireAuth, (req, res) => {
        const { newPassword } = req.body;
        if (!newPassword || newPassword.length < 4) {
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
        const raw = db.getSettings();
        const settings = { ...raw };
        if (settings.sasaDevApiKey) {
            settings.sasaDevApiKey = '••••••••••••••••••••••••••••••••••••••••••••';
        }
        res.json(settings);
    });

    app.post('/api/settings', requireAuth, (req, res) => {
        try {
            const body = { ...req.body };
            if (body.sasaDevApiKey && (body.sasaDevApiKey.includes('••••') || body.sasaDevApiKey.trim() === '')) {
                delete body.sasaDevApiKey;
            }
            const updated = db.updateSettings(body);
            const status = getBotStatus();
            const phone = status.telemetry?.phoneNumber;
            if (phone) {
                cfSync.saveSettingsToCloudflare(phone, updated).catch(() => {});
            }
            const safeUpdated = { ...updated };
            if (safeUpdated.sasaDevApiKey) {
                safeUpdated.sasaDevApiKey = '••••••••••••••••••••••••••••••••••••••••••••';
            }
            res.json({ success: true, settings: safeUpdated });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ==========================================
    // Protected Replies API
    // ==========================================
    app.get('/api/replies', requireAuth, (req, res) => {
        res.json(db.getReplies());
    });

    app.post('/api/replies', requireAuth, (req, res) => {
        const { trigger, response, matchType } = req.body;
        if (!trigger || !response) {
            return res.status(400).json({ error: 'Trigger and response are required' });
        }
        const created = db.addReply(trigger, response, matchType || 'contains');
        const status = getBotStatus();
        const phone = status.telemetry?.phoneNumber;
        if (phone) {
            cfSync.saveRepliesToCloudflare(phone, db.getReplies()).catch(() => {});
        }
        res.json({ success: true, reply: created });
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
        const { jid, message, type, time } = req.body;
        if (!jid || !message || !time) {
            return res.status(400).json({ error: 'Target JID/number, message, and time are required' });
        }
        const entry = db.addSchedule({ jid, message, type: type || 'daily', time });
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
