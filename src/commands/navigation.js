import db from '../../config/database.js';
import { formatFramedMessage } from '../bot/format.js';
import { formatUptime } from './system.js';
import { commandMap } from './index.js';

export const navigationCommands = {
    menu: {
        description: 'Display all categorized commands',
        aliases: ['help', 'commands'],
        run: async ({ sock, msg, jid }) => {
            const settings = db.getSettings();
            const p = settings.prefix;
            const uptime = formatUptime(process.uptime());

            const sections = [
                {
                    emoji: '👑',
                    title: 'USER & SYSTEM',
                    content: [
                        `👤 *User:* ${msg.pushName || 'Friend'}`,
                        `⏱️ *Uptime:* ${uptime}`,
                        `🌐 *Mode:* ${settings.mode.toUpperCase()}`,
                        `📌 *Prefix:* ${p}`
                    ]
                },
                {
                    emoji: '⚙️',
                    title: 'SYSTEM & INFO',
                    content: [
                        `🔹 *${p}alive* — Bot status & live info`,
                        `🔹 *${p}ping* — Response latency benchmark`,
                        `🔹 *${p}uptime* — Active online duration`,
                        `🔹 *${p}speed* — Engine speed test`,
                        `🔹 *${p}runtime* — Host telemetry data`,
                        `🔹 *${p}owner* — Developer vCard info`,
                        `🔹 *${p}system* — Host diagnostics`,
                        `🔹 *${p}botinfo* — Overview of features`,
                        `🔹 *${p}rules* — Bot usage rules`
                    ]
                },
                {
                    emoji: '🎨',
                    title: 'MEDIA & STICKERS',
                    content: [
                        `🔹 *${p}sticker* / *${p}s* — Create sticker`,
                        `🔹 *${p}take* <pack|author> — Change watermark`,
                        `🔹 *${p}toimg* — Convert sticker to image`,
                        `🔹 *${p}tomp3* — Convert video/audio to mp3`,
                        `🔹 *${p}readviewonce* / *${p}vv* — Extract view-once`,
                        `🔹 *${p}attp* <text> — Colorful text sticker`,
                        `🔹 *${p}round* / *${p}circle* — Round sticker`,
                        `🔹 *${p}emojimix* <e1+e2> — Mix two emojis`,
                        `🔹 *${p}blur* — Blur quoted image`,
                        `🔹 *${p}invert* — Invert colors of image`,
                        `🔹 *${p}greyscale* — Black & white image`,
                        `🔹 *${p}getpp* — Download profile picture`
                    ]
                },
                {
                    emoji: '🎵',
                    title: 'MEDIA DOWNLOADER',
                    content: [
                        `🔹 *${p}play* <song name> — Download audio`,
                        `🔹 *${p}song* <query> — Download mp3 song`,
                        `🔹 *${p}video* <query> — Download video`,
                        `🔹 *${p}tiktok* <url> — TikTok no watermark`,
                        `🔹 *${p}ig* <url> — Instagram reel/post`,
                        `🔹 *${p}fb* <url> — Facebook video`,
                        `🔹 *${p}twitter* <url> — Twitter/X video`,
                        `🔹 *${p}gitclone* <repo url> — GitHub repo ZIP`
                    ]
                },
                {
                    emoji: '🔍',
                    title: 'SEARCH & RESEARCH',
                    content: [
                        `🔹 *${p}google* <query> — Web search summary`,
                        `🔹 *${p}wiki* <topic> — Wikipedia summary`,
                        `🔹 *${p}lyrics* <song> — Song lyrics search`,
                        `🔹 *${p}github* <user|repo> — GitHub lookup`,
                        `🔹 *${p}npm* <package> — NPM registry lookup`,
                        `🔹 *${p}crypto* <coin> — Real-time coin prices`,
                        `🔹 *${p}imdb* <movie> — Movie ratings & plot`
                    ]
                },
                {
                    emoji: '🧰',
                    title: 'UTILITIES & TOOLS',
                    content: [
                        `🔹 *${p}calc* <expr> — Math calculator`,
                        `🔹 *${p}qr* <text> — Generate QR Code`,
                        `🔹 *${p}weather* <city> — Weather conditions`,
                        `🔹 *${p}translate* <lang> <text> — Translator`,
                        `🔹 *${p}tts* <lang> <text> — Text-to-speech`,
                        `🔹 *${p}shorturl* <url> — Shorten web link`,
                        `🔹 *${p}time* — World clocks`,
                        `🔹 *${p}define* <word> — Dictionary lookup`,
                        `🔹 *${p}morse* <text> — Morse encode/decode`,
                        `🔹 *${p}base64* <enc|dec> — Base64 converter`,
                        `🔹 *${p}binary* <text> — Binary converter`,
                        `🔹 *${p}currency* <amt> <from> <to> — Currency`,
                        `🔹 *${p}ip* <ip> — Geolocation & ISP lookup`,
                        `🔹 *${p}fliptext* <text> — Upside-down text`,
                        `🔹 *${p}fancy* <text> — Stylish fancy fonts`,
                        `🔹 *${p}genpass* <length> — Secure password`,
                        `🔹 *${p}quoted* — Inspect quoted stanza`,
                        `🔹 *${p}jid* — Show current JID`
                    ]
                },
                {
                    emoji: '👥',
                    title: 'GROUP MANAGEMENT',
                    content: [
                        `🔹 *${p}kick* @user — Remove participant`,
                        `🔹 *${p}add* <number> — Add member`,
                        `🔹 *${p}promote* @user — Make admin`,
                        `🔹 *${p}demote* @user — Demote admin`,
                        `🔹 *${p}tagall* <msg> — Tag everyone`,
                        `🔹 *${p}hidetag* <msg> — Invisible tag`,
                        `🔹 *${p}tagadmin* <msg> — Tag group admins`,
                        `🔹 *${p}link* — Get group invite link`,
                        `🔹 *${p}revoke* — Reset group invite link`,
                        `🔹 *${p}mute* / *${p}unmute* — Chat lock`,
                        `🔹 *${p}setname* <title> — Change group name`,
                        `🔹 *${p}setdesc* <desc> — Change group desc`,
                        `🔹 *${p}groupinfo* — Group statistics`,
                        `🔹 *${p}leave* — Bot leaves group`
                    ]
                },
                {
                    emoji: '🎮',
                    title: 'FUN & GAMES',
                    content: [
                        `🔹 *${p}tictactoe* — Play Tic-Tac-Toe`,
                        `🔹 *${p}chess* — Play Chess engine`,
                        `🔹 *${p}roll* — Roll a random dice`,
                        `🔹 *${p}coin* — Toss a coin`,
                        `🔹 *${p}joke* — Funny programming joke`,
                        `🔹 *${p}fact* — Interesting random fact`,
                        `🔹 *${p}truth* — Truth question`,
                        `🔹 *${p}dare* — Dare challenge`,
                        `🔹 *${p}8ball* <question> — Magic 8-Ball`,
                        `🔹 *${p}ship* <@u1 @u2> — Love calculator`,
                        `🔹 *${p}riddle* — Brain riddle with answer`,
                        `🔹 *${p}quote* — Inspirational quote`,
                        `🔹 *${p}roast* — Playful roast`,
                        `🔹 *${p}compliment* — Heartwarming compliment`,
                        `🔹 *${p}rate* <target> — Random rating (0-100)`
                    ]
                },
                {
                    emoji: '🌸',
                    title: 'ANIME & ART',
                    content: [
                        `🔹 *${p}waifu* — Random waifu photo`,
                        `🔹 *${p}neko* — Cute anime neko photo`,
                        `🔹 *${p}shinobu* — Shinobu Kocho image`,
                        `🔹 *${p}megumin* — Megumin image`,
                        `🔹 *${p}animequote* — Anime wisdom quote`,
                        `🔹 *${p}wallpaper* — HD anime wallpaper`
                    ]
                },
                {
                    emoji: '🤖',
                    title: 'AI CHAT',
                    content: [
                        `🔹 *${p}ai* <prompt> — Sasa AI Plus`,
                        `🔹 *${p}ask* <prompt> — Smart assistant`,
                        `🔹 *${p}chat* <prompt> — Interactive conversation`
                    ]
                },
                {
                    emoji: '👤',
                    title: 'PROFILE TOOLS',
                    content: [
                        `🔹 *${p}getpp* @user — Download profile picture`,
                        `🔹 *${p}getbio* @user — View WhatsApp bio/status`,
                        `🔹 *${p}setpp* — Set bot profile picture`,
                        `🔹 *${p}setbio* <text> — Set bot WhatsApp status`
                    ]
                },
                {
                    emoji: '🛠️',
                    title: 'CUSTOMIZATION',
                    content: [
                        `🔹 *${p}setbotname* <name> — Change name`,
                        `🔹 *${p}setbotlogo* <url> — Change logo`,
                        `🔹 *${p}addreply* <trig|resp> — Add auto reply`,
                        `🔹 *${p}delreply* <trigger> — Delete auto reply`,
                        `🔹 *${p}listreply* — List all auto replies`,
                        `🔹 *${p}clearreplies* — Clear all auto replies`
                    ]
                },
                {
                    emoji: '🔒',
                    title: 'OWNER CONTROLS',
                    content: [
                        `🔹 *${p}mode* <public|private> — Switch mode`,
                        `🔹 *${p}anticall* <on|off> — Call guard`,
                        `🔹 *${p}antidelete* <on|off> — Revoke guard`,
                        `🔹 *${p}autostatus* <on|off> — Status view/like`,
                        `🔹 *${p}block* / *${p}unblock* @user`,
                        `🔹 *${p}broadcast* <text> — Send broadcast`,
                        `🔹 *${p}setprefix* <symbol> — Change prefix`,
                        `🔹 *${p}clearcache* — Flush LRU memory cache`,
                        `🔹 *${p}restart* — Restart socket connection`,
                        `🔹 *${p}join* <link> — Join group by invite`,
                        `🔹 *${p}eval* <code> — Evaluate JavaScript`,
                        `🔹 *${p}exec* <cmd> — Run host terminal command`
                    ]
                }
            ];

            const text = formatFramedMessage(sections);

            // Try sending with quick action buttons
            if (sock.sendButton) {
                try {
                    await sock.sendButton(jid, {
                        text,
                        footer: 'THIS BOT BUILT BY GAARA DEV OFC.',
                        buttons: [
                            { text: '⚡ PING', id: `${p}ping` },
                            { text: '🌸 ALIVE', id: `${p}alive` },
                            { text: '👑 OWNER', id: `${p}owner` }
                        ]
                    });
                    return;
                } catch {
                    // Fallback to standard sendMessage below
                }
            }

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    list: {
        description: 'Compact alphabetical list of all registered commands',
        aliases: ['allcmd', 'cmdlist'],
        run: async ({ sock, msg, jid }) => {
            const settings = db.getSettings();
            const p = settings.prefix;

            const allCmds = Array.from(new Set(Array.from(commandMap.keys()))).sort();
            const formattedList = allCmds.map((cmd, i) => `${i + 1}. *${p}${cmd}*`).join('\n');

            const text = formatFramedMessage([
                {
                    emoji: '📋',
                    title: `ALL COMMANDS (${allCmds.length} TOTAL)`,
                    content: [
                        `Prefix: *${p}*`,
                        ``,
                        formattedList
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
};
