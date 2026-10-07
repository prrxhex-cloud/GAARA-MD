import db from '../../config/database.js';
import { isOwner } from './owner.js';
import { formatFramedMessage } from '../bot/format.js';

export const customCommands = {
    setbotname: {
        description: 'Update the bot display name in runtime and settings',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args || args.length === 0) return sock.sendMessage(jid, { text: '⚠️ Usage: *.setbotname <New Name>*' }, { quoted: msg });

            const newName = args.join(' ').trim();
            db.updateSettings({ botName: newName });

            const text = formatFramedMessage([
                {
                    emoji: '✨',
                    title: 'BOT NAME UPDATED',
                    content: [
                        `✅ New Bot Name: *${newName}*`
                    ]
                }
            ], { botName: newName });

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    setbotlogo: {
        description: 'Update the bot logo image URL',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args || !args[0] || !args[0].startsWith('http')) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.setbotlogo <https://image-url>*' }, { quoted: msg });
            }

            const newLogo = args[0].trim();
            db.updateSettings({ customLogoUrl: newLogo });

            await sock.sendMessage(jid, { text: `✅ Bot logo updated to: ${newLogo}` }, { quoted: msg });
        }
    },

    addreply: {
        description: 'Add a custom smart auto-reply trigger',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const full = args.join(' ');
            const parts = full.split('|');
            if (parts.length < 2) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.addreply trigger phrase | response message*' }, { quoted: msg });
            }

            const trigger = parts[0].trim();
            const response = parts.slice(1).join('|').trim();

            const entry = db.addReply(trigger, response, 'contains');

            const text = formatFramedMessage([
                {
                    emoji: '💬',
                    title: 'AUTO-REPLY ADDED',
                    content: [
                        `🎯 *Trigger:* "${trigger}"`,
                        `📤 *Response:* "${response}"`,
                        `🆔 *ID:* ${entry.id}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    delreply: {
        description: 'Delete a custom auto-reply trigger by trigger word or ID',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args || args.length === 0) return sock.sendMessage(jid, { text: '⚠️ Usage: *.delreply <trigger word or id>*' }, { quoted: msg });

            const target = args.join(' ').trim();
            const removed = db.removeReply(target);

            if (removed) {
                await sock.sendMessage(jid, { text: `✅ Deleted auto-reply trigger: "${target}"` }, { quoted: msg });
            } else {
                await sock.sendMessage(jid, { text: `❌ No trigger found matching: "${target}"` }, { quoted: msg });
            }
        }
    },

    listreply: {
        description: 'List all custom smart auto-reply triggers',
        run: async ({ sock, msg, jid }) => {
            const replies = db.getReplies();
            if (replies.length === 0) {
                return sock.sendMessage(jid, { text: '📭 No custom auto-replies configured yet.' }, { quoted: msg });
            }

            const lines = replies.map((r, i) => `${i + 1}. *[${r.trigger}]* ➔ ${r.response}`);
            const text = formatFramedMessage([
                {
                    emoji: '📋',
                    title: 'CUSTOM AUTO-REPLIES',
                    content: lines
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    clearreplies: {
        description: 'Remove all custom auto-replies',
        run: async ({ sock, msg, jid, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            db._writeSafe(db.repliesFile, []);
            await sock.sendMessage(jid, { text: '🧹 Cleared all custom auto-replies!' }, { quoted: msg });
        }
    }
};
