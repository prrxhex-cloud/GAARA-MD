import db from '../../config/database.js';
import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

/**
 * Handles incoming WhatsApp voice/video calls.
 * Implements 3 warnings and auto-blocks on 4th attempt.
 */
export async function handleCall(sock, calls) {
    if (!Array.isArray(calls) || calls.length === 0) return;

    const settings = db.getSettings();
    if (!settings.antiCall) return;

    for (const call of calls) {
        try {
            // Only act when call is offered / ringing
            if (call.status !== 'offer') continue;

            const callerJid = call.from;
            const callerNumber = callerJid.split('@')[0];

            logger.info({ caller: callerJid, isVideo: call.isVideo }, '[AntiCall] Intercepted incoming call');

            // 1. Immediately reject/hangup the call
            try {
                if (sock.hangupCall) {
                    await sock.hangupCall(call.id, callerJid);
                } else if (sock.rejectCall) {
                    await sock.rejectCall(call.id, callerJid);
                }
            } catch (err) {
                logger.warn({ err: err.message }, '[AntiCall] Could not hangup call');
            }

            // 2. Track warning counts
            const currentCount = db.recordCall(callerJid);
            const maxWarnings = settings.antiCallMaxWarnings || 3;

            if (currentCount <= maxWarnings) {
                const remaining = maxWarnings - currentCount;
                const remainingText =
                    remaining > 0
                        ? `You have ${remaining} warning(s) left before your number is automatically blocked.`
                        : `This was your FINAL warning. The next call attempt will result in an immediate BLOCK!`;

                let body = settings.antiCallTemplate || '⚠️ *CALL REJECTED*\nWarning: {warning}/3\nCaller: {caller}\n{remaining_text}';
                body = body
                    .replace('{warning}', currentCount.toString())
                    .replace('{caller}', `@${callerNumber}`)
                    .replace('{remaining_text}', remainingText);

                const framed = formatFramedMessage([
                    {
                        emoji: '📵',
                        title: 'CALL REJECTED',
                        content: [
                            `⚠️ *VOICE / VIDEO CALLS ARE NOT ALLOWED*`,
                            ``,
                            `👤 Caller: @${callerNumber}`,
                            `📊 Warning: ${currentCount}/${maxWarnings}`,
                            `ℹ️ ${remainingText}`
                        ]
                    }
                ]);

                await sock.sendMessage(callerJid, {
                    text: framed,
                    mentions: [callerJid]
                });

                logger.info({ caller: callerJid, warning: currentCount }, '[AntiCall] Sent warning message');
            } else {
                // 4th attempt or above: Auto Block
                const blockNotice = formatFramedMessage([
                    {
                        emoji: '⛔',
                        title: 'BLOCKED FOR CALL SPAM',
                        content: [
                            `🚫 *YOU HAVE BEEN BLOCKED*`,
                            ``,
                            `👤 Number: +${callerNumber}`,
                            `Reason: Exceeded maximum call warnings (${maxWarnings}/${maxWarnings}).`,
                            `Calls are strictly forbidden on this bot.`
                        ]
                    }
                ]);

                await sock.sendMessage(callerJid, { text: blockNotice });

                // Execute block status update
                await sock.updateBlockStatus(callerJid, 'block');
                db.resetCallWarnings(callerJid);

                logger.warn({ caller: callerJid }, '[AntiCall] Caller blocked after repeated calls');
            }
        } catch (err) {
            logger.error({ err: err.message }, '[AntiCall] Error processing call');
        }
    }
}
