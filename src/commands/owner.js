import { exec } from 'child_process';
import util from 'util';
import db from '../../config/database.js';
import config from '../../config/index.js';
import { formatFramedMessage } from '../bot/format.js';
import { restartBotSocket } from '../bot/socket.js';
import {
    sendSettingsButtons,
    sendNativeFlowButtons,
    sendTemplateButtons,
    sendPlainButtons,
    sendClassicButtons
} from '../bot/buttons.js';
import logger from '../utils/logger.js';

const execPromise = util.promisify(exec);

export function isOwner(msg, senderJid) {
    if (msg.key.fromMe) return true;
    const senderNumber = senderJid ? senderJid.split('@')[0] : '';
    const settings = db.getSettings();
    return (
        senderNumber === (settings.ownerNumber || '').replace(/[^0-9]/g, '') ||
        senderNumber === (config.ownerNumber || '').replace(/[^0-9]/g, '')
    );
}

export const ownerCommands = {
    settings: {
        description: 'Open interactive WhatsApp settings menu with buttons',
        aliases: ['config', 'cfg', 'botsettings'],
        run: async ({ sock, msg, jid, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            await sendSettingsButtons(sock, jid, msg);
        }
    },

    buttons: {
        description: 'Demo interactive action buttons (Plain, Template, Native Flow, and Classic)',
        aliases: ['demobuttons', 'pizza'],
        run: async ({ sock, msg, jid, args }) => {
            const style = (args[0] || 'flow').toLowerCase();
            if (style === 'plain') {
                await sendPlainButtons(sock, jid, {
                    text: 'Select an option below',
                    footer: 'Void Pizza',
                    buttons: [
                        { buttonId: 'order-pizza', buttonText: { displayText: 'Order Pizza' }, type: 1 },
                        { buttonId: 'track-order', buttonText: { displayText: 'Track Order' }, type: 1 },
                        { buttonId: 'talk-human', buttonText: { displayText: 'Talk to a Human' }, type: 1 },
                    ],
                    quoted: msg
                });
            } else if (style === 'template') {
                await sendTemplateButtons(sock, jid, {
                    text: 'Your pizza is on the way',
                    title: 'Order confirmation',
                    templateButtons: [
                        { index: 1, text: 'OK', buttonText: 'OK' },
                        { index: 2, text: 'Call us', call: '+94771234567' },
                        { index: 3, text: 'Website', url: 'https://example.com' },
                    ],
                    quoted: msg
                });
            } else if (style === 'classic') {
                await sendClassicButtons(sock, jid, {
                    text: 'Legacy layout',
                    footer: 'Void Pizza',
                    buttons: [{ id: 'old-school', text: 'Old style' }],
                    quoted: msg
                });
            } else {
                await sendNativeFlowButtons(sock, jid, {
                    text: 'Choose your meal',
                    footer: 'Void Pizza',
                    buttons: [
                        { id: 'pizza', text: 'Pizza' },
                        { id: 'burger', text: 'Burger' },
                        { copy: 'npm i @sasa-dev/void-baileys', text: 'Copy install cmd' },
                        { url: 'https://example.com/menu', text: 'Website' },
                    ],
                    quoted: msg
                });
            }
        }
    },

    mode: {
        description: 'Set bot mode: public, private, groups, or inbox',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const rawMode = args[0] ? args[0].toLowerCase() : null;
            const validModes = ['public', 'private', 'groups', 'inbox'];
            let nextMode = 'public';

            if (rawMode && validModes.includes(rawMode)) {
                nextMode = rawMode;
            } else if (rawMode === 'group' || rawMode === 'groups only') {
                nextMode = 'groups';
            } else if (rawMode === 'pm' || rawMode === 'inbox only') {
                nextMode = 'inbox';
            } else {
                const current = db.getSettings().mode;
                nextMode = current === 'public' ? 'private' : 'public';
            }

            db.updateSettings({ mode: nextMode });

            const descriptions = {
                public: 'All users and group members can use commands.',
                private: 'Only the owner can use bot commands.',
                groups: 'Commands can only be used in group chats.',
                inbox: 'Commands can only be used in private / direct chats.'
            };

            const text = formatFramedMessage([
                {
                    emoji: '🔒',
                    title: 'BOT MODE UPDATED',
                    content: [
                        `🌐 Current Mode: *${nextMode.toUpperCase()}*`,
                        descriptions[nextMode] || 'Configured successfully.'
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    antiedit: {
        description: 'Enable or disable anti-edit message recovery',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().antiEdit;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ antiEdit: nextVal });

            await sock.sendMessage(jid, {
                text: `✏️ *Anti-Edit Protection is now:* *${nextVal ? 'ENABLED' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    anticall: {
        description: 'Enable or disable anti-call protection',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().antiCall;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ antiCall: nextVal });

            await sock.sendMessage(jid, {
                text: `📵 *Anti-Call Protection is now:* *${nextVal ? 'ENABLED (3 warnings + auto-block)' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    antidelete: {
        description: 'Enable or disable anti-delete message recovery',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().antiDelete;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ antiDelete: nextVal });

            await sock.sendMessage(jid, {
                text: `🗑️ *Anti-Delete Protection is now:* *${nextVal ? 'ENABLED' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    autostatus: {
        description: 'Toggle auto-view and like for WhatsApp status updates',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().autoStatus;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ autoStatus: nextVal });

            await sock.sendMessage(jid, {
                text: `💖 *Auto-Status View & Like is now:* *${nextVal ? 'ENABLED' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    antiviewonce: {
        description: 'Enable or disable automatic View-Once media saver',
        aliases: ['viewonce', 'autoviewonce'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().viewOnceSaver;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ viewOnceSaver: nextVal });

            await sock.sendMessage(jid, {
                text: `📷 *Anti View-Once Auto-Saver is now:* *${nextVal ? 'ENABLED' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    statusantidelete: {
        description: 'Enable or disable status anti-delete protection',
        aliases: ['statusdelete'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const current = db.getSettings().statusAntiDelete;
            let nextVal = !current;
            if (args[0] === 'on' || args[0] === 'enable') nextVal = true;
            if (args[0] === 'off' || args[0] === 'disable') nextVal = false;

            db.updateSettings({ statusAntiDelete: nextVal });

            await sock.sendMessage(jid, {
                text: `💖 *Status Anti-Delete Protection is now:* *${nextVal ? 'ENABLED' : 'DISABLED'}*`
            }, { quoted: msg });
        }
    },

    botlogs: {
        description: 'Enable or disable bot event notifications & configure destination',
        aliases: ['botlog'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const sub = args[0]?.toLowerCase();
            if (sub === 'self' || sub === 'same') {
                db.updateSettings({ botLogsDestination: sub });
                return sock.sendMessage(jid, {
                    text: `📜 *Bot Logs Destination set to:* *${sub === 'self' ? 'Self Chat (Message Yourself)' : 'Same Chat'}*`
                }, { quoted: msg });
            }

            const current = db.getSettings().botLogs;
            let nextVal = !current;
            if (sub === 'on' || sub === 'enable') nextVal = true;
            if (sub === 'off' || sub === 'disable') nextVal = false;

            db.updateSettings({ botLogs: nextVal });

            await sock.sendMessage(jid, {
                text: `📜 *Bot Logs & Notifications are now:* *${nextVal ? 'ENABLED' : 'DISABLED'}* (Destination: ${db.getSettings().botLogsDestination || 'self'})`
            }, { quoted: msg });
        }
    },

    block: {
        description: 'Block a WhatsApp contact',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            let targetJid = quotedSender || mentioned[0];

            if (!targetJid && args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                targetJid = `${num}@s.whatsapp.net`;
            }

            if (!targetJid) {
                return sock.sendMessage(jid, { text: '⚠️ Please mention, reply to, or provide the number to block.' }, { quoted: msg });
            }

            try {
                await sock.updateBlockStatus(targetJid, 'block');
                await sock.sendMessage(jid, { text: `⛔ Blocked: @${targetJid.split('@')[0]}`, mentions: [targetJid] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to block: ${err.message}` }, { quoted: msg });
            }
        }
    },

    unblock: {
        description: 'Unblock a WhatsApp contact',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            let targetJid = quotedSender || mentioned[0];

            if (!targetJid && args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                targetJid = `${num}@s.whatsapp.net`;
            }

            if (!targetJid) {
                return sock.sendMessage(jid, { text: '⚠️ Please mention, reply to, or provide the number to unblock.' }, { quoted: msg });
            }

            try {
                await sock.updateBlockStatus(targetJid, 'unblock');
                await sock.sendMessage(jid, { text: `✅ Unblocked: @${targetJid.split('@')[0]}`, mentions: [targetJid] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to unblock: ${err.message}` }, { quoted: msg });
            }
        }
    },

    broadcast: {
        description: 'Broadcast a message to chats',
        aliases: ['bc'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide text for the broadcast.' }, { quoted: msg });
            }

            const broadcastText = args.join(' ');
            await sock.sendMessage(jid, { text: '📢 Initiating broadcast...' }, { quoted: msg });

            const formatted = formatFramedMessage([
                {
                    emoji: '📢',
                    title: 'OFFICIAL BROADCAST',
                    content: [broadcastText]
                }
            ]);

            let sentCount = 0;
            try {
                const chats = Object.keys(sock.chats || {});
                if (chats.length > 0) {
                    for (const c of chats) {
                        try {
                            await sock.sendMessage(c, { text: formatted });
                            sentCount++;
                            await new Promise(r => setTimeout(r, 1000));
                        } catch {}
                    }
                }
            } catch (err) {
                logger.error({ err: err.message }, '[Broadcast] Error');
            }

            await sock.sendMessage(jid, { text: `✅ Broadcast finished. Delivered to ${sentCount || 1} chats.` }, { quoted: msg });
        }
    },

    setprefix: {
        description: 'Change the bot command prefix character',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args[0]) return sock.sendMessage(jid, { text: '⚠️ Usage: *.setprefix <symbol>*. Example: *.setprefix !*' }, { quoted: msg });

            const newPrefix = args[0].trim();
            db.updateSettings({ prefix: newPrefix });

            await sock.sendMessage(jid, { text: `✅ Bot prefix changed to: *${newPrefix}*` }, { quoted: msg });
        }
    },

    eval: {
        description: 'Execute JavaScript code in the bot runtime environment',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args || args.length === 0) return sock.sendMessage(jid, { text: '⚠️ Usage: *.eval <code>*' }, { quoted: msg });

            const code = args.join(' ');
            try {
                let evaled = await eval(code);
                if (typeof evaled !== 'string') {
                    evaled = util.inspect(evaled, { depth: 1 });
                }
                await sock.sendMessage(jid, { text: `💻 *EVAL RESULT:*\n\`\`\`${evaled.slice(0, 1500)}\`\`\`` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Eval Error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    exec: {
        description: 'Execute shell command on host machine',
        aliases: ['bash', 'sh'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args || args.length === 0) return sock.sendMessage(jid, { text: '⚠️ Usage: *.exec <shell command>*' }, { quoted: msg });

            const cmd = args.join(' ');
            try {
                const { stdout, stderr } = await execPromise(cmd, { timeout: 15000 });
                const output = (stdout || stderr || 'Command executed with no output').trim();
                await sock.sendMessage(jid, { text: `🖥️ *EXEC OUTPUT:*\n\`\`\`${output.slice(0, 1500)}\`\`\`` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Exec Error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    clearcache: {
        description: 'Flush in-memory message and rate limiter caches',
        run: async ({ sock, msg, jid, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const msgKeys = messageCache.keys().length;
            const rateKeys = rateLimitCache.keys().length;

            messageCache.flushAll();
            rateLimitCache.flushAll();

            await sock.sendMessage(jid, {
                text: `🧹 Cache Cleared! Flushed ${msgKeys} cached messages and ${rateKeys} rate-limit records.`
            }, { quoted: msg });
        }
    },

    restart: {
        description: 'Restart the WhatsApp bot socket connection',
        run: async ({ sock, msg, jid, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            await sock.sendMessage(jid, { text: '🔄 Restarting GAARA X MD socket connection...' }, { quoted: msg });
            try {
                await restartBotSocket();
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Restart failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    join: {
        description: 'Join a group using an invitation link',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });
            if (!args[0]) return sock.sendMessage(jid, { text: '⚠️ Usage: *.join <https://chat.whatsapp.com/code>*' }, { quoted: msg });

            const match = args[0].match(/chat\.whatsapp\.com\/([0-9A-Za-z]{20,24})/i);
            if (!match) return sock.sendMessage(jid, { text: '❌ Invalid WhatsApp invite link format.' }, { quoted: msg });

            const code = match[1];
            try {
                const res = await sock.groupAcceptInvite(code);
                await sock.sendMessage(jid, { text: `✅ Successfully joined group! JID: ${res || 'Joined'}` }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Join group failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
};
