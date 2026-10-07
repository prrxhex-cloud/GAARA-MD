import db from '../../config/database.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { formatFramedMessage, resolveDestinationJid } from './format.js';
import logger from '../utils/logger.js';

/**
 * Dispatches bot events, status updates, and notifications
 * to the configured destination ('Self Chat' vs 'Same Chat').
 */
export async function dispatchBotLog(sock, { title = 'SYSTEM LOG', emoji = '📜', content = [], remoteJid = null, force = false }) {
    try {
        if (!sock) return;
        const settings = db.getSettings();
        if (!force && settings.botLogs === false) return;

        const destinationChoice = settings.botLogsDestination || 'self';
        const targetJid = resolveDestinationJid(sock, remoteJid, destinationChoice);
        if (!targetJid) return;

        const text = formatFramedMessage([
            {
                emoji,
                title: `[ ${emoji} ${title} ]`,
                content
            }
        ], {
            header: settings.headerTitle || SUPPORT_HEADER,
            footer: settings.footerText || BOT_FOOTER
        });

        await sock.sendMessage(targetJid, { text });
        logger.info({ title, destination: destinationChoice, targetJid }, '[BotLog] Dispatched bot notification');
    } catch (err) {
        logger.warn({ err: err.message, title }, '[BotLog] Failed to dispatch bot notification');
    }
}

export default dispatchBotLog;
