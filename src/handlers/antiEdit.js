import db from '../../config/database.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { getCachedMessage, messageCache } from '../bot/cache.js';
import { formatFramedMessage, resolveDestinationJid } from '../bot/format.js';
import { extractText } from '../utils/antiBug.js';
import logger from '../utils/logger.js';

/**
 * Handles incoming edited messages (protocolMessage.type === 14).
 * Compares original cached message with edited version and posts to configured destination.
 */
export async function handleEdit(sock, msg) {
    try {
        const protocolMsg = msg.message?.protocolMessage;
        if (!protocolMsg || protocolMsg.type !== 14) return; // 14 = MESSAGE_EDIT

        const settings = db.getSettings();
        if (!settings.antiEdit) return;

        const targetKey = protocolMsg.key;
        if (!targetKey || !targetKey.id) return;

        // Skip bot's own edits
        if (targetKey.fromMe) return;

        const cached = getCachedMessage(targetKey.id);
        const originalText = cached ? extractText(cached.raw || { message: cached.message }) : '(Not found in cache)';
        const editedText = extractText({ message: protocolMsg.editedMessage }) || '(No text content)';

        const senderJid = cached?.participant || targetKey.participant || cached?.remoteJid || targetKey.remoteJid || msg.key.participant || msg.key.remoteJid;
        const senderNum = senderJid ? senderJid.split('@')[0] : 'Unknown';
        const remoteJid = targetKey.remoteJid || cached?.remoteJid || msg.key.remoteJid;
        const isGroup = remoteJid && remoteJid.endsWith('@g.us');
        const chatName = isGroup ? `Group (${remoteJid.split('@')[0]})` : `Private Chat (+${senderNum})`;
        const origTime = cached?.timestamp ? new Date(cached.timestamp * 1000).toLocaleTimeString() : 'Unknown';
        const editTime = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();

        // Destination resolution ('self' vs 'same')
        const destinationChoice = settings.antiEditDestination || 'self';
        const targetJid = resolveDestinationJid(sock, remoteJid, destinationChoice);
        if (!targetJid) return;

        logger.info({ id: targetKey.id, sender: senderNum, destination: destinationChoice }, '[AntiEdit] Message edit detected and recovered');

        const noticeText = formatFramedMessage([
            {
                title: '[ ✏️ MESSAGE EDITED ]',
                content: [
                    `👤 *Sender:* @${senderNum} (${cached?.pushName || 'User'})`,
                    `💬 *Chat:* ${chatName}`,
                    `🕒 *Original Time:* ${origTime}`,
                    `🕒 *Edited Time:* ${editTime}`,
                    ``,
                    `📝 *Original Message:*`,
                    originalText,
                    ``,
                    `✏️ *Edited Message:*`,
                    editedText
                ]
            }
        ], {
            header: settings.headerTitle || SUPPORT_HEADER,
            footer: settings.footerText || BOT_FOOTER
        });

        await sock.sendMessage(targetJid, {
            text: noticeText,
            mentions: [senderJid]
        });

        // Update the cached entry with edited content
        if (cached) {
            cached.message = protocolMsg.editedMessage;
            if (cached.raw) cached.raw.message = protocolMsg.editedMessage;
            messageCache.set(targetKey.id, cached);
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AntiEdit] Error handling edited message');
    }
}
