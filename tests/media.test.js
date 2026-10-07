import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { addStickerExif, generateAttpSticker, circleSticker, applyImageFilter } from '../src/utils/media.js';
import { extractText } from '../src/utils/antiBug.js';

describe('Media & Utilities Deep Tests', () => {
    test('addStickerExif injects valid RIFF webp exif metadata chunk', () => {
        // Create a mock RIFF WEBP buffer
        const mockRiff = Buffer.from('RIFF\x20\x00\x00\x00WEBPVP8 \x10\x00\x00\x00dummywebppayload');
        const output = addStickerExif(mockRiff, 'CustomPack', 'CustomAuthor');

        assert.ok(output.length > mockRiff.length, 'Output buffer must include injected EXIF chunk');
        const str = output.toString('utf-8');
        assert.ok(str.includes('CustomPack'), 'Must contain pack name');
        assert.ok(str.includes('CustomAuthor'), 'Must contain author name');
        assert.ok(str.includes('EXIF'), 'Must contain EXIF header');
    });

    test('extractText extracts from all Baileys message variants', () => {
        assert.equal(extractText({ message: { conversation: 'test 1' } }), 'test 1');
        assert.equal(extractText({ message: { extendedTextMessage: { text: 'test 2' } } }), 'test 2');
        assert.equal(extractText({ message: { imageMessage: { caption: 'test 3' } } }), 'test 3');
        assert.equal(extractText({ message: { videoMessage: { caption: 'test 4' } } }), 'test 4');
        assert.equal(extractText({ message: { buttonsResponseMessage: { selectedButtonId: '.ping' } } }), '.ping');
    });

    test('generateAttpSticker creates a valid WebP sticker buffer', async () => {
        const buf = await generateAttpSticker('GAARA TEST');
        assert.ok(Buffer.isBuffer(buf), 'Must return a Buffer');
        assert.ok(buf.length > 500, 'Must have substantial image data');
        assert.equal(buf.subarray(0, 4).toString(), 'RIFF', 'Must start with RIFF header');
        assert.equal(buf.subarray(8, 12).toString(), 'WEBP', 'Must have WEBP identifier');
    });
});
