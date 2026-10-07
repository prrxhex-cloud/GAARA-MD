import {
    createSticker,
    circleSticker,
    generateAttpSticker,
    applyImageFilter,
    addStickerExif,
    stickerToImage,
    toMp3
} from '../utils/media.js';
import { formatFramedMessage, resolveDestinationJid } from '../bot/format.js';
import db from '../../config/database.js';
import logger from '../utils/logger.js';

export const mediaCommands = {
    sticker: {
        description: 'Convert image or video to WhatsApp sticker',
        aliases: ['s', 'stk'],
        run: async ({ sock, msg, jid, args }) => {
            let targetMsg = msg;
            let isVideo = false;

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                targetMsg = { message: quoted };
            }

            const m = targetMsg.message;
            if (!m) {
                return sock.sendMessage(jid, { text: '⚠️ Please send or reply to an image or short video with *.sticker*' }, { quoted: msg });
            }

            const isImage = !!m.imageMessage;
            isVideo = !!m.videoMessage;

            if (!isImage && !isVideo) {
                return sock.sendMessage(jid, { text: '⚠️ Target must be an image or video.' }, { quoted: msg });
            }

            if (isVideo && (m.videoMessage.seconds || 0) > 10) {
                return sock.sendMessage(jid, { text: '⚠️ Video must be 10 seconds or shorter for sticker conversion.' }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: '⏳ Creating sticker...' }, { quoted: msg });

                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia(targetMsg)
                    : await sock.downloadMediaMessage(targetMsg, 'buffer', {});

                if (!buffer) throw new Error('Could not download media');

                const webp = await createSticker(buffer, isVideo);
                const settings = db.getSettings();
                const withExif = addStickerExif(webp, settings.botName, settings.ownerName);

                if (sock.sendSticker) {
                    await sock.sendSticker(jid, withExif, isVideo);
                } else {
                    await sock.sendMessage(jid, { sticker: withExif }, { quoted: msg });
                }
            } catch (err) {
                logger.error({ err: err.message }, '[Media] Sticker creation failed');
                await sock.sendMessage(jid, { text: `❌ Sticker failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    take: {
        description: 'Steal or change watermark of quoted sticker',
        aliases: ['wm', 'steal'],
        run: async ({ sock, msg, jid, args }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.stickerMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to a sticker with *.take PackName|Author*' }, { quoted: msg });
            }

            let pack = 'GAARA X MD';
            let author = 'GAARA DEV OFC';

            if (args.length > 0) {
                const combined = args.join(' ');
                const parts = combined.split('|');
                pack = (parts[0] || pack).trim();
                author = (parts[1] || author).trim();
            }

            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: quoted })
                    : await sock.downloadMediaMessage({ message: quoted }, 'buffer', {});

                const withExif = addStickerExif(buffer, pack, author);
                await sock.sendMessage(jid, { sticker: withExif }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Take watermark failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    toimg: {
        description: 'Convert quoted sticker to image',
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (!quoted || !quoted.stickerMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to a non-animated sticker with *.toimg*' }, { quoted: msg });
            }

            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: quoted })
                    : await sock.downloadMediaMessage({ message: quoted }, 'buffer', {});

                const imgBuffer = await stickerToImage(buffer);
                await sock.sendMessage(jid, { image: imgBuffer, caption: '✨ Here is your converted image!' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Conversion failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    tomp3: {
        description: 'Convert quoted video or voice note to MP3 audio',
        aliases: ['toaudio'],
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;

            if (!target || (!target.videoMessage && !target.audioMessage)) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to a video or voice note with *.tomp3*' }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: '🎵 Converting to MP3 audio...' }, { quoted: msg });

                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                const mp3Buffer = await toMp3(buffer);
                await sock.sendMessage(jid, { audio: mp3Buffer, mimetype: 'audio/mp4', ptt: false }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ MP3 conversion failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    readviewonce: {
        description: 'Extract and reveal View-Once media as normal media',
        aliases: ['vv', 'viewonce', 'rvo'],
        run: async ({ sock, msg, jid }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const quoted = context?.quotedMessage;

            if (!quoted) {
                return sock.sendMessage(jid, { text: '⚠️ Reply to a View-Once image, video, or audio with *.readviewonce* or *.vv*' }, { quoted: msg });
            }

            let curr = quoted;
            let foundVO = false;
            while (curr) {
                if (curr.ephemeralMessage?.message) {
                    curr = curr.ephemeralMessage.message;
                } else if (curr.viewOnceMessage?.message) {
                    curr = curr.viewOnceMessage.message;
                    foundVO = true;
                } else if (curr.viewOnceMessageV2?.message) {
                    curr = curr.viewOnceMessageV2.message;
                    foundVO = true;
                } else if (curr.viewOnceMessageV2Extension?.message) {
                    curr = curr.viewOnceMessageV2Extension.message;
                    foundVO = true;
                } else if (curr.documentWithCaptionMessage?.message) {
                    curr = curr.documentWithCaptionMessage.message;
                } else {
                    break;
                }
            }

            if (!foundVO && (curr?.imageMessage?.viewOnce || curr?.videoMessage?.viewOnce || curr?.audioMessage?.viewOnce)) {
                foundVO = true;
            }

            if (!foundVO || (!curr?.imageMessage && !curr?.videoMessage && !curr?.audioMessage)) {
                return sock.sendMessage(jid, { text: '⚠️ The quoted message is not a View-Once message.' }, { quoted: msg });
            }

            const viewOnceContent = curr;

            const settings = db.getSettings();
            const destinationChoice = settings.viewOnceDestination || 'self';
            const targetJid = resolveDestinationJid(sock, jid, destinationChoice) || jid;

            try {
                await sock.sendMessage(jid, { text: '🔓 Unlocking View-Once media...' }, { quoted: msg });

                const mediaContainer = { message: viewOnceContent };
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia(mediaContainer)
                    : await sock.downloadMediaMessage(mediaContainer, 'buffer', {});

                if (!buffer) throw new Error('Could not download media stream');

                const senderNum = (msg.key.participant || msg.key.remoteJid).split('@')[0];
                const captionText = `🔓 *View-Once Recovered*\n` +
                    (targetJid !== jid ? `👤 *Requester:* @${senderNum}\n` : '') +
                    `${viewOnceContent.imageMessage?.caption || viewOnceContent.videoMessage?.caption || ''}`;

                if (viewOnceContent.imageMessage) {
                    await sock.sendMessage(targetJid, {
                        image: buffer,
                        caption: captionText,
                        mentions: [msg.key.participant || msg.key.remoteJid]
                    });
                } else if (viewOnceContent.videoMessage) {
                    await sock.sendMessage(targetJid, {
                        video: buffer,
                        caption: captionText,
                        mentions: [msg.key.participant || msg.key.remoteJid]
                    });
                } else if (viewOnceContent.audioMessage) {
                    await sock.sendMessage(targetJid, {
                        audio: buffer,
                        mimetype: viewOnceContent.audioMessage.mimetype || 'audio/mp4',
                        ptt: viewOnceContent.audioMessage.ptt || false
                    });
                }

                if (targetJid !== jid) {
                    await sock.sendMessage(jid, { text: '✅ View-Once media successfully unlocked and sent to your Self Chat!' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to extract view-once media: ${err.message}` }, { quoted: msg });
            }
        }
    },

    attp: {
        description: 'Generate text sticker with colorful styling',
        aliases: ['ttp'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide text. Example: *.attp GAARA*' }, { quoted: msg });
            }

            const text = args.join(' ');
            try {
                const sticker = await generateAttpSticker(text);
                const settings = db.getSettings();
                const withExif = addStickerExif(sticker, settings.botName, settings.ownerName);

                await sock.sendMessage(jid, { sticker: withExif }, { quoted: msg });
            } catch (err) {
                logger.error({ err: err.message }, '[Media] ATTP sticker error');
                await sock.sendMessage(jid, { text: `❌ ATTP sticker error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    round: {
        description: 'Crop an image into a circular sticker',
        aliases: ['circle'],
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;

            if (!target || !target.imageMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to or send an image with *.round*' }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: '⭕ Creating circular sticker...' }, { quoted: msg });

                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                const webp = await circleSticker(buffer);
                const settings = db.getSettings();
                const withExif = addStickerExif(webp, settings.botName, settings.ownerName);

                await sock.sendMessage(jid, { sticker: withExif }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Round sticker failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    emojimix: {
        description: 'Mix two emojis into a custom sticker',
        aliases: ['mix'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.emojimix <emoji1>+<emoji2>* or *.emojimix 😂 🔥*' }, { quoted: msg });
            }

            let e1 = '';
            let e2 = '';

            const input = args.join(' ');
            if (input.includes('+')) {
                const parts = input.split('+');
                e1 = parts[0].trim();
                e2 = parts[1].trim();
            } else if (args.length >= 2) {
                e1 = args[0].trim();
                e2 = args[1].trim();
            } else {
                // Try splitting consecutive emoji characters
                const chars = Array.from(input.trim());
                if (chars.length >= 2) {
                    e1 = chars[0];
                    e2 = chars[1];
                }
            }

            if (!e1 || !e2) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide two valid emojis to mix, e.g. *.emojimix 😂 🔥*' }, { quoted: msg });
            }

            try {
                await sock.sendMessage(jid, { text: `✨ Mixing ${e1} + ${e2}...` }, { quoted: msg });

                const url = `https://emojik.vercel.app/s/${encodeURIComponent(e1)}_${encodeURIComponent(e2)}?size=512`;
                const res = await fetch(url, { signal: AbortSignal.timeout(12000) });
                if (!res.ok) {
                    throw new Error(`Google Emoji Kitchen does not support mixing ${e1} and ${e2}`);
                }

                const pngBuffer = Buffer.from(await res.arrayBuffer());
                const webp = await createSticker(pngBuffer, false);
                const settings = db.getSettings();
                const withExif = addStickerExif(webp, `${e1}+${e2}`, settings.ownerName);

                await sock.sendMessage(jid, { sticker: withExif }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ EmojiMix failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    blur: {
        description: 'Apply blur filter to an image',
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;
            if (!target || !target.imageMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to an image with *.blur*' }, { quoted: msg });
            }

            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                const blurred = await applyImageFilter(buffer, 'blur');
                await sock.sendMessage(jid, { image: blurred, caption: '🌫️ Image blurred successfully!' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Blur filter failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    invert: {
        description: 'Invert colors of an image',
        aliases: ['negative'],
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;
            if (!target || !target.imageMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to an image with *.invert*' }, { quoted: msg });
            }

            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                const inverted = await applyImageFilter(buffer, 'invert');
                await sock.sendMessage(jid, { image: inverted, caption: '🔄 Image colors inverted!' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Invert filter failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    greyscale: {
        description: 'Convert image to black and white greyscale',
        aliases: ['gray', 'bw'],
        run: async ({ sock, msg, jid }) => {
            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            const target = quoted || msg.message;
            if (!target || !target.imageMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to an image with *.greyscale*' }, { quoted: msg });
            }

            try {
                const buffer = sock.downloadMedia
                    ? await sock.downloadMedia({ message: target })
                    : await sock.downloadMediaMessage({ message: target }, 'buffer', {});

                const gray = await applyImageFilter(buffer, 'greyscale');
                await sock.sendMessage(jid, { image: gray, caption: '🎞️ Converted to greyscale!' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Greyscale filter failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
};
