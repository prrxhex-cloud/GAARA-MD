import { makeVoidExtrasSocket } from '@sasa-dev/void-baileys';
import db from '../../config/database.js';
import cfSync from '../services/cfSync.js';
import { formatFramedMessage } from './format.js';
import { SUPPORT_HEADER, BOT_FOOTER } from '../../config/constants.js';
import { isOwner } from '../commands/owner.js';
import logger from '../utils/logger.js';

/**
 * Standard configuration action buttons for WhatsApp interactive menus.
 */
export const SETTINGS_BUTTONS = [
    { id: 'cfg_mode_public', text: '🌐 Public' },
    { id: 'cfg_mode_private', text: '🔒 Private' },
    { id: 'cfg_mode_groups', text: '👥 Groups' },
    { id: 'cfg_mode_inbox', text: '📩 Inbox' },
    { id: 'cfg_delete_self', text: '🛡️ Delete: Self' },
    { id: 'cfg_delete_same', text: '🛡️ Delete: Same' },
    { id: 'cfg_edit_self', text: '✏️ Edit: Self' },
    { id: 'cfg_edit_same', text: '✏️ Edit: Same' },
    { id: 'cfg_viewonce_self', text: '🔓 ViewOnce: Self' },
    { id: 'cfg_viewonce_same', text: '🔓 ViewOnce: Same' }
];

/**
 * Formats the live settings menu card.
 */
export function formatSettingsMenuText() {
    const settings = db.getSettings();
    return formatFramedMessage([
        {
            emoji: '⚙️',
            title: 'BOT CONFIGURATION PANEL',
            content: [
                `🛠️ *Interactive WhatsApp Bot Settings*`,
                `Tap any button below to update settings in real time:`,
                ``,
                `🌐 *Mode:* *${(settings.mode || 'public').toUpperCase()}*`,
                `🛡️ *Anti-Delete Dest:* *${(settings.antiDeleteDestination || 'self').toUpperCase()}*`,
                `✏️ *Anti-Edit Dest:* *${(settings.antiEditDestination || 'self').toUpperCase()}*`,
                `🔓 *View-Once Dest:* *${(settings.viewOnceDestination || 'self').toUpperCase()}*`,
                `💖 *Auto-Status:* *${settings.autoStatus ? 'ENABLED' : 'DISABLED'}*`,
                `📜 *Bot Logs:* *${settings.botLogs ? 'ENABLED' : 'DISABLED'} (${(settings.botLogsDestination || 'self').toUpperCase()})*`,
                ``,
                `💡 *Tap the buttons below to change settings:*`
            ]
        }
    ], {
        header: settings.headerTitle || SUPPORT_HEADER,
        footer: settings.footerText || BOT_FOOTER
    });
}

/**
 * Sends the interactive settings card with native buttons using void-baileys.
 */
export async function sendSettingsButtons(sock, jid, quotedMsg = null) {
    const settings = db.getSettings();
    const text = formatSettingsMenuText();
    const socket = typeof sock.sendButton === 'function' ? sock : makeVoidExtrasSocket(sock);

    try {
        if (typeof socket.sendButton === 'function') {
            return await socket.sendButton(jid, {
                text,
                footer: settings.footerText || BOT_FOOTER,
                buttons: SETTINGS_BUTTONS
            });
        }
    } catch (err) {
        logger.warn({ err: err.message }, '[Buttons] socket.sendButton failed, attempting fallback to sendMessage');
    }

    try {
        // Fallback to sendMessage with buttons array
        return await sock.sendMessage(jid, {
            text,
            footer: settings.footerText || BOT_FOOTER,
            buttons: SETTINGS_BUTTONS.slice(0, 3).map(b => ({
                buttonId: b.id,
                buttonText: { displayText: b.text },
                type: 1
            }))
        }, quotedMsg ? { quoted: quotedMsg } : {});
    } catch (fbErr) {
        logger.warn({ err: fbErr.message }, '[Buttons] Falling back to text-only settings menu');
        return await sock.sendMessage(jid, { text }, quotedMsg ? { quoted: quotedMsg } : {});
    }
}

/**
 * Extracts button reply information across all Baileys & Void-Baileys message variations.
 */
export function extractButtonPayload(msg) {
    if (!msg || !msg.message) return null;
    const m = msg.message?.ephemeralMessage?.message || msg.message;

    // 1. Classic buttonsResponseMessage
    if (m.buttonsResponseMessage) {
        return {
            id: m.buttonsResponseMessage.selectedButtonId || m.buttonsResponseMessage.selectedDisplayText || '',
            text: m.buttonsResponseMessage.selectedDisplayText || m.buttonsResponseMessage.selectedButtonId || '',
            type: 'buttonsResponse'
        };
    }

    // 2. templateButtonReplyMessage
    if (m.templateButtonReplyMessage) {
        return {
            id: m.templateButtonReplyMessage.selectedId || m.templateButtonReplyMessage.selectedDisplayText || '',
            text: m.templateButtonReplyMessage.selectedDisplayText || m.templateButtonReplyMessage.selectedId || '',
            type: 'templateButtonReply'
        };
    }

    // 3. interactiveResponseMessage (Native Flow Buttons)
    if (m.interactiveResponseMessage) {
        const nf = m.interactiveResponseMessage.nativeFlowResponseMessage;
        let id = '';
        if (nf?.paramsJson) {
            try {
                const parsed = JSON.parse(nf.paramsJson);
                id = parsed.id || parsed.selectedId || parsed.buttonId || parsed.display_text || nf.paramsJson;
            } catch {
                id = nf.paramsJson;
            }
        }
        const text = m.interactiveResponseMessage.body?.text || id;
        return {
            id: id || text || '',
            text: text || id || '',
            type: 'interactiveResponse'
        };
    }

    // 4. listResponseMessage
    if (m.listResponseMessage?.singleSelectReply) {
        return {
            id: m.listResponseMessage.singleSelectReply.selectedRowId || '',
            text: m.listResponseMessage.title || m.listResponseMessage.singleSelectReply.selectedRowId || '',
            type: 'listResponse'
        };
    }

    return null;
}

/**
 * Handles incoming button taps for configuration settings.
 * Returns true if the button was recognized and processed as a settings action.
 */
export async function handleSettingsButtonAction(sock, msg, payload) {
    if (!payload) return false;
    const rawId = (payload.id || '').toLowerCase().trim();
    const rawText = (payload.text || '').toLowerCase().trim();

    let settingUpdates = null;
    let label = '';

    // Mode mappings
    if (rawId === 'cfg_mode_public' || rawId === 'mode_public' || rawText === '🌐 public' || rawText === 'public') {
        settingUpdates = { mode: 'public' };
        label = 'Bot Mode set to PUBLIC (All users can use commands)';
    } else if (rawId === 'cfg_mode_private' || rawId === 'mode_private' || rawText === '🔒 private' || rawText === 'private') {
        settingUpdates = { mode: 'private' };
        label = 'Bot Mode set to PRIVATE (Owner only)';
    } else if (rawId === 'cfg_mode_groups' || rawId === 'mode_groups' || rawText === '👥 groups' || rawText === 'groups') {
        settingUpdates = { mode: 'groups' };
        label = 'Bot Mode set to GROUPS ONLY (Commands disabled in DMs)';
    } else if (rawId === 'cfg_mode_inbox' || rawId === 'mode_inbox' || rawText === '📩 inbox' || rawText === 'inbox') {
        settingUpdates = { mode: 'inbox' };
        label = 'Bot Mode set to INBOX ONLY (Commands disabled in groups)';
    }
    // Anti-Delete Destination mappings
    else if (rawId === 'cfg_delete_self' || rawId === 'delete_self' || rawText.includes('delete: self') || rawText === 'delete self') {
        settingUpdates = { antiDelete: true, antiDeleteDestination: 'self', antiDeleteNotifySelf: true };
        label = 'Anti-Delete Destination set to SELF CHAT (Message Yourself)';
    } else if (rawId === 'cfg_delete_same' || rawId === 'delete_same' || rawText.includes('delete: same') || rawText === 'delete same') {
        settingUpdates = { antiDelete: true, antiDeleteDestination: 'same', antiDeleteNotifySelf: false };
        label = 'Anti-Delete Destination set to SAME CHAT (Chat where deletion occurred)';
    }
    // Anti-Edit Destination mappings
    else if (rawId === 'cfg_edit_self' || rawId === 'edit_self' || rawText.includes('edit: self') || rawText === 'edit self') {
        settingUpdates = { antiEdit: true, antiEditDestination: 'self' };
        label = 'Anti-Edit Destination set to SELF CHAT (Message Yourself)';
    } else if (rawId === 'cfg_edit_same' || rawId === 'edit_same' || rawText.includes('edit: same') || rawText === 'edit same') {
        settingUpdates = { antiEdit: true, antiEditDestination: 'same' };
        label = 'Anti-Edit Destination set to SAME CHAT (Chat where edit occurred)';
    }
    // View-Once Destination mappings
    else if (rawId === 'cfg_viewonce_self' || rawId === 'viewonce_self' || rawText.includes('viewonce: self') || rawText === 'viewonce self') {
        settingUpdates = { viewOnceSaver: true, viewOnceDestination: 'self' };
        label = 'View-Once Destination set to SELF CHAT (Message Yourself)';
    } else if (rawId === 'cfg_viewonce_same' || rawId === 'viewonce_same' || rawText.includes('viewonce: same') || rawText === 'viewonce same') {
        settingUpdates = { viewOnceSaver: true, viewOnceDestination: 'same' };
        label = 'View-Once Destination set to SAME CHAT (Current chat)';
    }

    if (!settingUpdates) {
        return false;
    }

    const remoteJid = msg.key?.remoteJid;
    const sender = msg.key?.participant || remoteJid;

    // Verify Owner authorization
    if (!isOwner(msg, sender)) {
        await sock.sendMessage(remoteJid, {
            text: '🔒 Only the bot owner can configure settings.'
        }, { quoted: msg });
        return true;
    }

    // Apply immediate settings update
    const updated = db.updateSettings(settingUpdates);

    // Sync to Cloudflare D1
    const ownerPhone = (sender || '').split('@')[0];
    if (ownerPhone) {
        cfSync.saveSettingsToCloudflare(ownerPhone, updated).catch(() => {});
    }

    logger.info({ updates: settingUpdates, sender }, '[Settings] Updated via interactive button');

    // Send confirmation notice with live status
    const confirmNotice = formatFramedMessage([
        {
            emoji: '✅',
            title: 'CONFIGURATION UPDATED',
            content: [
                `🛠️ *${label}*`,
                ``,
                `🌐 *Current Mode:* *${(updated.mode || 'public').toUpperCase()}*`,
                `🛡️ *Anti-Delete:* *${updated.antiDelete ? 'ENABLED' : 'DISABLED'} (${updated.antiDeleteDestination || 'self'})*`,
                `✏️ *Anti-Edit:* *${updated.antiEdit ? 'ENABLED' : 'DISABLED'} (${updated.antiEditDestination || 'self'})*`,
                `🔓 *View-Once:* *${updated.viewOnceSaver ? 'ENABLED' : 'DISABLED'} (${updated.viewOnceDestination || 'self'})*`,
                `💖 *Auto-Status:* *${updated.autoStatus ? 'ENABLED' : 'DISABLED'}*`,
                `📜 *Bot Logs:* *${updated.botLogs ? 'ENABLED' : 'DISABLED'} (${updated.botLogsDestination || 'self'})*`
            ]
        }
    ], {
        header: updated.headerTitle || SUPPORT_HEADER,
        footer: updated.footerText || BOT_FOOTER
    });

    await sock.sendMessage(remoteJid, { text: confirmNotice }, { quoted: msg });
    return true;
}
