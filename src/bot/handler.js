import db from '../../config/database.js';
import config from '../../config/index.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { validateMessage, extractText } from '../utils/antiBug.js';
import { cacheMessage, checkRateLimit } from './cache.js';
import { handleRevoke } from '../handlers/antiDelete.js';
import { handleEdit } from '../handlers/antiEdit.js';
import { handleStatusUpdate } from '../handlers/autoStatus.js';
import { handleAutoReply, getRandomJitter, sleep } from '../handlers/autoReply.js';
import { formatFramedMessage, resolveDestinationJid } from './format.js';
import { getCommand } from '../commands/index.js';
import { isOwner } from '../commands/owner.js';
import { dispatchBotLog } from './loggerNotifier.js';
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

        // 2. Cache incoming message for Anti-Delete, Anti-Edit & View-Once recovery
        cacheMessage(msg);

        // 3. Revoke / Anti-Delete Check (protocolMessage.type === 0)
        if (msg.message?.protocolMessage?.type === 0) {
            await handleRevoke(sock, msg);
            return;
        }

        // 4. Edit / Anti-Edit Check (protocolMessage.type === 14)
        if (msg.message?.protocolMessage?.type === 14) {
            await handleEdit(sock, msg);
            return;
        }

        // 5. Status Broadcast Check (Auto-Status View & Like)
        if (msg.key.remoteJid === 'status@broadcast') {
            await handleStatusUpdate(sock, msg);
            return;
        }

        // 6. Automatic View-Once Saver
        const settings = db.getSettings();
        if (settings.viewOnceSaver && !msg.key.fromMe) {
            const m = msg.message;
            const isVO = m?.viewOnceMessage || m?.viewOnceMessageV2 || m?.viewOnceMessageV2Extension ||
                         m?.imageMessage?.viewOnce || m?.videoMessage?.viewOnce || m?.audioMessage?.viewOnce;
            if (isVO) {
                const destinationChoice = settings.viewOnceDestination || 'self';
                const targetJid = resolveDestinationJid(sock, msg.key.remoteJid, destinationChoice);

                if (targetJid) {
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
                            const isGroup = msg.key.remoteJid.endsWith('@g.us');
                            const chatName = isGroup ? `Group (${msg.key.remoteJid.split('@')[0]})` : `Private Chat (+${senderNum})`;
                            const innerCaption = voContent?.imageMessage?.caption || voContent?.videoMessage?.caption || '';
                            const mediaKind = voContent?.imageMessage ? 'IMAGE' : voContent?.videoMessage ? 'VIDEO' : 'AUDIO';

                            const caption = formatFramedMessage([
                                {
                                    title: '[ 📷 MEDIA RECOVERED ]',
                                    content: [
                                        `👤 *Sender:* @${senderNum}`,
                                        `💬 *Chat:* ${chatName}`,
                                        `📦 *Type:* VIEW-ONCE ${mediaKind}`,
                                        innerCaption ? `📝 *Caption:* ${innerCaption}` : ''
                                    ].filter(Boolean)
                                }
                            ], {
                                header: settings.headerTitle || SUPPORT_HEADER,
                                footer: settings.footerText || BOT_FOOTER
                            });

                            if (voContent?.imageMessage) {
                                await sock.sendMessage(targetJid, { image: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.videoMessage) {
                                await sock.sendMessage(targetJid, { video: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.audioMessage) {
                                await sock.sendMessage(targetJid, { audio: buffer, ptt: false });
                            }
                            logger.info({ sender: senderNum, destination: destinationChoice }, '[ViewOnce] Auto-saved View Once media');
                        }
                    } catch (voErr) {
                        logger.warn({ err: voErr.message }, '[ViewOnce] Auto-save error');
                    }
                }
            }
        }

        // 7. Extract text and identify prefix
        const rawText = extractText(msg).trim();
        if (!rawText) return;

        const remoteJid = msg.key.remoteJid;
        const sender = msg.key.participant || remoteJid;
        const prefix = settings.prefix || '.';

        // 8. Check if message is a command
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
                // Check Bot Modes: 'public', 'private', 'groups', 'inbox'
                const mode = (settings.mode || 'public').toLowerCase();
                const isSenderOwner = isOwner(msg, sender);
                const isGroupChat = remoteJid.endsWith('@g.us');

                if (!isSenderOwner) {
                    if (mode === 'private') {
                        await sock.sendMessage(remoteJid, { text: '🔒 Bot is currently in PRIVATE mode. Only the owner can execute commands.' }, { quoted: msg });
                        return;
                    }
                    if (mode === 'groups' || mode === 'groups only') {
                        if (!isGroupChat) {
                            await sock.sendMessage(remoteJid, { text: '🔒 Bot is currently in GROUPS ONLY mode. Commands are disabled in private chats.' }, { quoted: msg });
                            return;
                        }
                    }
                    if (mode === 'inbox' || mode === 'inbox only') {
                        if (isGroupChat) {
                            await sock.sendMessage(remoteJid, { text: '🔒 Bot is currently in INBOX ONLY mode. Commands are disabled in groups.' }, { quoted: msg });
                            return;
                        }
                    }
                }

                logger.info({ cmd: cmdName, sender: sender.split('@')[0], isGroup: isGroupChat, mode }, '[Command] Executing');

                // Snappy response dispatch with minimal anti-flood guard (0 - 80ms)
                const delay = Math.min(getRandomJitter(30, 80), 80);
                if (delay > 0) {
                    await sleep(delay);
                }

                try {
                    await cmd.run({ sock, msg, jid: remoteJid, args, sender, text: args.join(' ') });
                } catch (cmdErr) {
                    logger.error({ cmd: cmdName, err: cmdErr.message, stack: cmdErr.stack }, '[Command] Execution error');
                    await sock.sendMessage(remoteJid, { text: `❌ Command Error: ${cmdErr.message}` }, { quoted: msg });
                    dispatchBotLog(sock, {
                        title: 'COMMAND ERROR',
                        emoji: '⚠️',
                        remoteJid,
                        content: [
                            `❌ *Command Error:* .${cmdName}`,
                            `👤 *Sender:* @${sender.split('@')[0]}`,
                            `💬 *Chat:* ${remoteJid.endsWith('@g.us') ? 'Group' : 'Private'}`,
                            `⚠️ *Details:* ${cmdErr.message}`
                        ]
                    }).catch(() => {});
                }
                return;
            }
        }

        // 9. If not a command, dispatch to Smart Auto-Reply
        await handleAutoReply(sock, msg);
    } catch (err) {
        logger.error({ err: err.message }, '[Handler] Fatal unhandled error in message handler');
    }
}
