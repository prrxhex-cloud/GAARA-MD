import db from '../../config/database.js';
import config from '../../config/index.js';
import { validateMessage, extractText } from '../utils/antiBug.js';
import { cacheMessage, checkRateLimit } from './cache.js';
import { handleRevoke } from '../handlers/antiDelete.js';
import { handleStatusUpdate } from '../handlers/autoStatus.js';
import { handleAutoReply, getRandomJitter, sleep } from '../handlers/autoReply.js';
import { getCommand } from '../commands/index.js';
import { isOwner } from '../commands/owner.js';
import logger from '../utils/logger.js';

/**
 * Main WhatsApp message upsert dispatcher.
 */
export async function handleIncomingMessage(sock, msg) {
    try {
        if (!msg || !msg.key) return;

        // 1. Anti-Bug Protection: Drop malformed/crash stanzas
        const check = validateMessage(msg);
        if (!check.safe) {
            logger.warn({ reason: check.reason }, '[Handler] Dropped dangerous or malformed message');
            return;
        }

        // 2. Cache incoming message for Anti-Delete & View-Once recovery
        cacheMessage(msg);

        // 3. Revoke / Anti-Delete Check
        if (msg.message?.protocolMessage?.type === 0) {
            await handleRevoke(sock, msg);
            return;
        }

        // 4. Status Broadcast Check (Auto-Status View & Like)
        if (msg.key.remoteJid === 'status@broadcast') {
            await handleStatusUpdate(sock, msg);
            return;
        }

        // 5. Automatic View-Once Saver
        const settings = db.getSettings();
        if (settings.viewOnceSaver && !msg.key.fromMe) {
            const m = msg.message;
            const isVO = m?.viewOnceMessage || m?.viewOnceMessageV2 || m?.viewOnceMessageV2Extension ||
                         m?.imageMessage?.viewOnce || m?.videoMessage?.viewOnce || m?.audioMessage?.viewOnce;
            if (isVO) {
                logger.info({ sender: msg.key.remoteJid }, '[ViewOnce] Auto-saving View Once media to self');
                const selfJid = sock.user?.id ? (sock.parseJid ? sock.parseJid(sock.user.id) : sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
                if (selfJid) {
                    try {
                        const voContent = m?.viewOnceMessage?.message ||
                                          m?.viewOnceMessageV2?.message ||
                                          m?.viewOnceMessageV2Extension?.message ||
                                          m;
                        const mediaContainer = { key: msg.key, message: voContent };
                        const buffer = sock.downloadMedia
                            ? await sock.downloadMedia(mediaContainer)
                            : await sock.downloadMediaMessage(mediaContainer, 'buffer', {});

                        if (buffer) {
                            const senderNum = (msg.key.participant || msg.key.remoteJid).split('@')[0];
                            const innerCaption = voContent?.imageMessage?.caption || voContent?.videoMessage?.caption || '';
                            const caption = `╭───[ ⚡ VIEW-ONCE AUTO-SAVED ]\n│◇│\n│◇│  Sender: @${senderNum}\n${innerCaption ? `│◇│  Caption: ${innerCaption}\n` : ''}│◇│\n╰────────────────────\n\nTHIS BOT BUILT BY GAARA DEV OFC.`;

                            if (voContent?.imageMessage) {
                                await sock.sendMessage(selfJid, { image: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.videoMessage) {
                                await sock.sendMessage(selfJid, { video: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.audioMessage) {
                                await sock.sendMessage(selfJid, { audio: buffer, ptt: false });
                            }
                        }
                    } catch (voErr) {
                        logger.warn({ err: voErr.message }, '[ViewOnce] Auto-save error');
                    }
                }
            }
        }

        // 6. Extract text and identify prefix
        const rawText = extractText(msg).trim();
        if (!rawText) return;

        const remoteJid = msg.key.remoteJid;
        const sender = msg.key.participant || remoteJid;
        const prefix = settings.prefix || '.';

        // 7. Check if message is a command
        if (rawText.startsWith(prefix)) {
            // Anti-Spam Rate Limiter
            if (!checkRateLimit(sender)) {
                logger.warn({ sender }, '[Handler] Rate limit exceeded');
                return;
            }

            const cleanCmdLine = rawText.slice(prefix.length).trim();
            const parts = cleanCmdLine.split(/\s+/);
            const cmdName = parts[0]?.toLowerCase();
            const args = parts.slice(1);

            const cmd = getCommand(cmdName);
            if (cmd) {
                // Check Bot Mode (private vs public)
                if (settings.mode === 'private' && !isOwner(msg, sender)) {
                    await sock.sendMessage(remoteJid, { text: '🔒 Bot is currently in PRIVATE mode. Only the owner can execute commands.' }, { quoted: msg });
                    return;
                }

                logger.info({ cmd: cmdName, sender: sender.split('@')[0], isGroup: remoteJid.endsWith('@g.us') }, '[Command] Executing');

                // Anti-Ban Safeguard: Humanized Response Jitter (1.2s - 2.8s)
                const delay = getRandomJitter();
                await sleep(delay);

                try {
                    await cmd.run({ sock, msg, jid: remoteJid, args, sender, text: args.join(' ') });
                } catch (cmdErr) {
                    logger.error({ cmd: cmdName, err: cmdErr.message, stack: cmdErr.stack }, '[Command] Execution error');
                    await sock.sendMessage(remoteJid, { text: `❌ Command Error: ${cmdErr.message}` }, { quoted: msg });
                }
                return;
            }
        }

        // 8. If not a command, dispatch to Smart Auto-Reply
        await handleAutoReply(sock, msg);
    } catch (err) {
        logger.error({ err: err.message }, '[Handler] Fatal unhandled error in message handler');
    }
}
