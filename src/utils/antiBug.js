import { CRASH_PATTERNS, MAX_MESSAGE_LENGTH } from '../../config/constants.js';
import logger from './logger.js';

/**
 * Checks whether an incoming message stanza or content is malformed or dangerous.
 * @param {object} msg - Baileys WAMessage object
 * @returns {{ safe: boolean, reason?: string }}
 */
export function validateMessage(msg) {
    if (!msg || typeof msg !== 'object') {
        return { safe: false, reason: 'Empty or invalid message structure' };
    }

    if (!msg.key || !msg.key.remoteJid) {
        return { safe: false, reason: 'Missing message key or remoteJid' };
    }

    // Extract text payload
    const text = extractText(msg);

    if (text) {
        // 1. Oversized text check
        if (text.length > MAX_MESSAGE_LENGTH) {
            logger.warn({ len: text.length, sender: msg.key.remoteJid }, '[AntiBug] Dropped oversized message');
            return { safe: false, reason: `Oversized message (${text.length} chars)` };
        }

        // 2. Known crash patterns
        for (const pattern of CRASH_PATTERNS) {
            if (pattern.test(text)) {
                logger.warn({ sender: msg.key.remoteJid }, '[AntiBug] Dropped known crash pattern message');
                return { safe: false, reason: 'Matched known crash pattern' };
            }
        }
    }

    // 3. VCard checks
    const vcard = msg.message?.contactMessage?.vcard;
    if (vcard && typeof vcard === 'string') {
        if (vcard.length > 8000 || /[\u200B-\u200D\uFEFF]{200,}/.test(vcard)) {
            logger.warn({ sender: msg.key.remoteJid }, '[AntiBug] Dropped malformed contact card');
            return { safe: false, reason: 'Malformed vCard' };
        }
    }

    return { safe: true };
}

/**
 * Helper to safely extract text from any message format.
 */
export function extractText(msg) {
    if (!msg || !msg.message) return '';
    let m = msg.message;
    while (m) {
        if (m.ephemeralMessage?.message) {
            m = m.ephemeralMessage.message;
        } else if (m.viewOnceMessage?.message) {
            m = m.viewOnceMessage.message;
        } else if (m.viewOnceMessageV2?.message) {
            m = m.viewOnceMessageV2.message;
        } else if (m.viewOnceMessageV2Extension?.message) {
            m = m.viewOnceMessageV2Extension.message;
        } else if (m.deviceSentMessage?.message) {
            m = m.deviceSentMessage.message;
        } else if (m.documentWithCaptionMessage?.message) {
            m = m.documentWithCaptionMessage.message;
        } else {
            break;
        }
    }
    let interactiveText = '';
    if (m.interactiveResponseMessage?.nativeFlowResponseMessage?.paramsJson) {
        try {
            const parsed = JSON.parse(m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson);
            interactiveText = parsed.id || parsed.display_text || parsed.selectedId || m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson;
        } catch {
            interactiveText = m.interactiveResponseMessage.nativeFlowResponseMessage.paramsJson;
        }
    }
    return (
        m.conversation ||
        m.extendedTextMessage?.text ||
        m.imageMessage?.caption ||
        m.videoMessage?.caption ||
        m.documentMessage?.caption ||
        m.buttonsResponseMessage?.selectedDisplayText ||
        m.buttonsResponseMessage?.selectedButtonId ||
        m.templateButtonReplyMessage?.selectedDisplayText ||
        m.templateButtonReplyMessage?.selectedId ||
        interactiveText ||
        m.interactiveResponseMessage?.body?.text ||
        m.listResponseMessage?.singleSelectReply?.selectedRowId ||
        m.listResponseMessage?.title ||
        ''
    );
}

