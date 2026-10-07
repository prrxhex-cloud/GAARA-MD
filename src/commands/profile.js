import { formatFramedMessage } from '../bot/format.js';
import { isOwner } from './owner.js';
import logger from '../utils/logger.js';

export const profileCommands = {
    getpp: {
        description: 'Download and save user or group profile picture and bio',
        aliases: ['saveprofile', 'pp', 'profile'],
        run: async ({ sock, msg, jid, args }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const quotedSender = context?.participant;
            const mentioned = context?.mentionedJid || [];

            let targetJid = quotedSender || mentioned[0];

            if (!targetJid && args[0]) {
                const num = args[0].replace(/[^0-9]/g, '');
                if (num) targetJid = `${num}@s.whatsapp.net`;
            }

            if (!targetJid) {
                targetJid = jid; // Default to current chat / group
            }

            const cleanNum = targetJid.split('@')[0];
            await sock.sendMessage(jid, { text: `🔍 Fetching profile for @${cleanNum}...`, mentions: [targetJid] }, { quoted: msg });

            let ppUrl = null;
            try {
                ppUrl = await sock.profilePictureUrl(targetJid, 'image');
            } catch (ppErr) {
                logger.debug({ targetJid, err: ppErr.message }, '[Profile] No HD profile picture found');
            }

            let bio = 'Hidden / Not Set';
            try {
                if (sock.fetchStatus && !targetJid.endsWith('@g.us')) {
                    const statusObj = await sock.fetchStatus(targetJid);
                    if (statusObj && statusObj.status) {
                        bio = statusObj.status;
                    }
                }
            } catch {}

            const info = formatFramedMessage([
                {
                    emoji: '👤',
                    title: 'WHATSAPP PROFILE SAVER',
                    content: [
                        `📱 *Target:* @${cleanNum}`,
                        `📝 *Bio/Status:* ${bio}`,
                        `🖼️ *Profile Picture:* ${ppUrl ? 'Found (High-Res)' : 'Hidden / Default'}`
                    ]
                }
            ]);

            if (ppUrl) {
                try {
                    const res = await fetch(ppUrl, { signal: AbortSignal.timeout(10000) });
                    const imgBuffer = Buffer.from(await res.arrayBuffer());

                    await sock.sendMessage(jid, {
                        image: imgBuffer,
                        caption: info,
                        mentions: [targetJid]
                    }, { quoted: msg });
                    return;
                } catch (imgErr) {
                    logger.warn({ err: imgErr.message }, '[Profile] Failed downloading PP image');
                }
            }

            await sock.sendMessage(jid, { text: info, mentions: [targetJid] }, { quoted: msg });
        }
    },

    setpp: {
        description: 'Set bot profile picture from quoted image',
        aliases: ['updatepp'],
        run: async ({ sock, msg, jid, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;

            if (!target || !target.imageMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to an image with *.setpp*' }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: '🖼️ Updating bot profile picture...' }, { quoted: msg });

                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                if (!buffer) throw new Error('Could not download image');

                const botJid = sock.user?.id ? (sock.parseJid ? sock.parseJid(sock.user.id) : sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;
                if (!botJid) throw new Error('Bot JID unavailable');

                await sock.updateProfilePicture(botJid, buffer);
                await sock.sendMessage(jid, { text: '✅ Profile picture updated successfully!' }, { quoted: msg });
            } catch (err) {
                logger.error({ err: err.message }, '[Profile] Set PP error');
                await sock.sendMessage(jid, { text: `❌ Failed to set profile picture: ${err.message}` }, { quoted: msg });
            }
        }
    },

    setbio: {
        description: 'Set bot WhatsApp bio status text',
        aliases: ['updatebio'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!isOwner(msg, sender)) return sock.sendMessage(jid, { text: '❌ Owner only command.' }, { quoted: msg });

            const newBio = args.join(' ').trim();
            if (!newBio) return sock.sendMessage(jid, { text: '⚠️ Usage: *.setbio <New status text>*' }, { quoted: msg });

            try {
                if (sock.updateProfileStatus) {
                    await sock.updateProfileStatus(newBio);
                    await sock.sendMessage(jid, { text: `✅ Bio status updated to: "${newBio}"` }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Function updateProfileStatus not supported by active socket.' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to update bio: ${err.message}` }, { quoted: msg });
            }
        }
    },

    getbio: {
        description: 'Get user WhatsApp bio status',
        run: async ({ sock, msg, jid, args }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const targetJid = context?.participant || (args[0] ? `${args[0].replace(/[^0-9]/g, '')}@s.whatsapp.net` : jid);

            try {
                if (sock.fetchStatus && !targetJid.endsWith('@g.us')) {
                    const statusObj = await sock.fetchStatus(targetJid);
                    const bioText = statusObj?.status || 'No status bio available';
                    const setAt = statusObj?.setAt ? new Date(statusObj.setAt).toLocaleDateString() : 'Unknown';

                    const text = formatFramedMessage([
                        {
                            emoji: '📝',
                            title: 'USER ABOUT / BIO',
                            content: [
                                `👤 *User:* @${targetJid.split('@')[0]}`,
                                `💬 *Bio:* ${bioText}`,
                                `📅 *Updated:* ${setAt}`
                            ]
                        }
                    ]);
                    await sock.sendMessage(jid, { text, mentions: [targetJid] }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Bio can only be fetched for individual contacts.' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Could not fetch bio: ${err.message}` }, { quoted: msg });
            }
        }
    }
};
