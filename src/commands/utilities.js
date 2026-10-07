import QRCode from 'qrcode';
import crypto from 'crypto';
import { formatFramedMessage } from '../bot/format.js';
import { extractText } from '../utils/antiBug.js';

/**
 * Safely evaluates mathematical expressions including exponents and standard Math functions.
 */
function safeCalc(expr) {
    if (!expr || typeof expr !== 'string') throw new Error('Empty expression');

    // Replace '^' with '**'
    let sanitized = expr.replace(/\^/g, '**');

    // Convert common math constants and functions
    sanitized = sanitized
        .replace(/\bpi\b/gi, 'Math.PI')
        .replace(/\be\b/gi, 'Math.E')
        .replace(/\bsqrt\b/gi, 'Math.sqrt')
        .replace(/\bcbrt\b/gi, 'Math.cbrt')
        .replace(/\babs\b/gi, 'Math.abs')
        .replace(/\bsin\b/gi, 'Math.sin')
        .replace(/\bcos\b/gi, 'Math.cos')
        .replace(/\btan\b/gi, 'Math.tan')
        .replace(/\blog\b/gi, 'Math.log10')
        .replace(/\bln\b/gi, 'Math.log')
        .replace(/\bround\b/gi, 'Math.round')
        .replace(/\bfloor\b/gi, 'Math.floor')
        .replace(/\bceil\b/gi, 'Math.ceil');

    // Validate characters: only digits, operators, parentheses, and Math functions allowed
    if (!/^[0-9+\-*/().%^ ,]|Math\.(PI|E|sqrt|cbrt|abs|sin|cos|tan|log10|log|round|floor|ceil)+$/.test(sanitized)) {
        // Strip out allowed tokens and check for forbidden ones
        const stripped = sanitized.replace(/Math\.(PI|E|sqrt|cbrt|abs|sin|cos|tan|log10|log|round|floor|ceil)/g, '');
        if (!/^[0-9+\-*/().% ,]+$/.test(stripped.replace(/\s+/g, ''))) {
            throw new Error('Invalid math characters detected');
        }
    }

    const fn = new Function(`"use strict"; return (${sanitized});`);
    const res = fn();
    if (typeof res !== 'number' || !isFinite(res)) {
        throw new Error('Calculation did not yield a finite number');
    }
    return Number(res.toFixed(8)) / 1; // Round cleanly
}

// Morse code dictionaries
const MORSE_MAP = {
    'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.', 'F': '..-.',
    'G': '--.', 'H': '....', 'I': '..', 'J': '.---', 'K': '-.-', 'L': '.-..',
    'M': '--', 'N': '-.', 'O': '---', 'P': '.--.', 'Q': '--.-', 'R': '.-.',
    'S': '...', 'T': '-', 'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-',
    'Y': '-.--', 'Z': '--..', '1': '.----', '2': '..---', '3': '...--',
    '4': '....-', '5': '.....', '6': '-....', '7': '--...', '8': '---..',
    '9': '----.', '0': '-----', ' ': '/'
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));

// Fancy font mappings
const FANCY_FONTS = {
    bold: (t) => t.replace(/[a-zA-Z0-9]/g, c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D400 + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D41A + code - 97);
        if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7CE + code - 48);
        return c;
    }),
    italic: (t) => t.replace(/[a-zA-Z]/g, c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D434 + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D44E + code - 97);
        return c;
    }),
    mono: (t) => t.replace(/[a-zA-Z0-9]/g, c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D670 + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D68A + code - 97);
        if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7F6 + code - 48);
        return c;
    }),
    doubleStruck: (t) => t.replace(/[a-zA-Z0-9]/g, c => {
        const code = c.charCodeAt(0);
        if (code >= 65 && code <= 90) return String.fromCodePoint(0x1D538 + code - 65);
        if (code >= 97 && code <= 122) return String.fromCodePoint(0x1D552 + code - 97);
        if (code >= 48 && code <= 57) return String.fromCodePoint(0x1D7D8 + code - 48);
        return c;
    })
};

export const utilityCommands = {
    calc: {
        description: 'Safe calculator for mathematical expressions and functions',
        aliases: ['calculate', 'math'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide an expression. Example: *.calc 25 * 4 + sqrt(144)*' }, { quoted: msg });
            }

            const expr = args.join(' ');
            try {
                const result = safeCalc(expr);
                const text = formatFramedMessage([
                    {
                        emoji: '🧮',
                        title: 'CALCULATOR',
                        content: [
                            `📝 *Expression:* ${expr}`,
                            `✅ *Result:* *${result}*`
                        ]
                    }
                ]);
                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Math Error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    qr: {
        description: 'Generate QR code image from text or URL',
        aliases: ['qrcode'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide text or URL. Example: *.qr https://google.com*' }, { quoted: msg });
            }

            const input = args.join(' ');
            try {
                const qrBuffer = await QRCode.toBuffer(input, {
                    width: 512,
                    margin: 2,
                    color: {
                        dark: '#000000',
                        light: '#ffffff'
                    }
                });

                await sock.sendMessage(jid, {
                    image: qrBuffer,
                    caption: `╭───[ ⚡ QR GENERATOR ]\n│◇│\n│◇│  Data: ${input}\n│◇│\n╰────────────────────\n\nTHIS BOT BUILT BY GAARA DEV OFC.`
                }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Failed to generate QR code: ${err.message}` }, { quoted: msg });
            }
        }
    },

    weather: {
        description: 'Get live weather conditions for a city',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Please provide a city name. Example: *.weather Tokyo*' }, { quoted: msg });
            }

            const city = args.join(' ');
            try {
                const res = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`, {
                    signal: AbortSignal.timeout(8000)
                });

                if (!res.ok) throw new Error('City not found or service unavailable');
                const data = await res.json();
                const current = data.current_condition?.[0];
                if (!current) throw new Error('No weather data received');

                const tempC = current.temp_C;
                const tempF = current.temp_F;
                const desc = current.weatherDesc?.[0]?.value || 'Clear';
                const humidity = current.humidity;
                const wind = current.windspeedKmph;

                const text = formatFramedMessage([
                    {
                        emoji: '🌤️',
                        title: `WEATHER: ${city.toUpperCase()}`,
                        content: [
                            `🌡️ *Temperature:* ${tempC}°C / ${tempF}°F`,
                            `☁️ *Condition:* ${desc}`,
                            `💧 *Humidity:* ${humidity}%`,
                            `💨 *Wind Speed:* ${wind} km/h`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Weather search failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    translate: {
        description: 'Translate text to a specified language',
        aliases: ['tr'],
        run: async ({ sock, msg, jid, args }) => {
            let targetLang = 'en';
            let textToTranslate = '';

            const quoted = msg.message?.extendedTextMessage?.contextInfo?.quotedMessage;
            if (quoted) {
                targetLang = args[0] || 'en';
                textToTranslate = extractText({ message: quoted });
            } else if (args.length >= 2 && args[0].length <= 5) {
                targetLang = args[0];
                textToTranslate = args.slice(1).join(' ');
            } else if (args.length >= 1) {
                targetLang = 'en';
                textToTranslate = args.join(' ');
            } else {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.translate <lang> <text>* or reply to a message with *.translate <lang>*' }, { quoted: msg });
            }

            if (!textToTranslate) {
                return sock.sendMessage(jid, { text: '⚠️ No text found to translate.' }, { quoted: msg });
            }

            try {
                const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=${targetLang}&dt=t&q=${encodeURIComponent(textToTranslate)}`;
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const json = await res.json();
                const translated = json[0].map(item => item[0]).join('');

                const text = formatFramedMessage([
                    {
                        emoji: '🌐',
                        title: `TRANSLATION [→ ${targetLang.toUpperCase()}]`,
                        content: [
                            `📥 *Original:* ${textToTranslate}`,
                            `📤 *Translated:* *${translated}*`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Translation error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    tts: {
        description: 'Convert text into spoken voice audio',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.tts <lang> <text>*. Example: *.tts en Hello GAARA X MD*' }, { quoted: msg });
            }

            let lang = 'en';
            let speechText = '';
            if (args.length > 1 && args[0].length === 2) {
                lang = args[0];
                speechText = args.slice(1).join(' ');
            } else {
                speechText = args.join(' ');
            }

            try {
                const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&tl=${lang}&client=tw-ob&q=${encodeURIComponent(speechText)}`;
                const res = await fetch(ttsUrl, {
                    headers: { 'User-Agent': 'Mozilla/5.0' },
                    signal: AbortSignal.timeout(10000)
                });

                if (!res.ok) throw new Error('TTS service failed');
                const arrayBuffer = await res.arrayBuffer();
                const buffer = Buffer.from(arrayBuffer);

                await sock.sendMessage(jid, { audio: buffer, mimetype: 'audio/mp4', ptt: true }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ TTS failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    quoted: {
        description: 'Inspect and display quoted message information',
        run: async ({ sock, msg, jid }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            if (!context || !context.quotedMessage) {
                return sock.sendMessage(jid, { text: '⚠️ Please reply to a message to inspect its metadata.' }, { quoted: msg });
            }

            const sender = context.participant || 'Unknown';
            const stanzaId = context.stanzaId || 'Unknown';
            const quotedText = extractText({ message: context.quotedMessage }) || '(No text / Media message)';

            const text = formatFramedMessage([
                {
                    emoji: '🔎',
                    title: 'QUOTED MESSAGE DETAILS',
                    content: [
                        `👤 *Participant:* @${sender.split('@')[0]}`,
                        `🆔 *Stanza ID:* ${stanzaId}`,
                        `📝 *Content:* ${quotedText}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, mentions: [sender] }, { quoted: msg });
        }
    },

    jid: {
        description: 'Get current chat JID or quoted user JID',
        run: async ({ sock, msg, jid }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const targetJid = context?.participant || jid;

            const text = formatFramedMessage([
                {
                    emoji: '🆔',
                    title: 'JID IDENTIFIER',
                    content: [
                        `📍 *JID:* \`${targetJid}\``,
                        `💬 *Chat:* \`${jid}\``
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    shorturl: {
        description: 'Shorten a long web link',
        aliases: ['tinyurl', 'shortlink'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.shorturl <https://long-url.com>*' }, { quoted: msg });
            }

            const targetUrl = args[0].trim();
            try {
                let short = '';
                // Try is.gd
                try {
                    const r1 = await fetch(`https://is.gd/create.php?format=simple&url=${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(6000) });
                    if (r1.ok) short = (await r1.text()).trim();
                } catch {}

                // Try tinyurl fallback
                if (!short) {
                    const r2 = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(targetUrl)}`, { signal: AbortSignal.timeout(6000) });
                    if (r2.ok) short = (await r2.text()).trim();
                }

                if (!short) throw new Error('Shortener service unavailable');

                const text = formatFramedMessage([
                    {
                        emoji: '🔗',
                        title: 'URL SHORTENER',
                        content: [
                            `Original: ${targetUrl}`,
                            `Shortened: *${short}*`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Shorten failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    time: {
        description: 'Show current world time for major cities or UTC',
        aliases: ['clock'],
        run: async ({ sock, msg, jid, args }) => {
            const now = new Date();
            const timeZones = [
                { city: 'UTC / GMT', tz: 'UTC' },
                { city: 'London (UK)', tz: 'Europe/London' },
                { city: 'New York (EST)', tz: 'America/New_York' },
                { city: 'Tokyo (JST)', tz: 'Asia/Tokyo' },
                { city: 'Dubai (GST)', tz: 'Asia/Dubai' },
                { city: 'Colombo (SLST)', tz: 'Asia/Colombo' }
            ];

            const lines = timeZones.map(item => {
                const formatted = now.toLocaleTimeString('en-US', { timeZone: item.tz, hour12: true, hour: '2-digit', minute: '2-digit', second: '2-digit' });
                return `🕒 *${item.city}:* ${formatted}`;
            });

            const text = formatFramedMessage([
                {
                    emoji: '🌍',
                    title: 'WORLD CLOCK',
                    content: lines
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    define: {
        description: 'Look up English dictionary definition and phonetic pronunciation',
        aliases: ['dict', 'meaning'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.define <word>*. Example: *.define serendipity*' }, { quoted: msg });
            }

            const word = args[0].toLowerCase();
            try {
                const res = await fetch(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {
                    signal: AbortSignal.timeout(8000)
                });

                if (!res.ok) throw new Error(`No definition found for "${word}"`);
                const data = await res.json();
                const entry = data[0];
                const phonetic = entry.phonetic || entry.phonetics?.[0]?.text || '';
                const meaning = entry.meanings?.[0];
                const partOfSpeech = meaning?.partOfSpeech || 'noun';
                const def = meaning?.definitions?.[0]?.definition || 'No definition available';
                const example = meaning?.definitions?.[0]?.example ? `\n_Example: "${meaning.definitions[0].example}"_` : '';

                const text = formatFramedMessage([
                    {
                        emoji: '📖',
                        title: `DICTIONARY: ${word.toUpperCase()}`,
                        content: [
                            phonetic ? `🗣️ *Phonetic:* ${phonetic}` : '',
                            `📌 *Part of Speech:* _${partOfSpeech}_`,
                            `📝 *Definition:* ${def}${example}`
                        ].filter(Boolean)
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Dictionary error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    morse: {
        description: 'Encode text to Morse code or decode Morse code to text',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.morse <text or morse code>*' }, { quoted: msg });
            }

            const input = args.join(' ').trim();
            const isMorse = /^[.\-/\s]+$/.test(input);

            let result = '';
            let mode = '';

            if (isMorse) {
                mode = 'DECODED (Morse ➔ Text)';
                result = input
                    .split(' ')
                    .map(code => REVERSE_MORSE[code] || '?')
                    .join('');
            } else {
                mode = 'ENCODED (Text ➔ Morse)';
                result = input
                    .toUpperCase()
                    .split('')
                    .map(char => MORSE_MAP[char] || char)
                    .join(' ');
            }

            const text = formatFramedMessage([
                {
                    emoji: '📡',
                    title: `MORSE CODE [${mode}]`,
                    content: [
                        `Input: ${input}`,
                        `Result: *${result}*`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    base64: {
        description: 'Encode text to Base64 or decode Base64 string',
        aliases: ['b64'],
        run: async ({ sock, msg, jid, args }) => {
            if (args.length < 2) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.base64 encode <text>* or *.base64 decode <b64string>*' }, { quoted: msg });
            }

            const action = args[0].toLowerCase();
            const content = args.slice(1).join(' ');

            let result = '';
            if (action === 'encode' || action === 'enc') {
                result = Buffer.from(content, 'utf-8').toString('base64');
            } else if (action === 'decode' || action === 'dec') {
                result = Buffer.from(content, 'base64').toString('utf-8');
            } else {
                return sock.sendMessage(jid, { text: '⚠️ Choose action "encode" or "decode".' }, { quoted: msg });
            }

            const text = formatFramedMessage([
                {
                    emoji: '🔐',
                    title: `BASE64 ${action.toUpperCase()}`,
                    content: [
                        `Result:`,
                        `\`${result}\``
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    binary: {
        description: 'Convert text to binary or binary to text',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.binary <text or 010101>*' }, { quoted: msg });
            }

            const input = args.join(' ').trim();
            const isBinary = /^[01\s]+$/.test(input) && input.replace(/\s+/g, '').length % 8 === 0;

            let result = '';
            let title = '';

            if (isBinary) {
                title = 'BINARY ➔ TEXT';
                const bytes = input.split(/\s+/).filter(Boolean);
                result = bytes.map(b => String.fromCharCode(parseInt(b, 2))).join('');
            } else {
                title = 'TEXT ➔ BINARY';
                result = Array.from(input)
                    .map(c => c.charCodeAt(0).toString(2).padStart(8, '0'))
                    .join(' ');
            }

            const text = formatFramedMessage([
                {
                    emoji: '💻',
                    title,
                    content: [
                        `Input: ${input}`,
                        `Result: \`${result}\``
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    currency: {
        description: 'Convert currency amount between foreign currencies',
        aliases: ['convert', 'curr'],
        run: async ({ sock, msg, jid, args }) => {
            if (args.length < 3) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.currency <amount> <FROM> <TO>*. Example: *.currency 100 USD EUR*' }, { quoted: msg });
            }

            const amount = parseFloat(args[0]);
            const from = args[1].toUpperCase();
            const to = args[2].toUpperCase();

            if (isNaN(amount)) {
                return sock.sendMessage(jid, { text: '❌ Invalid amount provided.' }, { quoted: msg });
            }

            try {
                const res = await fetch(`https://open.er-api.com/v6/latest/${from}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error('Currency API error');
                const data = await res.json();

                if (!data.rates || !data.rates[to]) {
                    throw new Error(`Currency code ${to} not recognized`);
                }

                const rate = data.rates[to];
                const converted = (amount * rate).toFixed(2);

                const text = formatFramedMessage([
                    {
                        emoji: '💱',
                        title: 'CURRENCY EXCHANGE',
                        content: [
                            `💵 *Amount:* ${amount} ${from}`,
                            `💶 *Converted:* *${converted} ${to}*`,
                            `📈 *Rate:* 1 ${from} = ${rate} ${to}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Currency conversion failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    ip: {
        description: 'Lookup geolocation and ISP data for an IP address',
        aliases: ['whois', 'ipinfo'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.ip <IP Address>*. Example: *.ip 8.8.8.8*' }, { quoted: msg });
            }

            const ip = args[0].trim();
            try {
                const res = await fetch(`http://ip-api.com/json/${encodeURIComponent(ip)}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error('IP service error');
                const data = await res.json();

                if (data.status === 'fail') {
                    throw new Error(data.message || 'Lookup failed');
                }

                const text = formatFramedMessage([
                    {
                        emoji: '🌐',
                        title: `IP LOOKUP: ${ip}`,
                        content: [
                            `📍 *Country:* ${data.country} (${data.countryCode})`,
                            `🏙️ *Region/City:* ${data.regionName}, ${data.city}`,
                            `📮 *ZIP:* ${data.zip || 'N/A'}`,
                            `🏢 *ISP:* ${data.isp}`,
                            `🌐 *AS:* ${data.as || 'N/A'}`,
                            `🕒 *Timezone:* ${data.timezone}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ IP lookup failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    fliptext: {
        description: 'Flip text upside down or reverse it',
        aliases: ['reverse'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.fliptext <text>*' }, { quoted: msg });
            }

            const input = args.join(' ');
            const reversed = Array.from(input).reverse().join('');

            const flipChars = {
                'a': 'ɐ', 'b': 'q', 'c': 'ɔ', 'd': 'p', 'e': 'ǝ', 'f': 'ɟ', 'g': 'ƃ',
                'h': 'ɥ', 'i': 'ᴉ', 'j': 'ɾ', 'k': 'ʞ', 'l': 'l', 'm': 'ɯ', 'n': 'u',
                'o': 'o', 'p': 'd', 'q': 'b', 'r': 'ɹ', 's': 's', 't': 'ʇ', 'u': 'n',
                'v': 'ʌ', 'w': 'ʍ', 'x': 'x', 'y': 'ʎ', 'z': 'z',
                'A': '∀', 'B': '𐐒', 'C': 'Ɔ', 'D': 'p', 'E': 'Ǝ', 'F': 'Ⅎ', 'G': 'פ',
                'H': 'H', 'I': 'I', 'J': 'ſ', 'K': 'ʞ', 'L': '˥', 'M': 'W', 'N': 'N',
                'O': 'O', 'P': 'Ԁ', 'Q': 'Ό', 'R': 'ɹ', 'S': 'S', 'T': '┴', 'U': '∩',
                'V': 'Λ', 'W': 'M', 'X': 'X', 'Y': '⅄', 'Z': 'Z',
                '1': 'Ɩ', '2': 'ᄅ', '3': 'Ɛ', '4': 'ㄣ', '5': 'ϛ', '6': '9', '7': 'ㄥ',
                '8': '8', '9': '6', '0': '0', '.': '˙', ',': '\'', '?': '¿', '!': '¡'
            };

            const upsideDown = Array.from(input).reverse().map(c => flipChars[c] || c).join('');

            const text = formatFramedMessage([
                {
                    emoji: '🙃',
                    title: 'FLIP TEXT',
                    content: [
                        `Original: ${input}`,
                        `Reversed: *${reversed}*`,
                        `Upside Down: *${upsideDown}*`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    fancy: {
        description: 'Generate stylish fancy fonts for text',
        aliases: ['style', 'font'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.fancy <text>*' }, { quoted: msg });
            }

            const input = args.join(' ');
            const lines = [
                `1. 𝗕𝗼𝗹𝗱: ${FANCY_FONTS.bold(input)}`,
                `2. 𝘐𝘵𝘢𝘭𝘪𝘤: ${FANCY_FONTS.italic(input)}`,
                `3. 𝙼𝚘𝚗𝚘𝚜𝚙𝚊𝚌𝚎: ${FANCY_FONTS.mono(input)}`,
                `4. 𝔻𝕠𝕦𝕓𝕝𝕖: ${FANCY_FONTS.doubleStruck(input)}`
            ];

            const text = formatFramedMessage([
                {
                    emoji: '✨',
                    title: 'FANCY STYLED TEXT',
                    content: lines
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    genpass: {
        description: 'Generate a secure random password',
        aliases: ['password'],
        run: async ({ sock, msg, jid, args }) => {
            const length = args[0] && !isNaN(Number(args[0])) ? Math.min(64, Math.max(8, parseInt(args[0], 10))) : 16;
            const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+';
            const randomBytes = crypto.randomBytes(length);
            let pass = '';
            for (let i = 0; i < length; i++) {
                pass += charset[randomBytes[i] % charset.length];
            }

            const text = formatFramedMessage([
                {
                    emoji: '🔑',
                    title: 'PASSWORD GENERATOR',
                    content: [
                        `📏 Length: ${length} characters`,
                        `🔒 Password: \`${pass}\``,
                        `💡 _Tap to copy!_`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
};
