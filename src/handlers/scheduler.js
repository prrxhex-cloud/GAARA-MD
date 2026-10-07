import db from '../../config/database.js';
import logger from '../utils/logger.js';

let schedulerInterval = null;

/**
 * Initializes and starts the background scheduler runner.
 */
export function startScheduler(sock) {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
    }

    schedulerInterval = setInterval(async () => {
        try {
            await runScheduledJobs(sock);
        } catch (err) {
            logger.error({ err: err.message }, '[Scheduler] Error in scheduler loop');
        }
    }, 20000); // Check every 20 seconds

    logger.info('[Scheduler] Background message scheduler started');
}

export function stopScheduler() {
    if (schedulerInterval) {
        clearInterval(schedulerInterval);
        schedulerInterval = null;
    }
}

/**
 * Checks and executes pending scheduled messages.
 */
async function runScheduledJobs(sock) {
    if (!sock || !sock.user) return; // Only run if socket is connected

    const schedules = db.getSchedules().filter(s => s.active);
    const now = new Date();
    const currentTimestamp = now.getTime();
    const currentHours = String(now.getHours()).padStart(2, '0');
    const currentMinutes = String(now.getMinutes()).padStart(2, '0');
    const currentTimeStr = `${currentHours}:${currentMinutes}`;
    const todayDateStr = now.toISOString().slice(0, 10);

    for (const job of schedules) {
        let shouldRun = false;

        if (job.type === 'once') {
            const targetTime = typeof job.time === 'number' ? job.time : new Date(job.time).getTime();
            if (!isNaN(targetTime) && currentTimestamp >= targetTime) {
                shouldRun = true;
            }
        } else if (job.type === 'daily') {
            if (job.time === currentTimeStr && job.lastRun !== todayDateStr) {
                shouldRun = true;
            }
        }

        if (shouldRun) {
            logger.info({ id: job.id, to: job.jid, type: job.type }, '[Scheduler] Executing scheduled message');

            try {
                let targetJid = job.jid;
                if (!targetJid.includes('@')) {
                    targetJid = `${targetJid}@s.whatsapp.net`;
                }

                await sock.sendMessage(targetJid, { text: job.message });

                if (job.type === 'once') {
                    db.updateSchedule(job.id, { active: false, executedAt: new Date().toISOString() });
                } else if (job.type === 'daily') {
                    db.updateSchedule(job.id, { lastRun: todayDateStr, lastExecutedAt: new Date().toISOString() });
                }
            } catch (sendErr) {
                logger.error({ id: job.id, err: sendErr.message }, '[Scheduler] Failed to send scheduled message');
            }
        }
    }
}
