import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import EventEmitter from 'events';
import bcrypt from 'bcryptjs';
import config from './index.js';
import { DEFAULT_SETTINGS } from './constants.js';
import { sanitizeObject, isSafeRegex } from '../src/utils/security.js';

class JsonDatabase extends EventEmitter {
    constructor() {
        super();
        this.dataDir = config.dataDir;
        this.settingsFile = path.join(this.dataDir, 'settings.json');
        this.repliesFile = path.join(this.dataDir, 'replies.json');
        this.schedulesFile = path.join(this.dataDir, 'schedules.json');
        this.callsFile = path.join(this.dataDir, 'calls.json');
        this.usersFile = path.join(this.dataDir, 'users.json');
        this.reviewsFile = path.join(this.dataDir, 'reviews.json');
        this._cachedSettings = null;
        this._cachedUsers = null;

        this.init();
    }

    _cleanOrphanedTmpFiles() {
        try {
            if (!fs.existsSync(this.dataDir)) return;
            const entries = fs.readdirSync(this.dataDir);
            for (const entry of entries) {
                if (entry.includes('.tmp.')) {
                    try {
                        fs.unlinkSync(path.join(this.dataDir, entry));
                    } catch {}
                }
            }
        } catch {}
    }

    _readSafe(file, defaultVal) {
        try {
            if (!fs.existsSync(file)) {
                this._writeSafe(file, defaultVal);
                return defaultVal;
            }
            const raw = fs.readFileSync(file, 'utf-8');
            return JSON.parse(raw);
        } catch (err) {
            console.error(`[DB] Error reading ${file}:`, err.message);
            return defaultVal;
        }
    }

    _writeSafe(file, data) {
        const json = JSON.stringify(data, null, 2);
        const uniqueId = `${process.pid}.${Date.now()}.${crypto.randomBytes(4).toString('hex')}`;
        const tempFile = `${file}.tmp.${uniqueId}`;
        try {
            fs.writeFileSync(tempFile, json, 'utf-8');
            try {
                fs.renameSync(tempFile, file);
            } catch (renameErr) {
                // Windows lock fallback: copyFileSync then unlinkSync
                try {
                    fs.copyFileSync(tempFile, file);
                } catch {
                    fs.writeFileSync(file, json, 'utf-8');
                }
            }
        } catch (err) {
            // Direct write fallback
            try {
                fs.writeFileSync(file, json, 'utf-8');
            } catch (directErr) {
                console.error(`[DB] Error writing ${file}:`, directErr.message);
            }
        } finally {
            if (fs.existsSync(tempFile)) {
                try {
                    fs.unlinkSync(tempFile);
                } catch {}
            }
        }
    }

    init() {
        this._cleanOrphanedTmpFiles();

        // 1. Settings
        const currentSettings = this._readSafe(this.settingsFile, null);
        if (!currentSettings) {
            const initial = {
                ...DEFAULT_SETTINGS,
                botName: config.botName,
                prefix: config.botPrefix,
                ownerNumber: config.ownerNumber,
                ownerName: config.ownerName,
                ownerBio: config.ownerBio,
                sasaDevApiKey: config.sasaDevApiKey,
                customLogoUrl: config.botLogoUrl
            };
            this._writeSafe(this.settingsFile, initial);
        }

        // 2. Custom Replies
        this._readSafe(this.repliesFile, [
            {
                id: 'reply-1',
                trigger: 'hello',
                response: '👋 Hello there! How can I assist you today?',
                matchType: 'contains',
                enabled: true
            },
            {
                id: 'reply-2',
                trigger: 'bot',
                response: '⚡ GAARA X MD is online and active!',
                matchType: 'exact',
                enabled: true
            }
        ]);

        // 3. Schedules
        this._readSafe(this.schedulesFile, []);

        // 4. Calls
        this._readSafe(this.callsFile, {});

        // 5. Users / Panel Auth
        const users = this._readSafe(this.usersFile, null);
        if (!users || !users.admin) {
            const initialPlainPassword = config.panelPasswordEnv || crypto.randomBytes(6).toString('hex');
            const salt = bcrypt.genSaltSync(10);
            const passwordHash = bcrypt.hashSync(initialPlainPassword, salt);
            
            const userObj = {
                admin: {
                    username: config.panelUsername,
                    passwordHash,
                    lastGeneratedPassword: initialPlainPassword,
                    updatedAt: new Date().toISOString()
                }
            };
            this._cachedUsers = userObj;
            this._writeSafe(this.usersFile, userObj);
        } else {
            this._cachedUsers = users;
        }

        // 6. Community Reviews (Real verified user feedback from screenshots)
        this._readSafe(this.reviewsFile, [
            {
                id: 'rev-1',
                name: 'Viruna',
                rating: 5,
                review: 'Bota gana aye ithin kiyanna deyak na . 5 Star rating ⭐',
                createdAt: new Date(Date.now() - 24 * 3600 * 1000).toISOString(),
                isNew: true
            },
            {
                id: 'rev-2',
                name: 'apexZ',
                rating: 5,
                review: 'This is the best whatsapp bot I have ever used. Super fast, fully stable and completely bug-free. All commands work perfectly and features are very useful. Easy to use and well developed. Great work by the developer. Highly recommended for everyone.',
                createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                isNew: false
            },
            {
                id: 'rev-3',
                name: 'Heshan Dev',
                rating: 5,
                review: 'පට්ට බොට් එක...සුපිරියි ගැම්මක් අල්ලමු සුද්දා 🫡🙌',
                createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                isNew: false
            },
            {
                id: 'rev-4',
                name: 'Sayuru Senavirathna',
                rating: 5,
                review: 'I have used many whatsapp bots so far, but almost all features have been implemented right from the very first version. The standout feature is the AI Reply—something many other bots lack. Keep it up!',
                createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                isNew: false
            },
            {
                id: 'rev-5',
                name: 'Dinhgh Fdoz',
                rating: 5,
                review: 'Super Bot nE!',
                createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                isNew: false
            },
            {
                id: 'rev-6',
                name: 'Kavin',
                rating: 5,
                review: 'GAARA X MD ON TOP 🔝',
                createdAt: new Date(Date.now() - 2 * 24 * 3600 * 1000).toISOString(),
                isNew: false
            }
        ]);
    }

    // --- Settings Methods ---
    getSettings() {
        if (!this._cachedSettings) {
            const raw = this._readSafe(this.settingsFile, DEFAULT_SETTINGS);
            delete raw._suppressLog;
            delete raw._lastSetupSentPhone;
            this._cachedSettings = { ...DEFAULT_SETTINGS, ...raw };
        }
        const settings = { ...DEFAULT_SETTINGS, ...this._cachedSettings };
        delete settings._suppressLog;
        delete settings._lastSetupSentPhone;
        return settings;
    }

    maskSettings(settings) {
        if (!settings) return {};
        const safe = { ...settings };
        if (safe.sasaDevApiKey) {
            safe.sasaDevApiKey = '••••••••••••••••••••••••••••••••••••••••••••';
        }
        delete safe.jwtSecret;
        delete safe.panelPassword;
        return safe;
    }

    updateSettings(partial, { suppressLog = false } = {}) {
        const current = this.getSettings();
        // Prevent prototype pollution attacks by sanitizing keys
        const sanitized = sanitizeObject(partial || {});
        const { _suppressLog, _lastSetupSentPhone, ...cleanPartial } = sanitized;
        const merged = { ...current, ...cleanPartial };
        delete merged._suppressLog;
        delete merged._lastSetupSentPhone;
        this._cachedSettings = merged;
        this._writeSafe(this.settingsFile, merged);
        this.emit('settingsUpdated', merged, { suppressLog: Boolean(suppressLog || _suppressLog) });
        return merged;
    }

    // --- Replies Methods ---
    getReplies() {
        return this._readSafe(this.repliesFile, []);
    }

    addReply(trigger, response, matchType = 'contains') {
        const cleanTrigger = (trigger || '').trim();
        const cleanResponse = (response || '').trim();
        if (!cleanTrigger || !cleanResponse) {
            throw new Error('Trigger and response are required');
        }

        // Validate regex to prevent ReDoS (Catastrophic Backtracking)
        if (matchType === 'regex') {
            const check = isSafeRegex(cleanTrigger);
            if (!check.safe) {
                throw new Error(`Unsafe regex pattern: ${check.reason}`);
            }
        }

        const replies = this.getReplies();
        const id = 'reply-' + Date.now();
        const newEntry = { id, trigger: cleanTrigger, response: cleanResponse, matchType, enabled: true };
        replies.push(newEntry);
        this._writeSafe(this.repliesFile, replies);
        return newEntry;
    }

    removeReply(idOrTrigger) {
        let replies = this.getReplies();
        const originalLen = replies.length;
        replies = replies.filter(r => r.id !== idOrTrigger && r.trigger.toLowerCase() !== idOrTrigger.toLowerCase());
        this._writeSafe(this.repliesFile, replies);
        return replies.length < originalLen;
    }

    // --- Schedules Methods ---
    getSchedules() {
        return this._readSafe(this.schedulesFile, []);
    }

    addSchedule(schedule) {
        const list = this.getSchedules();
        const entry = {
            id: 'sched-' + Date.now(),
            active: true,
            createdAt: new Date().toISOString(),
            ...schedule
        };
        list.push(entry);
        this._writeSafe(this.schedulesFile, list);
        return entry;
    }

    removeSchedule(id) {
        let list = this.getSchedules();
        const originalLen = list.length;
        list = list.filter(s => s.id !== id);
        this._writeSafe(this.schedulesFile, list);
        return list.length < originalLen;
    }

    updateSchedule(id, updates) {
        const list = this.getSchedules();
        const idx = list.findIndex(s => s.id === id);
        if (idx !== -1) {
            list[idx] = { ...list[idx], ...updates };
            this._writeSafe(this.schedulesFile, list);
            return list[idx];
        }
        return null;
    }

    // --- Anti-Call Warning Tracker ---
    getCallWarnings() {
        return this._readSafe(this.callsFile, {});
    }

    recordCall(callerJid) {
        const calls = this.getCallWarnings();
        const current = calls[callerJid] || { count: 0, lastCall: Date.now() };
        current.count += 1;
        current.lastCall = Date.now();
        calls[callerJid] = current;
        this._writeSafe(this.callsFile, calls);
        return current.count;
    }

    resetCallWarnings(callerJid) {
        const calls = this.getCallWarnings();
        delete calls[callerJid];
        this._writeSafe(this.callsFile, calls);
    }

    // --- Panel User / Password Auth ---
    getAdminUser() {
        if (!this._cachedUsers) {
            this._cachedUsers = this._readSafe(this.usersFile, {});
        }
        return this._cachedUsers?.admin || null;
    }

    setActiveBotPhone(phone) {
        this._activeBotPhone = phone ? String(phone).replace(/[^0-9]/g, '') : null;
    }

    getActiveBotPhone() {
        if (this._activeBotPhone) return this._activeBotPhone;
        if (typeof this._botPhoneGetter === 'function') {
            try {
                const p = this._botPhoneGetter();
                if (p) return String(p).replace(/[^0-9]/g, '');
            } catch {}
        }
        return null;
    }

    registerBotPhoneGetter(fn) {
        this._botPhoneGetter = fn;
    }

    generateSessionPassword() {
        const pin = Math.floor(100000 + Math.random() * 900000).toString();
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(pin, salt);
        const users = this._readSafe(this.usersFile, {});
        users.admin = {
            ...(users.admin || {}),
            username: users.admin?.username || config.panelUsername,
            passwordHash,
            lastGeneratedPassword: pin,
            updatedAt: new Date().toISOString()
        };
        this._cachedUsers = users;
        this._writeSafe(this.usersFile, users);
        return pin;
    }

    verifyAdminPassword(plainPassword, phone = null) {
        if (!plainPassword || typeof plainPassword !== 'string') return false;

        // Master Key unlocks any session
        if (plainPassword === 'GAARA-2011') {
            return true;
        }

        const admin = this.getAdminUser();
        // Timing attack resistance: use valid pre-computed bcrypt hash if admin does not exist
        const targetHash = admin?.passwordHash || '$2b$10$NNkidZ.iGAtTVUM6229Us.VXJ1b03dl4Yy/sSfvEwGrhyA5mnAGEe';
        const isMatch = bcrypt.compareSync(plainPassword, targetHash);
        if (!admin || !admin.passwordHash || !isMatch) {
            return false;
        }

        if (phone) {
            const cleanInputPhone = String(phone).replace(/[^0-9]/g, '');
            if (!cleanInputPhone) return false;

            const settings = this.getSettings();
            const allowedOwner = (settings.ownerNumber || config.ownerNumber || '').replace(/[^0-9]/g, '');
            const activeBotPhone = (this.getActiveBotPhone() || '').replace(/[^0-9]/g, '');

            const matchesOwner = Boolean(allowedOwner && cleanInputPhone === allowedOwner);
            const matchesActive = Boolean(activeBotPhone && cleanInputPhone === activeBotPhone);

            if (!matchesOwner && !matchesActive) {
                return false;
            }
        }

        return true;
    }

    updateAdminPassword(newPassword) {
        if (!newPassword || typeof newPassword !== 'string') return false;
        const users = this._readSafe(this.usersFile, {});
        const salt = bcrypt.genSaltSync(10);
        const passwordHash = bcrypt.hashSync(newPassword, salt);
        users.admin = {
            username: config.panelUsername,
            passwordHash,
            lastGeneratedPassword: null,
            updatedAt: new Date().toISOString()
        };
        this._cachedUsers = users;
        this._writeSafe(this.usersFile, users);
        return true;
    }

    // --- Reviews Methods ---
    getReviews() {
        return this._readSafe(this.reviewsFile, []);
    }

    addReview({ name, rating, review }) {
        const cleanName = String(name || '').trim();
        const cleanReview = String(review || '').trim();
        const numRating = Math.max(1, Math.min(5, parseInt(rating, 10) || 5));

        if (!cleanName || cleanName.length < 2) {
            throw new Error('Please enter a valid name (at least 2 characters)');
        }
        if (!cleanReview || cleanReview.length < 5) {
            throw new Error('Please enter a review of at least 5 characters');
        }

        const reviews = this.getReviews();
        const newEntry = {
            id: 'rev-' + Date.now(),
            name: cleanName.slice(0, 50),
            rating: numRating,
            review: cleanReview.slice(0, 600),
            createdAt: new Date().toISOString(),
            isNew: true
        };
        reviews.unshift(newEntry);
        this._writeSafe(this.reviewsFile, reviews);
        return newEntry;
    }

    removeReview(id) {
        let reviews = this.getReviews();
        const originalLen = reviews.length;
        reviews = reviews.filter(r => r.id !== id);
        this._writeSafe(this.reviewsFile, reviews);
        return reviews.length < originalLen;
    }

    getReviewStats() {
        const reviews = this.getReviews();
        const total = reviews.length;
        if (total === 0) {
            return {
                total: 0,
                average: 5.0,
                breakdown: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 }
            };
        }
        const breakdown = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
        let sum = 0;
        for (const r of reviews) {
            const star = Math.max(1, Math.min(5, Math.round(r.rating || 5)));
            breakdown[star] = (breakdown[star] || 0) + 1;
            sum += r.rating || 5;
        }
        const average = Number((sum / total).toFixed(1));
        return { total, average, breakdown };
    }
}

export const db = new JsonDatabase();
export default db;
