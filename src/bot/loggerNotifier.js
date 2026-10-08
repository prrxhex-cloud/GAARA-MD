import db from '../../config/database.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { formatFramedMessage, resolveDestinationJid, getBotAdReplyContext, wrapSocketWithBranding } from './format.js';
import logger from '../utils/logger.js';

/**
 * Dispatches bot events, status updates, and notifications
 * to the configured destination ('Self Chat' vs 'Same Chat').
 */
export async function dispatchBotLog(sock, { title = 'SYSTEM LOG', emoji = '📜', content = [], remoteJid = null, force = false }) {
    try {
        if (!sock) return;
        const socket = wrapSocketWithBranding(sock);
        const settings = db.getSettings();
        if (!force && settings.botLogs === false) return;

        const destinationChoice = settings.botLogsDestination || 'self';
        const targetJid = resolveDestinationJid(socket, remoteJid, destinationChoice);
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

        await socket.sendMessage(targetJid, {
            text,
            contextInfo: getBotAdReplyContext({ title: `${emoji} ${title}` })
        });
        logger.info({ title, destination: destinationChoice, targetJid }, '[BotLog] Dispatched bot notification');
    } catch (err) {
        logger.warn({ err: err.message, title }, '[BotLog] Failed to dispatch bot notification');
    }
}

export default dispatchBotLog;
