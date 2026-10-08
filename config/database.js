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

    verifyAdminPassword(plainPassword) {
        if (!plainPassword || typeof plainPassword !== 'string') return false;
        const admin = this.getAdminUser();
        // Timing attack resistance: use valid pre-computed bcrypt hash if admin does not exist
        const targetHash = admin?.passwordHash || '$2b$10$NNkidZ.iGAtTVUM6229Us.VXJ1b03dl4Yy/sSfvEwGrhyA5mnAGEe';
        const isMatch = bcrypt.compareSync(plainPassword, targetHash);
        return Boolean(admin && admin.passwordHash && isMatch);
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
}

export const db = new JsonDatabase();
export default db;
