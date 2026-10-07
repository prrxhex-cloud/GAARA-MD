import { formatFramedMessage } from '../bot/format.js';
import { isOwner } from './owner.js';
import logger from '../utils/logger.js';

async function checkGroupAdmin(sock, jid, senderJid) {
    try {
        const metadata = await sock.groupMetadata(jid);
        if (!metadata || !Array.isArray(metadata.participants)) {
            return { metadata: null, isBotAdmin: false, isSenderAdmin: false };
        }

        const botJid = sock.user?.id ? (sock.parseJid ? sock.parseJid(sock.user.id) : sock.user.id.split(':')[0] + '@s.whatsapp.net') : null;

        const botParticipant = metadata.participants.find(p => p.id === botJid || p.id.split(':')[0] === botJid?.split(':')[0]);
        const isBotAdmin = botParticipant?.admin === 'admin' || botParticipant?.admin === 'superadmin';

        const senderParticipant = metadata.participants.find(p => p.id === senderJid || p.id.split(':')[0] === senderJid?.split(':')[0]);
        const isSenderAdmin = senderParticipant?.admin === 'admin' || senderParticipant?.admin === 'superadmin';

        return { metadata, isBotAdmin, isSenderAdmin };
    } catch (err) {
        logger.error({ err: err.message }, '[Group] Error fetching metadata');
        return { metadata: null, isBotAdmin: false, isSenderAdmin: false };
    }
}

export const groupCommands = {
    kick: {
        description: 'Remove a participant from the group',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ This command can only be used in groups.' }, { quoted: msg });

            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin) return sock.sendMessage(jid, { text: '❌ You must be a group admin to use this command.' }, { quoted: msg });
            if (!isBotAdmin) return sock.sendMessage(jid, { text: '❌ Please give the bot admin privileges first.' }, { quoted: msg });

            const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = quotedSender || mentioned[0];

            if (!targetJid) {
                return sock.sendMessage(jid, { text: '⚠️ Please mention or reply to the user you wish to kick.' }, { quoted: msg });
            }

            try {
                await sock.groupParticipantsUpdate(jid, [targetJid], 'remove');
                await sock.sendMessage(jid, { text: `✅ Successfully removed @${targetJid.split('@')[0]}`, mentions: [targetJid] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Kick failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    add: {
        description: 'Add a phone number to the group',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });

            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin) return sock.sendMessage(jid, { text: '❌ You must be an admin.' }, { quoted: msg });
            if (!isBotAdmin) return sock.sendMessage(jid, { text: '❌ Bot is not admin.' }, { quoted: msg });

            if (!args[0]) return sock.sendMessage(jid, { text: '⚠️ Usage: *.add <phoneNumber>*' }, { quoted: msg });

            const cleanNum = args[0].replace(/[^0-9]/g, '');
            const targetJid = `${cleanNum}@s.whatsapp.net`;

            try {
                await sock.groupParticipantsUpdate(jid, [targetJid], 'add');
                await sock.sendMessage(jid, { text: `✅ Added +${cleanNum}` });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Add failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    promote: {
        description: 'Promote participant to group admin',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Requires admin rights for both you and bot.' }, { quoted: msg });

            const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = quotedSender || mentioned[0];
            if (!targetJid) return sock.sendMessage(jid, { text: '⚠️ Reply or tag a user to promote.' }, { quoted: msg });

            try {
                await sock.groupParticipantsUpdate(jid, [targetJid], 'promote');
                await sock.sendMessage(jid, { text: `🎉 Promoted @${targetJid.split('@')[0]} to Admin!`, mentions: [targetJid] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Promote failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    demote: {
        description: 'Demote an admin back to regular member',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin privileges required.' }, { quoted: msg });

            const quotedSender = msg.message?.extendedTextMessage?.contextInfo?.participant;
            const mentioned = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid || [];
            const targetJid = quotedSender || mentioned[0];
            if (!targetJid) return sock.sendMessage(jid, { text: '⚠️ Reply or tag an admin to demote.' }, { quoted: msg });

            try {
                await sock.groupParticipantsUpdate(jid, [targetJid], 'demote');
                await sock.sendMessage(jid, { text: `🔻 Demoted @${targetJid.split('@')[0]} from Admin.`, mentions: [targetJid] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Demote failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    tagall: {
        description: 'Mention all group members with formatted list',
        aliases: ['everyone'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { metadata, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin) return sock.sendMessage(jid, { text: '❌ Only admins can tag all members.' }, { quoted: msg });
            if (!metadata) return sock.sendMessage(jid, { text: '❌ Could not retrieve group metadata.' }, { quoted: msg });

            const customMsg = args.join(' ') || 'Attention Everyone!';
            const participants = metadata.participants || [];
            const mentions = participants.map(p => p.id);

            const memberList = participants.map((p, i) => `${i + 1}. @${p.id.split('@')[0]}`).join('\n');

            const text = formatFramedMessage([
                {
                    emoji: '📢',
                    title: 'GROUP ANNOUNCEMENT',
                    content: [
                        `💬 *Notice:* ${customMsg}`,
                        `👥 *Total Members:* ${participants.length}`,
                        ``,
                        `📋 *Member List:*`,
                        memberList
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, mentions });
        }
    },

    hidetag: {
        description: 'Mention all members invisibly with announcement text',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { metadata, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin) return sock.sendMessage(jid, { text: '❌ Admin only command.' }, { quoted: msg });
            if (!metadata) return sock.sendMessage(jid, { text: '❌ Could not retrieve group metadata.' }, { quoted: msg });

            const customMsg = args.join(' ') || 'Attention Group!';
            const mentions = (metadata.participants || []).map(p => p.id);

            const text = formatFramedMessage([
                {
                    emoji: '⚡',
                    title: 'ADMIN BROADCAST',
                    content: [customMsg]
                }
            ]);

            await sock.sendMessage(jid, { text, mentions });
        }
    },

    link: {
        description: 'Fetch group invitation link',
        aliases: ['grouplink'],
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isBotAdmin) return sock.sendMessage(jid, { text: '❌ Bot must be an admin to generate invite link.' }, { quoted: msg });

            try {
                const code = await sock.groupInviteCode(jid);
                const link = `https://chat.whatsapp.com/${code}`;
                const text = formatFramedMessage([
                    {
                        emoji: '🔗',
                        title: 'GROUP INVITE LINK',
                        content: [link]
                    }
                ]);
                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Could not get link: ${err.message}` }, { quoted: msg });
            }
        }
    },

    mute: {
        description: 'Lock group chat so only admins can send messages',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin rights required.' }, { quoted: msg });

            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                await sock.sendMessage(jid, { text: '🔒 Group chat muted. Only admins can send messages.' });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Mute failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    unmute: {
        description: 'Unlock group chat so all members can send messages',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin rights required.' }, { quoted: msg });

            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                await sock.sendMessage(jid, { text: '🔓 Group chat unmuted. All members can speak.' });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Unmute failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    setname: {
        description: 'Update group subject title',
        aliases: ['setsubject'],
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin rights required.' }, { quoted: msg });

            const newSubject = args.join(' ').trim();
            if (!newSubject) return sock.sendMessage(jid, { text: '⚠️ Usage: *.setname <New Group Name>*' }, { quoted: msg });

            try {
                await sock.groupUpdateSubject(jid, newSubject);
                await sock.sendMessage(jid, { text: `✅ Group name updated to: *${newSubject}*` });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to update name: ${err.message}` }, { quoted: msg });
            }
        }
    },

    setdesc: {
        description: 'Update group description',
        run: async ({ sock, msg, jid, args, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin rights required.' }, { quoted: msg });

            const newDesc = args.join(' ').trim();
            if (!newDesc) return sock.sendMessage(jid, { text: '⚠️ Usage: *.setdesc <New Description>*' }, { quoted: msg });

            try {
                await sock.groupUpdateDescription(jid, newDesc);
                await sock.sendMessage(jid, { text: `✅ Group description updated successfully!` });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to update description: ${err.message}` }, { quoted: msg });
            }
        }
    },

    revoke: {
        description: 'Reset group invitation link',
        aliases: ['resetlink'],
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });
            const { isBotAdmin, isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin || !isBotAdmin) return sock.sendMessage(jid, { text: '❌ Admin rights required.' }, { quoted: msg });

            try {
                const code = await sock.groupRevokeInvite(jid);
                await sock.sendMessage(jid, { text: `🔄 Group invite link revoked! New link: https://chat.whatsapp.com/${code}` });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Revoke link failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    tagadmin: {
        description: 'Tag all group administrators with a notice',
        aliases: ['admins'],
        run: async ({ sock, msg, jid, args }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });

            try {
                const metadata = await sock.groupMetadata(jid);
                const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin');
                const mentions = admins.map(a => a.id);
                const notice = args.join(' ') || 'Admin attention required!';

                const lines = admins.map((a, i) => `${i + 1}. @${a.id.split('@')[0]} (${a.admin})`);

                const text = formatFramedMessage([
                    {
                        emoji: '🛡️',
                        title: 'ADMIN CALL',
                        content: [
                            `📢 *Notice:* ${notice}`,
                            ``,
                            `👥 *Group Admins:*`,
                            ...lines
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text, mentions });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to tag admins: ${err.message}` }, { quoted: msg });
            }
        }
    },

    groupinfo: {
        description: 'Display detailed group information and statistics',
        aliases: ['gcinfo'],
        run: async ({ sock, msg, jid }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });

            try {
                const metadata = await sock.groupMetadata(jid);
                const total = metadata.participants.length;
                const admins = metadata.participants.filter(p => p.admin === 'admin' || p.admin === 'superadmin').length;
                const creation = metadata.creation ? new Date(metadata.creation * 1000).toLocaleDateString() : 'Unknown';
                const owner = metadata.owner ? `@${metadata.owner.split('@')[0]}` : 'N/A';

                const text = formatFramedMessage([
                    {
                        emoji: '📊',
                        title: 'GROUP STATISTICS',
                        content: [
                            `🏷️ *Name:* ${metadata.subject}`,
                            `👑 *Owner:* ${owner}`,
                            `📅 *Created:* ${creation}`,
                            `👥 *Members:* ${total}`,
                            `🛡️ *Admins:* ${admins}`,
                            `🔒 *Chat Restricted:* ${metadata.announce ? 'Yes (Muted)' : 'No (Open)'}`,
                            `📝 *Description:* ${metadata.desc ? metadata.desc.slice(0, 200) : 'None'}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text, mentions: metadata.owner ? [metadata.owner] : [] });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Group info error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    leave: {
        description: 'Bot leaves the group',
        run: async ({ sock, msg, jid, sender }) => {
            if (!jid.endsWith('@g.us')) return sock.sendMessage(jid, { text: '⚠️ Group only command.' }, { quoted: msg });

            const { isSenderAdmin } = await checkGroupAdmin(sock, jid, sender);
            if (!isSenderAdmin && !isOwner(msg, sender)) {
                return sock.sendMessage(jid, { text: '❌ Only group admins or the bot owner can command the bot to leave.' }, { quoted: msg });
            }

            await sock.sendMessage(jid, { text: '👋 Goodbye everyone! GAARA X MD is leaving the group.' });
            try {
                await sock.groupLeave(jid);
            } catch (err) {
                logger.error({ err: err.message }, '[Group] Leave error');
            }
        }
    }
};
