import db from '../../config/database.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { getCachedMessage } from '../bot/cache.js';
import { formatFramedMessage, resolveDestinationJid } from '../bot/format.js';
import { extractText } from '../utils/antiBug.js';
import logger from '../utils/logger.js';

/**
 * Handles incoming revoked (deleted) messages and status updates,
 * recovering text and media to the configured destination ('Self Chat' vs 'Same Chat').
 */
export async function handleRevoke(sock, msg) {
    try {
        const protocolMsg = msg.message?.protocolMessage;
        if (!protocolMsg || protocolMsg.type !== 0) return; // 0 = REVOKE

        const settings = db.getSettings();
        const revokedKey = protocolMsg.key;
        if (!revokedKey || !revokedKey.id) return;

        // If revoked by bot itself, don't notify
        if (revokedKey.fromMe) return;

        const isStatus = revokedKey.remoteJid === 'status@broadcast';
        if (isStatus && !settings.statusAntiDelete) return;
        if (!isStatus && !settings.antiDelete) return;

        const cached = getCachedMessage(revokedKey.id);
        if (!cached) {
            logger.debug({ id: revokedKey.id }, '[AntiDelete] Revoked message not found in cache');
            return;
        }

        // Determine destination based on event type
        const destinationChoice = isStatus
            ? (settings.statusDestination || 'self')
            : (settings.antiDeleteDestination || (settings.antiDeleteNotifySelf === false ? 'same' : 'self'));

        const senderJid = cached.participant || cached.remoteJid;
        const targetJid = resolveDestinationJid(sock, cached.remoteJid, destinationChoice, senderJid);
        if (!targetJid) return;

        const senderNum = senderJid ? senderJid.split('@')[0] : 'Unknown';
        const isGroup = cached.remoteJid.endsWith('@g.us');
        const chatName = isStatus ? 'WhatsApp Status' : isGroup ? `Group (${cached.remoteJid.split('@')[0]})` : `Private Chat (+${senderNum})`;
        const sentTime = cached.timestamp ? new Date(cached.timestamp * 1000).toLocaleTimeString() : 'Unknown';

        const textContent = extractText(cached.raw);
        const inner = cached.message || {};

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
            mentions: [senderJid]
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
