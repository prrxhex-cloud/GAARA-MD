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

        const content = Array.isArray(sec.content) ? sec.content : [sec.content];

        const contentLines = content
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
 * 'same' | 'Same Chat' -> sends to remoteJid (the chat where the event occurred)
 */
export function resolveDestinationJid(sock, remoteJid, destinationPreference = 'self') {
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
    if (isSameChat && remoteJid && remoteJid !== 'status@broadcast') {
        return remoteJid;
    }
    return selfJid;
}

/**
 * Creates the Connected Setup Message sent to 'Message Yourself' upon pairing.
 */
export function formatConnectedSetupMessage(phoneNumber, panelPassword, dashboardUrl) {
    const settings = db.getSettings();
    const botName = settings.botName || 'GAARA X MD';

    return formatFramedMessage([
        {
            emoji: '🌸',
            title: `${botName} SETUP`,
            content: [
                `🎉 *Connected Successfully!*`,
                `📱 *Phone:* +${phoneNumber}`,
                `🔑 *Panel Password:* ${panelPassword}`,
                `🌐 *Dashboard:* ${dashboardUrl}/settings`,
                ``,
                `💡 *Next Steps:*`,
                `1. Click the button below to copy your panel password.`,
                `2. Visit your web dashboard to configure automations.`,
                `3. Type *.help* or *.menu* to view all available commands.`
            ]
        }
    ]);
}
