import fs from 'fs';
import path from 'path';
import { SUPPORT_HEADER, BOT_FOOTER, DEFAULT_CHANNEL_URL } from '../../config/constants.js';
import db from '../../config/database.js';
import config from '../../config/index.js';

let cachedBotIconBuffer = null;

/**
 * Loads the permanent bot icon buffer from assets/bot_icon.jpg
 */
export function getBotIconBuffer() {
    if (cachedBotIconBuffer) return cachedBotIconBuffer;
    const iconPath = path.resolve(config.rootDir, 'assets', 'bot_icon.jpg');
    if (fs.existsSync(iconPath)) {
        try {
            cachedBotIconBuffer = fs.readFileSync(iconPath);
            return cachedBotIconBuffer;
        } catch {}
    }
    return null;
}

/**
 * Creates WhatsApp External Ad Reply context embedding the bot icon and footer.
 */
export function getBotAdReplyContext(options = {}) {
    const settings = db.getSettings();
    const botName = options.title || options.botName || settings.botName || 'GAARA X MD';
    const footer = options.body || options.footer || settings.footerText || BOT_FOOTER;
    const channelUrl = settings.channelUrl || DEFAULT_CHANNEL_URL;
    const thumbnail = getBotIconBuffer();

    return {
        externalAdReply: {
            title: botName,
            body: footer,
            mediaType: 1,
            thumbnail: thumbnail || undefined,
            sourceUrl: channelUrl,
            renderLargerThumbnail: true
        }
    };
}

/**
 * Wraps a Baileys or mock socket so that all outgoing sendMessage calls
 * automatically embed the bot icon thumbnail and footer into externalAdReply context.
 */
export function wrapSocketWithBranding(sock) {
    if (!sock || sock.__brandedWrapped) return sock;
    const origSendMessage = typeof sock.sendMessage === 'function' ? sock.sendMessage.bind(sock) : null;
    if (origSendMessage) {
        sock.sendMessage = async function(jid, content, options = {}) {
            try {
                if (content && typeof content === 'object') {
                    if (!content.react && !content.poll && !content.delete) {
                        const adReply = getBotAdReplyContext();
                        if (!content.contextInfo) {
                            content.contextInfo = adReply;
                        } else if (!content.contextInfo.externalAdReply) {
                            content.contextInfo = { ...adReply, ...content.contextInfo, externalAdReply: adReply.externalAdReply };
                        }
                    }
                }
            } catch {}
            return await origSendMessage(jid, content, options);
        };
    }
    sock.__brandedWrapped = true;
    return sock;
}

/**
 * Creates an ASCII Framing Box exactly matching the user's specification.
 */
export function formatFramedMessage(sections = [], options = {}) {
    const settings = db.getSettings();
    const botName = options.botName || settings.botName || 'GAARA X MD';
    const headerTitle = options.header || (options.botName ? `⚡ ${botName}` : (settings.headerTitle || SUPPORT_HEADER));
    const footer = options.footer || settings.footerText || BOT_FOOTER;

    // Header Box
    const headerBox = [
        `╭───[ ${headerTitle} ]`,
        `│◇│`,
        `│◇│ ─────────────────`,
        `╰────────────────────`
    ].join('\n');

    // Section Boxes
    const sectionBoxes = sections.map(sec => {
        let titleString = sec.title || 'INFORMATION';
        if (sec.emoji && !titleString.includes(sec.emoji)) {
            titleString = `${sec.emoji} ${titleString}`;
        }
        titleString = titleString.replace(/^\[\s*/, '').replace(/\s*\]$/, '');

        const rawContent = Array.isArray(sec.content) ? sec.content : [sec.content];
        const flatLines = [];
        for (const item of rawContent) {
            if (typeof item === 'string' && item.includes('\n')) {
                flatLines.push(...item.split('\n'));
            } else {
                flatLines.push(item);
            }
        }

        const contentLines = flatLines
            .map(line => (line === '' ? `│◇│` : `│◇│  ${line}`))
            .join('\n');

        return [
            `╭───[ ${titleString} ]`,
            `│◇│`,
            contentLines,
            `│◇│`,
            `╰────────────────────`
        ].join('\n');
    }).join('\n\n');

    const parts = [headerBox];
    if (sectionBoxes) {
        parts.push(sectionBoxes);
    }
    parts.push(footer);

    return parts.join('\n\n');
}

/**
 * Resolves the target JID based on destination preference:
 * 'self' | 'Self Chat' -> sends to self (Message Yourself)
 * 'same' | 'Same Chat' -> sends to remoteJid (or senderJid if status broadcast)
 */
export function resolveDestinationJid(sock, remoteJid, destinationPreference = 'self', senderJid = null) {
    let selfJid = null;
    if (sock?.user?.id) {
        if (typeof sock.parseJid === 'function') {
            selfJid = sock.parseJid(sock.user.id);
        } else {
            const raw = sock.user.id;
            const num = raw.includes('@') ? raw.split('@')[0].split(':')[0] : raw.split(':')[0];
            selfJid = `${num}@s.whatsapp.net`;
        }
    }

    if (!selfJid) {
        const settings = db.getSettings();
        const ownerNum = (settings.ownerNumber || config.ownerNumber || '').replace(/[^0-9]/g, '');
        if (ownerNum) {
            selfJid = `${ownerNum}@s.whatsapp.net`;
        }
    }

    const isSameChat = destinationPreference === 'same' || destinationPreference === 'Same Chat';
    if (isSameChat) {
        if (remoteJid && remoteJid !== 'status@broadcast') {
            return remoteJid;
        }
        if (remoteJid === 'status@broadcast' && senderJid && senderJid !== 'status@broadcast') {
            return senderJid;
        }
    }
    return selfJid;
}

/**
 * Creates the Connected Setup Message sent to 'Message Yourself' upon pairing.
 * Matches user Picture 1 gentle Sinhala greeting and compact photo branding.
 */
export function formatConnectedSetupMessage(phoneNumber, panelPassword, dashboardUrl) {
    const settings = db.getSettings();
    const botName = settings.botName || 'GAARA X MD';
    const mode = (settings.mode || 'public').toUpperCase();
    const antiDeleteStatus = settings.antiDelete ? `ENABLED (${settings.antiDeleteDestination || 'self'})` : 'DISABLED';
    const antiEditStatus = settings.antiEdit ? `ENABLED (${settings.antiEditDestination || 'self'})` : 'DISABLED';
    const viewOnceStatus = settings.viewOnceSaver ? `ENABLED (${settings.viewOnceDestination || 'self'})` : 'DISABLED';
    const autoStatusStatus = settings.autoStatus ? 'ENABLED' : 'DISABLED';

    // Normalize dashboard URL to avoid duplicate /settings suffix
    let settingsLink = '/settings';
    if (dashboardUrl && typeof dashboardUrl === 'string') {
        const cleanDash = dashboardUrl.trim().replace(/\/+$/, '');
        if (cleanDash.endsWith('/settings')) {
            settingsLink = cleanDash;
        } else if (cleanDash && cleanDash !== '/') {
            settingsLink = `${cleanDash}/settings`;
        }
    }

    const gentleNotice = [
        `│ බොට් සම්බන්ධ වෙමින් පවතී... 🔄`,
        ``,
        `කරුණාකර මිනිත්තු 5ක් රැඳී සිටින්න... ⏳`,
        `• ඉන්පසු .alive විධානය භාවිතා කරන්න`,
        ``,
        `මිනිත්තු 5කට පසු කිසිදු ප්‍රතිචාරයක් නොලැබේ නම් පමණක්:`,
        `• කරුණාකර ඔබේ උපාංගය නැවත සම්බන්ධ කරන්න ( RE-LINK DEVICE ) 🔄`
    ].join('\n');

    const setupCard = formatFramedMessage([
        {
            emoji: '🌸',
            title: `${botName} SETUP`,
            content: [
                `🎉 *Connected Successfully!*`,
                `📱 *Phone:* +${phoneNumber}`,
                `🌐 *Mode:* ${mode}`,
                `🛡️ *Anti-Delete:* ${antiDeleteStatus}`,
                `✏️ *Anti-Edit:* ${antiEditStatus}`,
                `📷 *View-Once:* ${viewOnceStatus}`,
                `💖 *Auto-Status:* ${autoStatusStatus}`,
                `🔑 *Panel Password:* ${panelPassword}`,
                `🌐 *Dashboard:* ${settingsLink}`,
                ``,
                `💡 *Next Steps:*`,
                `1. Click the button below to copy your panel password.`,
                `2. Visit your web dashboard to configure automations.`,
                `3. Type *.help* or *.menu* to view all available commands.`
            ]
        }
    ]);

    return `${gentleNotice}\n\n${setupCard}`;
}

export default {
    getBotIconBuffer,
    getBotAdReplyContext,
    wrapSocketWithBranding,
    formatFramedMessage,
    resolveDestinationJid,
    formatConnectedSetupMessage
};
