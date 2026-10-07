import db from '../../config/database.js';
import config from '../../config/index.js';
import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

export const aiCommands = {
    ai: {
        description: 'Ask Sasa AI Plus anything',
        aliases: ['ask', 'chat'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide a question or prompt. Example: *.ai What is Quantum Computing?*' }, { quoted: msg });
            }

            const prompt = args.join(' ');
            const settings = db.getSettings();
            const apiKey = settings.sasaDevApiKey || config.sasaDevApiKey;

            if (sock?.presence) {
                sock.presence('composing', jid).catch(() => {});
            }

            let answer = '';

            if (apiKey) {
                try {
                    const url = `https://sasa-dev-api.xyz/api/sasaaiplus/chat?apikey=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(prompt)}`;
                    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                    const data = await res.json();

                    if (data && data.status && data.result) {
                        answer = data.result;
                    } else if (data && data.reply) {
                        answer = data.reply;
                    } else if (data && data.error) {
                        logger.warn({ error: data.error }, '[AI] Sasa API returned error');
                        answer = `⚠️ Sasa AI API Notice: ${data.error}\nPlease check your API key in the web dashboard (/settings).`;
                    }
                } catch (apiErr) {
                    logger.error({ err: apiErr.message }, '[AI] Request error');
                }
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

            await sock.sendMessage(jid, { text }, { quoted: msg });
            if (sock?.presence) {
                sock.presence('paused', jid).catch(() => {});
            }
        }
    }
};
