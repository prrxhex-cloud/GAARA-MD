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
    const footer = options.footer || BOT_FOOTER;

    // Header Box
    const headerBox = [
        `╭───[ ⚡ ${botName} ]`,
        `│◇│`,
        `│◇│ ─────────────────`,
        `╰────────────────────`
    ].join('\n');

    // Section Boxes
    const sectionBoxes = sections.map(sec => {
        const emoji = sec.emoji || '📌';
        const title = sec.title || 'INFORMATION';
        const content = Array.isArray(sec.content) ? sec.content : [sec.content];

        const contentLines = content
            .map(line => (line === '' ? `│◇│` : `│◇│  ${line}`))
            .join('\n');

        return [
            `╭───[ ${emoji} ${title} ]`,
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
