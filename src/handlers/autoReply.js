import db from '../../config/database.js';
import config from '../../config/index.js';
import { extractText } from '../utils/antiBug.js';
import { getBotAdReplyContext } from '../bot/format.js';
import { chatSasaAiPlus } from '../services/sasaApi.js';
import { isSafeRegex } from '../utils/security.js';
import logger from '../utils/logger.js';

/**
 * Random humanized delay between min and max ms.
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getRandomJitter(min = config.humanJitterMinMs, max = config.humanJitterMaxMs) {
    const lo = Math.min(min, max);
    const hi = Math.max(min, max);
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
}

/**
 * Smart Auto-Reply Handler:
 * 1. Custom Triggers (exact, contains, regex)
 * 2. Sasa AI Plus for 1-on-1 chats
 */
export async function handleAutoReply(sock, msg) {
    try {
        if (!msg || !msg.key) return false;
        if (msg.key.fromMe) return false;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) return false;

        // STRICTLY IGNORE groups, broadcasts, and newsletters
        if (remoteJid.endsWith('@g.us') || remoteJid.endsWith('@newsletter') || remoteJid === 'status@broadcast') {
            return false;
        }

        const senderNumber = remoteJid.split('@')[0];
        const settings = db.getSettings();

        // Check Blacklist
        if (Array.isArray(settings.blacklist) && settings.blacklist.includes(senderNumber)) {
            logger.debug({ senderNumber }, '[AutoReply] Sender is blacklisted');
            return false;
        }

        const text = extractText(msg).trim();
        if (!text) return false;

        const prefix = settings.prefix || '.';
        if (text.startsWith(prefix)) {
            return false; // Let command handler take care of it
        }

        const cleanText = text.toLowerCase();

        // 1. Check Custom Trigger Responses
        const replies = db.getReplies().filter(r => r.enabled);
        for (const r of replies) {
            let matched = false;
            const trigger = (r.trigger || '').trim();
            if (!trigger) continue;

            if (r.matchType === 'exact') {
                matched = cleanText === trigger.toLowerCase();
            } else if (r.matchType === 'regex') {
                const check = isSafeRegex(trigger);
                if (check.safe) {
                    try {
                        const re = new RegExp(trigger, 'i');
                        matched = re.test(text.slice(0, 500));
                    } catch {
                        matched = false;
                    }
                } else {
                    logger.warn({ trigger, reason: check.reason }, '[AutoReply] Skipped unsafe regex trigger');
                    matched = false;
                }
            } else {
                // Default 'contains'
                matched = cleanText.includes(trigger.toLowerCase());
            }

            if (matched) {
                logger.info({ trigger, sender: senderNumber }, '[AutoReply] Trigger matched');
                await simulateTypingAndSend(sock, remoteJid, r.response, msg);
                return true;
            }
        }

        // 2. AI Auto-Reply (Only if enabled)
        if (!settings.autoReply && !settings.aiAutoReply) {
            return false;
        }

        logger.info({ sender: senderNumber, text }, '[AutoReply] Triggering AI auto-reply');
        
        const apiKey = settings.sasaDevApiKey || config.sasaDevApiKey;
        const ownerName = settings.ownerName || 'GAARA DEV OFC';
        const ownerBio = settings.ownerBio || 'Developer & Creator of GAARA X MD';
        const botName = settings.botName || 'GAARA X MD';

        let aiAnswer = '';

        const prompt = `[Owner Context: You are ${botName}, personal assistant for ${ownerName} (${ownerBio}). Reply directly and politely on WhatsApp to: "${text}"]`;
        const res = await chatSasaAiPlus(prompt, { timeoutMs: 10000 });
        if (res.success && res.reply) {
            aiAnswer = res.reply;
        }

        // Smart Fallback if API key missing or external service unavailable
        if (!aiAnswer) {
            aiAnswer = `Hello! 👋 I am *${botName}*, personal assistant to *${ownerName}*.\n\n` +
                       `I received your message: _"${text}"_\n` +
                       `${ownerName} is currently unavailable, but will read your message as soon as possible. Type *${prefix}menu* to explore available tools and services!`;
        }

        await simulateTypingAndSend(sock, remoteJid, aiAnswer, msg);
        return true;
    } catch (err) {
        logger.error({ err: err.message }, '[AutoReply] Error in auto reply handler');
        return false;
    }
}

async function simulateTypingAndSend(sock, jid, text, quoted) {
    try {
        // Presence typing (non-blocking)
        if (sock.sendPresenceUpdate) {
            sock.sendPresenceUpdate('composing', jid).catch(() => {});
        } else if (sock.presence) {
            sock.presence('composing', jid).catch(() => {});
        }

        // Snappy humanized jitter
        const delay = getRandomJitter();
        if (delay > 0) {
            await sleep(delay);
        }

        await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted });

        if (sock.sendPresenceUpdate) {
            sock.sendPresenceUpdate('paused', jid).catch(() => {});
        } else if (sock.presence) {
            sock.presence('paused', jid).catch(() => {});
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AutoReply] Error sending reply');
    }
}
