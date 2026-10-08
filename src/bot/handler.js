import { makeVoidExtrasSocket } from '@sasa-dev/void-baileys';
import db from '../../config/database.js';
import config from '../../config/index.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { validateMessage, extractText } from '../utils/antiBug.js';
import { cacheMessage, checkRateLimit, unwrapMessage } from './cache.js';
import { handleRevoke } from '../handlers/antiDelete.js';
import { handleEdit } from '../handlers/antiEdit.js';
import { handleStatusUpdate } from '../handlers/autoStatus.js';
import { handleAutoReply } from '../handlers/autoReply.js';
import { formatFramedMessage, resolveDestinationJid, getBotAdReplyContext } from './format.js';
import { getCommand } from '../commands/index.js';
import { isOwner } from '../commands/owner.js';
import { dispatchBotLog } from './loggerNotifier.js';
import { extractButtonPayload, handleSettingsButtonAction } from './buttons.js';
import logger from '../utils/logger.js';

/**
 * Normalizes incoming text and tapped button display text by stripping outer brackets
 * and leading emojis/symbols (e.g. '🌸 ALIVE' -> 'alive', '⚡ PING' -> 'ping', '👑 OWNER' -> 'owner').
 * Returns the resolved command and arguments, or null if no command matches.
 */
export function normalizeCommandTrigger(text, prefix = '.') {
    if (!text || typeof text !== 'string') return null;
    let trimmed = text.trim();
    if (!trimmed) return null;

    // 1. Remove surrounding brackets e.g. [ 🌸 ALIVE ] -> 🌸 ALIVE
    trimmed = trimmed.replace(/^\[\s*/, '').replace(/\s*\]$/, '').trim();

    // 2. If it starts with the bot prefix (e.g. .alive, . 🌸 alive, .ping)
    if (trimmed.startsWith(prefix)) {
        let afterPrefix = trimmed.slice(prefix.length).trim();
        // Strip any leading emojis or decorative symbols after prefix
        afterPrefix = afterPrefix.replace(/^[\p{Extended_Pictographic}\p{Emoji}\uFE0F\u200D\s\-_–—•▪️▫️▶️◀️⏩⏪✨🌟⚡🌸👑🛠️⚙️🛡️✏️🔓🔒🌐👥📩💖📜💡🎉📱📷🤖/\\#*~`!]+/u, '').trim();
        const parts = afterPrefix.split(/\s+/);
        const cmdName = parts[0]?.toLowerCase();
        const args = parts.slice(1);
        const cmd = getCommand(cmdName);
        if (cmd) {
            return { cmd, cmdName, args, fullText: afterPrefix };
        }
    }

    // 3. If it does not start with prefix (e.g. tapped button text like '🌸 ALIVE', '⚡ PING', '👑 OWNER', or direct text 'alive')
    let cleanedNoPrefix = trimmed.replace(/^[\p{Extended_Pictographic}\p{Emoji}\uFE0F\u200D\s\-_–—•▪️▫️▶️◀️⏩⏪✨🌟⚡🌸👑🛠️⚙️🛡️✏️🔓🔒🌐👥📩💖📜💡🎉📱📷🤖/\\#*~`!]+/u, '').trim();
    const parts = cleanedNoPrefix.split(/\s+/);
    const candidateCmd = parts[0]?.toLowerCase();
    const args = parts.slice(1);
    const cmd = getCommand(candidateCmd);
    if (cmd) {
        return { cmd, cmdName: candidateCmd, args, fullText: cleanedNoPrefix };
    }

    return null;
}

/**
 * Main WhatsApp message upsert dispatcher.
 */
export async function handleIncomingMessage(sock, msg) {
    try {
        if (!msg || !msg.key) return;

        // Wrap socket with void-baileys native power features if not already wrapped and has event emitter
        let socket = sock;
        if (typeof sock.sendButton !== 'function' && (sock?.ev || sock?.ws)) {
            try {
                socket = makeVoidExtrasSocket(sock);
            } catch {}
        }

        // 1. Anti-Bug Protection: Drop malformed/crash stanzas
        const check = validateMessage(msg);
        if (!check.safe) {
            logger.warn({ reason: check.reason }, '[Handler] Dropped dangerous or malformed message');
            return;
        }

        // Unpack ephemeral wrapper for protocol, media & button inspection
        const innerMsg = msg.message?.ephemeralMessage?.message || msg.message;

        // 2. Cache incoming message for Anti-Delete, Anti-Edit & View-Once recovery
        cacheMessage(msg);

        // 3. Revoke / Anti-Delete Check (protocolMessage.type === 0, including ephemeral)
        const protoMsg = innerMsg?.protocolMessage;
        if (protoMsg?.type === 0) {
            await handleRevoke(socket, msg);
            return;
        }

        // 4. Edit / Anti-Edit Check (protocolMessage.type === 14 or editedMessage, including ephemeral)
        if (protoMsg?.type === 14 || innerMsg?.editedMessage) {
            await handleEdit(socket, msg);
            return;
        }

        // 5. Status Broadcast Check (Auto-Status View & Like)
        if (msg.key.remoteJid === 'status@broadcast') {
            await handleStatusUpdate(socket, msg);
            return;
        }

        // 6. Automatic View-Once Saver (including ephemeral wrapper)
        const settings = db.getSettings();
        if (settings.viewOnceSaver && !msg.key.fromMe) {
            let curr = msg.message;
            let isVO = false;
            while (curr) {
                if (curr.ephemeralMessage?.message) {
                    curr = curr.ephemeralMessage.message;
                } else if (curr.deviceSentMessage?.message) {
                    curr = curr.deviceSentMessage.message;
                } else if (curr.documentWithCaptionMessage?.message) {
                    curr = curr.documentWithCaptionMessage.message;
                } else if (curr.viewOnceMessage?.message) {
                    curr = curr.viewOnceMessage.message;
                    isVO = true;
                } else if (curr.viewOnceMessageV2?.message) {
                    curr = curr.viewOnceMessageV2.message;
                    isVO = true;
                } else if (curr.viewOnceMessageV2Extension?.message) {
                    curr = curr.viewOnceMessageV2Extension.message;
                    isVO = true;
                } else {
                    break;
                }
            }

            if (!isVO && (curr?.imageMessage?.viewOnce || curr?.videoMessage?.viewOnce || curr?.audioMessage?.viewOnce)) {
                isVO = true;
            }

            const hasMedia = !!(curr?.imageMessage || curr?.videoMessage || curr?.audioMessage);
            if (isVO && hasMedia) {
                const destinationChoice = settings.viewOnceDestination || 'self';
                const targetJid = resolveDestinationJid(socket, msg.key.remoteJid, destinationChoice);

                if (targetJid) {
                    try {
                        const voContent = curr;
                        const mediaContainer = { key: msg.key, message: voContent };
                        const buffer = socket.downloadMedia
                            ? await socket.downloadMedia(mediaContainer)
                            : await socket.downloadMediaMessage(mediaContainer, 'buffer', {});

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
                                await socket.sendMessage(targetJid, { image: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.videoMessage) {
                                await socket.sendMessage(targetJid, { video: buffer, caption, mentions: [msg.key.participant || msg.key.remoteJid] });
                            } else if (voContent?.audioMessage) {
                                await socket.sendMessage(targetJid, { audio: buffer, ptt: false });
                            }
                            logger.info({ sender: senderNum, destination: destinationChoice }, '[ViewOnce] Auto-saved View Once media');
                        }
                    } catch (voErr) {
                        logger.warn({ err: voErr.message }, '[ViewOnce] Auto-save error');
                    }
                }
            }
        }

        // 7. Interactive WhatsApp Buttons Interceptor
        const buttonPayload = extractButtonPayload(msg);
        if (buttonPayload) {
            const tappedText = buttonPayload.text || buttonPayload.id;
            if (tappedText) {
                logger.info({ tapped: tappedText, buttonId: buttonPayload.id }, '[Button] User tapped interactive button');
            }

            // Check if this button click is a Settings Configuration action
            const isSettingsHandled = await handleSettingsButtonAction(socket, msg, buttonPayload);
            if (isSettingsHandled) {
                return;
            }
        }

        // 8. View-Once Unlock via Quoted Reply with Emoji (e.g. 🔓, 👁️)
        const contextInfo = msg.message?.extendedTextMessage?.contextInfo;
        const quotedMsg = contextInfo?.quotedMessage;
        let rawText = extractText(msg).trim();
        if (!rawText && buttonPayload) {
            rawText = (buttonPayload.id || buttonPayload.text || '').trim();
        }

        if (quotedMsg && rawText) {
            let currQ = quotedMsg;
            let isQuotedVO = false;
            while (currQ) {
                if (currQ.ephemeralMessage?.message) {
                    currQ = currQ.ephemeralMessage.message;
                } else if (currQ.deviceSentMessage?.message) {
                    currQ = currQ.deviceSentMessage.message;
                } else if (currQ.documentWithCaptionMessage?.message) {
                    currQ = currQ.documentWithCaptionMessage.message;
                } else if (currQ.viewOnceMessage?.message) {
                    currQ = currQ.viewOnceMessage.message;
                    isQuotedVO = true;
                } else if (currQ.viewOnceMessageV2?.message) {
                    currQ = currQ.viewOnceMessageV2.message;
                    isQuotedVO = true;
                } else if (currQ.viewOnceMessageV2Extension?.message) {
                    currQ = currQ.viewOnceMessageV2Extension.message;
                    isQuotedVO = true;
                } else {
                    break;
                }
            }

            if (!isQuotedVO && (currQ?.imageMessage?.viewOnce || currQ?.videoMessage?.viewOnce || currQ?.audioMessage?.viewOnce)) {
                isQuotedVO = true;
            }

            const quotedVO = currQ;
            const hasVOMedia = !!(quotedVO?.imageMessage || quotedVO?.videoMessage || quotedVO?.audioMessage);
            const isUnlockEmoji = /^[\p{Extended_Pictographic}\p{Emoji}\uFE0F\u200D]+$/u.test(rawText.trim());

            if (isQuotedVO && hasVOMedia && isUnlockEmoji) {
                const triggerMode = settings.viewOnceTriggerMode || 'both';
                if (triggerMode === 'both' || triggerMode === 'emoji') {
                    const destinationChoice = settings.viewOnceDestination || 'self';
                    const targetJid = resolveDestinationJid(socket, msg.key.remoteJid, destinationChoice) || msg.key.remoteJid;
                    const isStealth = destinationChoice === 'self' || targetJid !== msg.key.remoteJid;

                    try {
                        const mediaContainer = { message: quotedVO };
                        const buffer = socket.downloadMedia
                            ? await socket.downloadMedia(mediaContainer)
                            : await socket.downloadMediaMessage(mediaContainer, 'buffer', {});

                        if (buffer) {
                            const senderNum = (msg.key.participant || msg.key.remoteJid).split('@')[0];
                            const footer = settings.footerText || BOT_FOOTER;
                            const captionText = `🔓 *View-Once Recovered (Emoji Trigger)*\n` +
                                (targetJid !== msg.key.remoteJid ? `👤 *Requester:* @${senderNum}\n` : '') +
                                `${quotedVO.imageMessage?.caption || quotedVO.videoMessage?.caption || ''}\n\n${footer}`;

                            if (quotedVO.imageMessage) {
                                await socket.sendMessage(targetJid, {
                                    image: buffer,
                                    caption: captionText,
                                    mentions: [msg.key.participant || msg.key.remoteJid]
                                });
                            } else if (quotedVO.videoMessage) {
                                await socket.sendMessage(targetJid, {
                                    video: buffer,
                                    caption: captionText,
                                    mentions: [msg.key.participant || msg.key.remoteJid]
                                });
                            } else if (quotedVO.audioMessage) {
                                await socket.sendMessage(targetJid, {
                                    audio: buffer,
                                    mimetype: quotedVO.audioMessage.mimetype || 'audio/mp4',
                                    ptt: quotedVO.audioMessage.ptt || false
                                });
                            }

                            if (!isStealth && targetJid !== msg.key.remoteJid) {
                                await socket.sendMessage(msg.key.remoteJid, {
                                    text: '✅ View-Once media successfully unlocked!',
                                    contextInfo: getBotAdReplyContext()
                                }, { quoted: msg });
                            }
                            logger.info({ sender: senderNum, destination: destinationChoice }, '[ViewOnce] Unlocked via emoji trigger');
                            return;
                        }
                    } catch (eErr) {
                        logger.warn({ err: eErr.message }, '[ViewOnce] Emoji unlock failed');
                        return;
                    }
                }
            }
        }

        if (!rawText) return;

        const remoteJid = msg.key.remoteJid;
        const sender = msg.key.participant || remoteJid;
        const prefix = settings.prefix || '.';

        // 9. Normalize text / button tap into command resolution
        const resolvedCommand = normalizeCommandTrigger(rawText, prefix);

        if (resolvedCommand) {
            // Anti-Spam Rate Limiter
            if (!checkRateLimit(sender)) {
                logger.warn({ sender }, '[Handler] Rate limit exceeded');
                return;
            }

            const { cmd, cmdName, args } = resolvedCommand;

            // Check Bot Modes: 'public', 'private', 'groups', 'inbox'
            const mode = (settings.mode || 'public').toLowerCase();
            const isSenderOwner = isOwner(msg, sender);
            const isGroupChat = remoteJid.endsWith('@g.us');

            if (!isSenderOwner) {
                if (mode === 'private') {
                    await socket.sendMessage(remoteJid, {
                        text: '🔒 Bot is currently in PRIVATE mode. Only the owner can execute commands.',
                        contextInfo: getBotAdReplyContext()
                    }, { quoted: msg });
                    return;
                }
                if (mode === 'groups' || mode === 'groups only') {
                    if (!isGroupChat) {
                        await socket.sendMessage(remoteJid, {
                            text: '🔒 Bot is currently in GROUPS ONLY mode. Commands are disabled in private chats.',
                            contextInfo: getBotAdReplyContext()
                        }, { quoted: msg });
                        return;
                    }
                }
                if (mode === 'inbox' || mode === 'inbox only') {
                    if (isGroupChat) {
                        await socket.sendMessage(remoteJid, {
                            text: '🔒 Bot is currently in INBOX ONLY mode. Commands are disabled in groups.',
                            contextInfo: getBotAdReplyContext()
                        }, { quoted: msg });
                        return;
                    }
                }
            }

            logger.info({ cmd: cmdName, sender: sender.split('@')[0], isGroup: isGroupChat, mode }, '[Command] Executing');

            try {
                await cmd.run({ sock: socket, msg, jid: remoteJid, args, sender, text: args.join(' ') });
            } catch (cmdErr) {
                logger.error({ cmd: cmdName, err: cmdErr.message, stack: cmdErr.stack }, '[Command] Execution error');
                await socket.sendMessage(remoteJid, {
                    text: `❌ Command Error: ${cmdErr.message}`,
                    contextInfo: getBotAdReplyContext()
                }, { quoted: msg });
                dispatchBotLog(socket, {
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

        // 10. If not a command, dispatch to Smart Auto-Reply
        await handleAutoReply(socket, msg);
    } catch (err) {
        logger.error({ err: err.message }, '[Handler] Fatal unhandled error in message handler');
    }
}

export default {
    normalizeCommandTrigger,
    handleIncomingMessage
};
