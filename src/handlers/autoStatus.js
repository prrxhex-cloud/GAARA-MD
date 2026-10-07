import db from '../../config/database.js';
import logger from '../utils/logger.js';

/**
 * Automatically marks statuses as read and sends an emoji reaction.
 */
export async function handleStatusUpdate(sock, msg) {
    try {
        if (!msg || !msg.key || msg.key.remoteJid !== 'status@broadcast') return;

        const settings = db.getSettings();
        if (!settings.autoStatus) return;

        const participant = msg.key.participant;
        if (!participant) return;

        // 1. Mark status as read
        try {
            await sock.readMessages([msg.key]);
        } catch (readErr) {
            logger.debug({ err: readErr.message }, '[AutoStatus] Could not mark status read');
        }

        // 2. Auto-react with selected emoji
        const emoji = settings.autoStatusEmoji || '💖';
        try {
            if (sock.sendReaction) {
                await sock.sendReaction('status@broadcast', emoji, msg.key);
            } else {
                await sock.sendMessage(
                    'status@broadcast',
                    { react: { key: msg.key, text: emoji } },
                    { statusJidList: [participant] }
                );
            }
            logger.info({ participant: participant.split('@')[0], emoji }, '[AutoStatus] Viewed and liked status');
        } catch (reactErr) {
            logger.debug({ err: reactErr.message }, '[AutoStatus] Could not react to status');
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AutoStatus] Error processing status');
    }
}
