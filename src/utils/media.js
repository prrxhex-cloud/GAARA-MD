import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import logger from './logger.js';

/**
 * Executes an FFmpeg command with input and output buffers or files.
 */
function runFfmpeg(args, inputBuffer = null) {
    return new Promise((resolve, reject) => {
        const proc = spawn('ffmpeg', args, { windowsHide: true });
        const stdoutChunks = [];
        const stderrChunks = [];

        if (inputBuffer && proc.stdin) {
            proc.stdin.on('error', () => {
                // Ignore EPIPE if ffmpeg finished early
            });
            proc.stdin.write(inputBuffer);
            proc.stdin.end();
        }

        proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
        proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

        const timer = setTimeout(() => {
            proc.kill('SIGKILL');
            reject(new Error('FFmpeg process timed out (30s)'));
        }, 30000);

        proc.on('close', (code) => {
            clearTimeout(timer);
            if (code === 0) {
                resolve(Buffer.concat(stdoutChunks));
            } else {
                const errStr = Buffer.concat(stderrChunks).toString('utf-8');
                reject(new Error(`FFmpeg exited with code ${code}: ${errStr.slice(-300)}`));
            }
        });

        proc.on('error', (err) => {
            clearTimeout(timer);
            reject(err);
        });
    });
}

/**
 * Detects an available system TrueType font for drawtext.
 */
function findSystemFont() {
    const candidateFonts = [
        'C:/Windows/Fonts/arialbd.ttf',
        'C:/Windows/Fonts/arial.ttf',
        'C:/Windows/Fonts/segoeui.ttf',
        'C:/Windows/Fonts/seguiemj.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSansBold.ttf',
        '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf'
    ];

    for (const font of candidateFonts) {
        if (fs.existsSync(font)) {
            // Escape colon for FFmpeg filter on Windows
            return font.replace(':', '\\:');
        }
    }
    return null;
}

/**
 * Converts Image or short Video buffer to animated or static WebP Sticker.
 */
export async function createSticker(mediaBuffer, isVideo = false) {
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `stk_in_${crypto.randomBytes(4).toString('hex')}.${isVideo ? 'mp4' : 'png'}`);
    const tempOut = path.join(tempDir, `stk_out_${crypto.randomBytes(4).toString('hex')}.webp`);

    try {
        await fs.promises.writeFile(tempIn, mediaBuffer);

        const args = isVideo
            ? [
                  '-y',
                  '-i', tempIn,
                  '-t', '7',
                  '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,fps=15,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                  '-c:v', 'libwebp',
                  '-lossless', '0',
                  '-compression_level', '4',
                  '-q:v', '60',
                  '-loop', '0',
                  '-an',
                  '-vsync', '0',
                  tempOut
              ]
            : [
                  '-y',
                  '-i', tempIn,
                  '-vf', 'scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000',
                  '-c:v', 'libwebp',
                  '-lossless', '1',
                  '-q:v', '90',
                  tempOut
              ];

        await runFfmpeg(args);
        return await fs.promises.readFile(tempOut);
    } finally {
        fs.promises.unlink(tempIn).catch(() => {});
        fs.promises.unlink(tempOut).catch(() => {});
    }
}

/**
 * Converts Image buffer into a circular cropped WebP sticker.
 */
export async function circleSticker(mediaBuffer) {
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `circ_in_${crypto.randomBytes(4).toString('hex')}.png`);
    const tempOut = path.join(tempDir, `circ_out_${crypto.randomBytes(4).toString('hex')}.webp`);

    try {
        await fs.promises.writeFile(tempIn, mediaBuffer);
        const args = [
            '-y',
            '-i', tempIn,
            '-vf', "scale=512:512:force_original_aspect_ratio=increase,crop=512:512,format=yuva420p,geq=lum='p(X,Y)':a='if(lte(hypot(X-256,Y-256),250),255,0)'",
            '-c:v', 'libwebp',
            '-lossless', '1',
            '-q:v', '90',
            tempOut
        ];
        await runFfmpeg(args);
        return await fs.promises.readFile(tempOut);
    } finally {
        fs.promises.unlink(tempIn).catch(() => {});
        fs.promises.unlink(tempOut).catch(() => {});
    }
}

/**
 * Generates an ATTP / TTP text sticker using FFmpeg drawtext or public fallback.
 */
export async function generateAttpSticker(text) {
    const cleanText = (text || 'GAARA X MD').slice(0, 30).trim();
    const tempDir = os.tmpdir();
    const tempOut = path.join(tempDir, `attp_out_${crypto.randomBytes(4).toString('hex')}.webp`);

    const fontFile = findSystemFont();
    if (fontFile) {
        try {
            // Calculate appropriate fontsize based on character length
            const len = cleanText.length;
            const fontSize = len <= 6 ? 56 : len <= 12 ? 44 : len <= 20 ? 34 : 26;

            // Escape special characters for FFmpeg filter
            const escapedText = cleanText
                .replace(/\\/g, '\\\\')
                .replace(/'/g, "\\'")
                .replace(/:/g, '\\:')
                .replace(/%/g, '\\%');

            const filter = `drawtext=fontfile='${fontFile}':text='${escapedText}':fontsize=${fontSize}:fontcolor=white:x=(w-text_w)/2:y=(h-text_h)/2:borderw=4:bordercolor=0xEC003B`;

            const args = [
                '-y',
                '-f', 'lavfi',
                '-i', 'color=c=0x00000000:s=512x512:d=0.2',
                '-vf', filter,
                '-c:v', 'libwebp',
                '-vframes', '1',
                tempOut
            ];

            await runFfmpeg(args);
            const buffer = await fs.promises.readFile(tempOut);
            return buffer;
        } catch (err) {
            logger.warn({ err: err.message }, '[Media] Local ATTP generation failed, falling back to API');
        } finally {
            fs.promises.unlink(tempOut).catch(() => {});
        }
    }

    // Fallback: Fetch from public ATTP web service
    const endpoints = [
        `https://api.siputzx.my.id/api/m/attp?text=${encodeURIComponent(cleanText)}`,
        `https://widipe.com/attp?text=${encodeURIComponent(cleanText)}`
    ];

    for (const ep of endpoints) {
        try {
            const res = await fetch(ep, { signal: AbortSignal.timeout(10000) });
            if (res.ok) {
                const arr = await res.arrayBuffer();
                return Buffer.from(arr);
            }
        } catch {}
    }

    throw new Error('Unable to generate ATTP sticker (local font & web APIs failed)');
}

/**
 * Applies graphic filters (blur, invert, greyscale) to an image buffer.
 */
export async function applyImageFilter(mediaBuffer, filterType) {
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `filt_in_${crypto.randomBytes(4).toString('hex')}.png`);
    const tempOut = path.join(tempDir, `filt_out_${crypto.randomBytes(4).toString('hex')}.png`);

    let vf = 'null';
    if (filterType === 'blur') vf = 'gblur=sigma=12';
    else if (filterType === 'invert') vf = 'negate';
    else if (filterType === 'greyscale' || filterType === 'gray') vf = 'hue=s=0';

    try {
        await fs.promises.writeFile(tempIn, mediaBuffer);
        await runFfmpeg(['-y', '-i', tempIn, '-vf', vf, '-vframes', '1', tempOut]);
        return await fs.promises.readFile(tempOut);
    } finally {
        fs.promises.unlink(tempIn).catch(() => {});
        fs.promises.unlink(tempOut).catch(() => {});
    }
}

/**
 * Embeds WhatsApp Exif metadata (pack name and author) into a WebP sticker buffer.
 */
export function addStickerExif(webpBuffer, packname = 'GAARA X MD', author = 'GAARA DEV OFC') {
    const json = {
        'sticker-pack-id': 'com.gaaradev.gaaraxmd',
        'sticker-pack-name': packname,
        'sticker-pack-publisher': author,
        'emojis': ['🌸', '⚡']
    };

    const jsonBuff = Buffer.from(JSON.stringify(json), 'utf-8');
    const exif = Buffer.concat([
        Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00]),
        Buffer.from([jsonBuff.length & 0xff, (jsonBuff.length >> 8) & 0xff, 0x00, 0x00]),
        Buffer.from([0x16, 0x00, 0x00, 0x00]),
        jsonBuff
    ]);

    const exifHeader = Buffer.from([0x45, 0x58, 0x49, 0x46]); // EXIF
    const exifChunk = Buffer.concat([
        exifHeader,
        Buffer.from([exif.length & 0xff, (exif.length >> 8) & 0xff, (exif.length >> 16) & 0xff, (exif.length >> 24) & 0xff]),
        exif
    ]);

    // Check if webp is valid RIFF WEBP
    if (webpBuffer.length > 12 && webpBuffer.slice(0, 4).toString() === 'RIFF') {
        const riffHeader = webpBuffer.slice(0, 12);
        const rest = webpBuffer.slice(12);
        return Buffer.concat([riffHeader, exifChunk, rest]);
    }

    return webpBuffer;
}

/**
 * Converts WebP sticker to PNG/JPG image buffer.
 */
export async function stickerToImage(webpBuffer) {
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `stk_in_${crypto.randomBytes(4).toString('hex')}.webp`);
    const tempOut = path.join(tempDir, `img_out_${crypto.randomBytes(4).toString('hex')}.png`);

    try {
        await fs.promises.writeFile(tempIn, webpBuffer);
        await runFfmpeg(['-y', '-i', tempIn, '-vframes', '1', tempOut]);
        return await fs.promises.readFile(tempOut);
    } finally {
        fs.promises.unlink(tempIn).catch(() => {});
        fs.promises.unlink(tempOut).catch(() => {});
    }
}

/**
 * Converts Video or Audio to MP3 audio buffer.
 */
export async function toMp3(mediaBuffer) {
    const tempDir = os.tmpdir();
    const tempIn = path.join(tempDir, `aud_in_${crypto.randomBytes(4).toString('hex')}.tmp`);
    const tempOut = path.join(tempDir, `aud_out_${crypto.randomBytes(4).toString('hex')}.mp3`);

    try {
        await fs.promises.writeFile(tempIn, mediaBuffer);
        await runFfmpeg(['-y', '-i', tempIn, '-vn', '-acodec', 'libmp3lame', '-ab', '128k', '-ar', '44100', tempOut]);
        return await fs.promises.readFile(tempOut);
    } finally {
        fs.promises.unlink(tempIn).catch(() => {});
        fs.promises.unlink(tempOut).catch(() => {});
    }
}
