import db from '../../config/database.js';
import config from '../../config/index.js';
import { extractText } from '../utils/antiBug.js';
import logger from '../utils/logger.js';

/**
 * Random humanized delay between min and max ms.
 */
export function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function getRandomJitter(min = config.humanJitterMinMs, max = config.humanJitterMaxMs) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
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
                try {
                    const re = new RegExp(trigger, 'i');
                    matched = re.test(text);
                } catch {
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

        if (apiKey) {
            try {
                const prompt = `[Owner Context: You are ${botName}, personal assistant for ${ownerName} (${ownerBio}). Reply directly and politely on WhatsApp to: "${text}"]`;
                const url = `https://sasa-dev-api.xyz/api/sasaaiplus/chat?apikey=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(prompt)}`;
                
                const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
                if (res.ok) {
                    const data = await res.json();
                    if (data && data.status && data.result) {
                        aiAnswer = data.result;
                    } else if (data && data.reply) {
                        aiAnswer = data.reply;
                    }
                }
            } catch (apiErr) {
                logger.warn({ err: apiErr.message }, '[AutoReply] Sasa AI request failed, using local assistant');
            }
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
        // Presence typing
        if (sock.presence) {
            await sock.presence('composing', jid);
        }
        // Humanized jitter
        const delay = getRandomJitter();
        await sleep(delay);

        await sock.sendMessage(jid, { text }, { quoted });

        if (sock.presence) {
            await sock.presence('paused', jid);
        }
    } catch (err) {
        logger.error({ err: err.message }, '[AutoReply] Error sending reply');
    }
}
