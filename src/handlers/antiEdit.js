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
        if (!msg) return;

        const inner = msg.message?.ephemeralMessage?.message || msg.message;
        const protocolMsg = inner?.protocolMessage;

        let targetKey = null;
        let editedMessage = null;

        if (protocolMsg && protocolMsg.type === 14) {
            targetKey = protocolMsg.key;
            editedMessage = protocolMsg.editedMessage?.message || protocolMsg.editedMessage;
        } else if (inner?.editedMessage) {
            targetKey = msg.key;
            editedMessage = inner.editedMessage?.message || inner.editedMessage;
        }

        if (!targetKey || !targetKey.id) return;

        // Skip bot's own edits
        if (targetKey.fromMe) return;

        const settings = db.getSettings();
        const cached = getCachedMessage(targetKey.id);
        const remoteJid = targetKey.remoteJid || cached?.remoteJid || msg.key?.remoteJid;
        const isStatus = remoteJid === 'status@broadcast';

        if (isStatus && !settings.statusAntiDelete && !settings.antiEdit) return;
        if (!isStatus && !settings.antiEdit) return;

        const originalText = cached ? extractText(cached.raw || { message: cached.message }) : '(Not found in cache)';
        const editedText = extractText({ message: editedMessage }) || '(No text content)';

        const senderJid = cached?.participant || targetKey.participant || (isStatus ? null : cached?.remoteJid) || (isStatus ? null : targetKey.remoteJid) || msg.key?.participant || msg.key?.remoteJid;
        const senderNum = senderJid ? senderJid.split('@')[0] : 'Unknown';
        const isGroup = remoteJid && remoteJid.endsWith('@g.us');
        const chatName = isStatus ? 'WhatsApp Status' : (isGroup ? `Group (${remoteJid.split('@')[0]})` : `Private Chat (+${senderNum})`);
        const origTime = cached?.timestamp ? new Date(cached.timestamp * 1000).toLocaleTimeString() : 'Unknown';
        const editTime = msg.messageTimestamp ? new Date(msg.messageTimestamp * 1000).toLocaleTimeString() : new Date().toLocaleTimeString();

        // Destination resolution ('self' vs 'same')
        const destinationChoice = isStatus
            ? (settings.statusDestination || settings.antiEditDestination || 'self')
            : (settings.antiEditDestination || 'self');
        const targetJid = resolveDestinationJid(sock, remoteJid, destinationChoice, senderJid);
        if (!targetJid) return;

        logger.info({ id: targetKey.id, sender: senderNum, isStatus, destination: destinationChoice }, '[AntiEdit] Message edit detected and recovered');

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
            mentions: senderJid ? [senderJid] : []
        });

        // Update the cached entry with edited content
        if (cached) {
            cached.message = editedMessage;
            if (cached.raw) cached.raw.message = editedMessage;
            messageCache.set(targetKey.id, cached);
        } else {
            messageCache.set(targetKey.id, {
                id: targetKey.id,
                key: targetKey,
                remoteJid,
                participant: senderJid,
                pushName: 'User',
                timestamp: msg.messageTimestamp || Math.floor(Date.now() / 1000),
                message: editedMessage,
                raw: { key: targetKey, message: editedMessage }
            });
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AntiEdit] Error handling edited message');
    }
}
