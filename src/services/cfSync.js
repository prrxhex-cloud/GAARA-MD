import dns from 'node:dns';
import db from '../../config/database.js';
import config from '../../config/index.js';
import logger from '../utils/logger.js';

// Prioritize IPv4 for resilient Cloudflare edge connections
try {
    dns.setDefaultResultOrder?.('ipv4first');
} catch {}

const CF_WORKER_URL = process.env.CF_WORKER_URL || 'https://ofc.sayurusenavirathna70.workers.dev';
const CF_API_TOKEN = process.env.CF_API_TOKEN || config.jwtSecret || 'gaara_x_md_secure_token_secret_key_2026';

function getHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CF_API_TOKEN}`
    };
}

async function safeJson(res) {
    if (!res || !res.ok) return null;
    const contentType = res.headers?.get('content-type') || '';
    if (!contentType.includes('application/json')) return null;
    try {
        return await res.json();
    } catch {
        return null;
    }
}

/**
 * Cloudflare D1 Synchronization Service.
 * Implements persistent cloud backup & restore across restarts, re-pairs, and redeploys.
 * Persistence Policy: Data is NEVER purged from D1 on disconnect/logout; automatically restored by phone.
 */
export const cfSync = {
    /**
     * Restores settings, schedules, and replies for a given phone number from Cloudflare D1.
     */
    async syncFromCloudflare(phoneNumber) {
        if (!phoneNumber) return { success: false, reason: 'No phone number provided' };
        const cleanPhone = phoneNumber.replace(/[^0-9]/g, '');
        if (!cleanPhone) return { success: false, reason: 'Invalid phone number' };

        try {
            logger.info({ phone: cleanPhone }, '[CFSync] Pulling persistent data from Cloudflare D1...');

            // 1. Fetch Settings
            let restoredSettings = null;
            try {
                const settingsRes = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/settings`, {
                    headers: getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });

                const sData = await safeJson(settingsRes);
                if (sData && sData.success && sData.settings) {
                    restoredSettings = sData.settings;
                    db.updateSettings(restoredSettings);
                    logger.info({ phone: cleanPhone }, '[CFSync] Successfully restored settings from Cloudflare D1');
                }
            } catch (sErr) {
                logger.debug({ err: sErr.message }, '[CFSync] Settings pull skipped');
            }

            // 2. Fetch Schedules
            try {
                const schedRes = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/schedules`, {
                    headers: getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });

                const scData = await safeJson(schedRes);
                if (scData && scData.success && Array.isArray(scData.schedules) && scData.schedules.length > 0) {
                    const local = db.getSchedules();
                    const existingIds = new Set(local.map(s => s.id));
                    for (const item of scData.schedules) {
                        if (!existingIds.has(item.id)) {
                            db.addSchedule(item);
                        }
                    }
                }
            } catch (scErr) {
                logger.debug({ err: scErr.message }, '[CFSync] Schedules pull skipped');
            }

            // 3. Fetch Custom Replies
            try {
                const repliesRes = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/replies`, {
                    headers: getHeaders(),
                    signal: AbortSignal.timeout(6000)
                });

                const rData = await safeJson(repliesRes);
                if (rData && rData.success && Array.isArray(rData.replies) && rData.replies.length > 0) {
                    const localReplies = db.getReplies();
                    const existingTriggers = new Set(localReplies.map(r => r.trigger.toLowerCase()));
                    for (const rep of rData.replies) {
                        if (!existingTriggers.has(rep.trigger.toLowerCase())) {
                            db.addReply(rep.trigger, rep.response, rep.matchType || 'contains');
                        }
                    }
                }
            } catch (rErr) {
                logger.debug({ err: rErr.message }, '[CFSync] Replies pull skipped');
            }

            return { success: true, restored: !!restoredSettings };
        } catch (err) {
            logger.warn({ err: err.message }, '[CFSync] Cloudflare sync pull skipped (offline or timeout)');
            return { success: false, error: err.message };
        }
    },

    /**
     * Pushes current local state (settings, schedules, replies) to Cloudflare D1.
     */
    async syncToCloudflare(phoneNumber) {
        const rawPhone = phoneNumber || db.getSettings().ownerNumber || config.ownerNumber;
        if (!rawPhone) return { success: false, reason: 'No phone number provided' };
        const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        if (!cleanPhone) return { success: false, reason: 'Invalid phone' };

        try {
            await Promise.allSettled([
                this.saveSettingsToCloudflare(cleanPhone, db.getSettings()),
                this.saveSchedulesToCloudflare(cleanPhone, db.getSchedules()),
                this.saveRepliesToCloudflare(cleanPhone, db.getReplies())
            ]);
            return { success: true };
        } catch (err) {
            logger.warn({ err: err.message }, '[CFSync] Failed to push complete sync to Cloudflare D1');
            return { success: false, error: err.message };
        }
    },

    async saveSettingsToCloudflare(phoneNumber, settings) {
        const rawPhone = phoneNumber || db.getSettings().ownerNumber || config.ownerNumber;
        if (!rawPhone) return false;
        const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        try {
            const res = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/settings`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(settings),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            logger.debug({ err: err.message }, '[CFSync] Settings push to D1 skipped');
            return false;
        }
    },

    async saveSchedulesToCloudflare(phoneNumber, schedules) {
        const rawPhone = phoneNumber || db.getSettings().ownerNumber || config.ownerNumber;
        if (!rawPhone) return false;
        const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        try {
            const res = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/schedules`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(schedules),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            logger.debug({ err: err.message }, '[CFSync] Schedules push to D1 skipped');
            return false;
        }
    },

    async saveRepliesToCloudflare(phoneNumber, replies) {
        const rawPhone = phoneNumber || db.getSettings().ownerNumber || config.ownerNumber;
        if (!rawPhone) return false;
        const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
        try {
            const res = await fetch(`${CF_WORKER_URL}/api/user/${cleanPhone}/replies`, {
                method: 'POST',
                headers: getHeaders(),
                body: JSON.stringify(replies),
                signal: AbortSignal.timeout(5000)
            });
            return res.ok;
        } catch (err) {
            logger.debug({ err: err.message }, '[CFSync] Replies push to D1 skipped');
            return false;
        }
    },

    async fetchSecretsFromCloudflare() {
        try {
            const res = await fetch(`${CF_WORKER_URL}/api/secrets`, {
                headers: getHeaders(),
                signal: AbortSignal.timeout(5000)
            });
            const data = await safeJson(res);
            return data?.secrets || [];
        } catch (err) {
            logger.debug({ err: err.message }, '[CFSync] Fetch secrets from D1 skipped');
            return [];
        }
    }
};

export default cfSync;
