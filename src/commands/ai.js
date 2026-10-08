import db from '../../config/database.js';
import config from '../../config/index.js';
import { formatFramedMessage, getBotAdReplyContext } from '../bot/format.js';
import { chatSasaAiPlus } from '../services/sasaApi.js';
import logger from '../utils/logger.js';

export const aiCommands = {
    ai: {
        description: 'Ask Sasa AI Plus anything',
        aliases: ['ask', 'chat'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, {
                    text: '⚠️ Please provide a question or prompt. Example: *.ai What is Quantum Computing?*',
                    contextInfo: getBotAdReplyContext()
                }, { quoted: msg });
            }

            const prompt = args.join(' ');

            if (sock?.sendPresenceUpdate) {
                sock.sendPresenceUpdate('composing', jid).catch(() => {});
            } else if (sock?.presence) {
                sock.presence('composing', jid).catch(() => {});
            }

            let answer = '';

            const res = await chatSasaAiPlus(prompt, { timeoutMs: 12000 });
            if (res.success && res.reply) {
                answer = res.reply;
            } else if (res.error) {
                logger.warn({ error: res.error }, '[AI] Sasa API returned error');
                answer = `⚠️ Sasa AI API Notice: ${res.error}\nPlease check your API key in the web dashboard (/settings).`;
            }

            if (!answer) {
                // If no key or API unavailable, provide an informative response
                answer = `🤖 *Sasa AI Plus Assistant*\n\n` +
                         `Query: _"${prompt}"_\n\n` +
                         `💡 *Notice:* To enable full online Sasa AI Plus answers, configure your SASA_DEV_API_KEY in the *.env* file or via the */settings* web dashboard!`;
            }

            const text = formatFramedMessage([
                {
                    emoji: '🤖',
                    title: 'SASA AI PLUS',
                    content: [
                        `❓ *Prompt:* ${prompt}`,
                        ``,
                        `💡 *Response:*\n${answer}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
            if (sock?.sendPresenceUpdate) {
                sock.sendPresenceUpdate('paused', jid).catch(() => {});
            } else if (sock?.presence) {
                sock.presence('paused', jid).catch(() => {});
            }
        }
    }
};
