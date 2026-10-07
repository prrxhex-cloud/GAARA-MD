import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import db from '../../config/database.js';

/**
 * Creates an ASCII Framing Box exactly matching the user's specification.
 * 
 * ╭───[ ⚡ {BOT_NAME} ]
 * │◇│
 * │◇│ ─────────────────
 * ╰────────────────────
 * 
 * ╭───[ {EMOJI} {SECTION_TITLE} ]
 * │◇│
 * │◇│  {CONTENT_LINES}
 * │◇│
 * ╰────────────────────
 * 
 * THIS BOT BUILT BY GAARA DEV OFC.
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
        // Normalize brackets if caller passed '[ 🛡️ ANTI DELETE ]'
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

    return formatFramedMessage([
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
}
