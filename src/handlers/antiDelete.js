import db from '../../config/database.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { getCachedMessage, unwrapMessage } from '../bot/cache.js';
import { formatFramedMessage, resolveDestinationJid, getBotAdReplyContext } from '../bot/format.js';
import { extractText } from '../utils/antiBug.js';
import logger from '../utils/logger.js';

/**
 * Handles incoming revoked (deleted) messages and status updates,
 * recovering text and media to the configured destination ('Self Chat' vs 'Same Chat').
 */
export async function handleRevoke(sock, msg) {
    try {
        if (!msg) return;

        const msgContent = msg.message?.ephemeralMessage?.message || msg.message;
        const protocolMsg = msgContent?.protocolMessage;

        let revokedKey = null;
        if (protocolMsg && protocolMsg.type === 0) {
            revokedKey = protocolMsg.key;
        } else if (msg.key && msg.key.id) {
            revokedKey = msg.key;
        }

        if (!revokedKey || !revokedKey.id) return;

        // If revoked by bot itself, don't notify
        if (revokedKey.fromMe) return;

        const settings = db.getSettings();
        const cached = getCachedMessage(revokedKey.id);
        if (!cached) {
            logger.debug({ id: revokedKey.id }, '[AntiDelete] Revoked message not found in cache');
            return;
        }

        // Do not notify if original message was from the bot itself
        if (cached.fromMe && (revokedKey.fromMe || !revokedKey.participant)) return;

        const remoteJid = cached.remoteJid || revokedKey.remoteJid;
        const isStatus = remoteJid === 'status@broadcast' || revokedKey.remoteJid === 'status@broadcast';
        if (isStatus && !settings.statusAntiDelete) return;
        if (!isStatus && !settings.antiDelete) return;

        // Determine destination based on event type
        const destinationChoice = isStatus
            ? (settings.statusDestination || 'self')
            : (settings.antiDeleteDestination || (settings.antiDeleteNotifySelf === false ? 'same' : 'self'));

        const senderJid = cached.participant || revokedKey.participant || remoteJid;
        let targetJid = resolveDestinationJid(sock, remoteJid, destinationChoice, senderJid);
        if (!targetJid) {
            targetJid = destinationChoice === 'same' ? remoteJid : null;
        }
        if (!targetJid) return;

        const senderNum = senderJid ? senderJid.split('@')[0] : 'Unknown';
        const isGroup = cached.remoteJid.endsWith('@g.us');
        const chatName = isStatus ? 'WhatsApp Status' : isGroup ? `Group (${cached.remoteJid.split('@')[0]})` : `Private Chat (+${senderNum})`;
        const sentTime = cached.timestamp ? new Date(cached.timestamp * 1000).toLocaleTimeString() : 'Unknown';

        const textContent = extractText(cached.raw || { message: cached.message });
        const inner = unwrapMessage(cached.message || cached.raw) || {};

        let mediaType = null;
        if (inner.imageMessage) mediaType = 'image';
        else if (inner.videoMessage) mediaType = 'video';
        else if (inner.audioMessage) mediaType = 'audio';
        else if (inner.stickerMessage) mediaType = 'sticker';
        else if (inner.documentMessage) mediaType = 'document';

        logger.info({ id: revokedKey.id, sender: senderNum, mediaType, destination: destinationChoice }, '[AntiDelete] Message recovered from cache');

        const noticeText = formatFramedMessage([
            {
                title: '[ 🛡️ ANTI DELETE ]',
                content: [
                    `👤 *Sender:* @${senderNum} (${cached.pushName || 'No Name'})`,
                    `💬 *Chat:* ${chatName}`,
                    `🕒 *Sent At:* ${sentTime}`,
                    `📦 *Type:* ${mediaType ? mediaType.toUpperCase() : 'Text Message'}`,
                    ``,
                    textContent ? `📝 *Content:*\n${textContent}` : `*(No text content)*`
                ]
            }
        ], {
            header: settings.headerTitle || SUPPORT_HEADER,
            footer: settings.footerText || BOT_FOOTER
        });

        // Send text recovery notice
        await sock.sendMessage(targetJid, {
            text: noticeText,
            mentions: [senderJid],
            contextInfo: getBotAdReplyContext()
        });

        // If it was a media message, attempt downloading and forwarding media
        if (mediaType && (sock.downloadMedia || sock.downloadMediaMessage)) {
            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia(cached.raw)
                    : await sock.downloadMediaMessage(cached.raw, 'buffer', {});

                if (buffer && Buffer.isBuffer(buffer)) {
                    const mediaCaption = formatFramedMessage([
                        {
                            title: '[ 📷 MEDIA RECOVERED ]',
                            content: [
                                `👤 *Sender:* @${senderNum}`,
                                `💬 *Chat:* ${chatName}`,
                                `📦 *Media Type:* ${mediaType.toUpperCase()}`,
                                textContent ? `📝 *Caption:* ${textContent}` : ''
                            ].filter(Boolean)
                        }
                    ], {
                        header: settings.headerTitle || SUPPORT_HEADER,
                        footer: settings.footerText || BOT_FOOTER
                    });

                    if (mediaType === 'image') {
                        await sock.sendMessage(targetJid, { image: buffer, caption: mediaCaption, mentions: [senderJid] });
                    } else if (mediaType === 'video') {
                        await sock.sendMessage(targetJid, { video: buffer, caption: mediaCaption, mentions: [senderJid] });
                    } else if (mediaType === 'audio') {
                        await sock.sendMessage(targetJid, { audio: buffer, ptt: inner.audioMessage?.ptt || false });
                    } else if (mediaType === 'sticker') {
                        await sock.sendMessage(targetJid, { sticker: buffer });
                    } else if (mediaType === 'document') {
                        await sock.sendMessage(targetJid, {
                            document: buffer,
                            fileName: inner.documentMessage?.fileName || 'recovered_file',
                            mimetype: inner.documentMessage?.mimetype || 'application/octet-stream'
                        });
                    }
                }
            } catch (mediaErr) {
                logger.warn({ err: mediaErr.message }, '[AntiDelete] Could not download media for revoked message');
            }
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AntiDelete] Error handling revoke');
    }
}
