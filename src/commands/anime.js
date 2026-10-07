import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

const ANIME_QUOTES = [
    { quote: "Whatever you lose, you'll find it again. But what you throw away you'll never get back.", character: "Kenshin Himura", anime: "Rurouni Kenshin" },
    { quote: "If you don't take risks, you can't create a future!", character: "Monkey D. Luffy", anime: "One Piece" },
    { quote: "Hard work is worthless for those that don't believe in themselves.", character: "Naruto Uzumaki", anime: "Naruto" },
    { quote: "The world is not beautiful, therefore it is.", character: "Kino", anime: "Kino's Journey" },
    { quote: "Power comes in response to a need, not a desire.", character: "Goku", anime: "Dragon Ball Z" },
    { quote: "A person grows up when he's able to overcome hardships.", character: "Jiraiya", anime: "Naruto" },
    { quote: "People's lives don't end when they die. It ends when they lose faith.", character: "Itachi Uchiha", anime: "Naruto" },
    { quote: "In this world, wherever there is light - there are also shadows.", character: "Madara Uchiha", anime: "Naruto Shippuden" }
];

async function fetchWaifuImage(category) {
    const fallbackUrls = {
        waifu: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600',
        neko: 'https://images.unsplash.com/photo-1534447677768-be436bb09401?w=600',
        shinobu: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600',
        megumin: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=600',
        wallpaper: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=800'
    };

    try {
        const res = await fetch(`https://api.waifu.pics/sfw/${category}`, { signal: AbortSignal.timeout(6000) });
        if (res.ok) {
            const data = await res.json();
            if (data?.url) return data.url;
        }
    } catch {}

    return fallbackUrls[category] || fallbackUrls.waifu;
}

export const animeCommands = {
    waifu: {
        description: 'Send a random anime waifu image',
        run: async ({ sock, msg, jid }) => {
            await sock.sendMessage(jid, { text: '🌸 Summoning waifu...' }, { quoted: msg });
            try {
                const imgUrl = await fetchWaifuImage('waifu');
                const res = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                const buf = Buffer.from(await res.arrayBuffer());

                const text = formatFramedMessage([
                    {
                        emoji: '🌸',
                        title: 'ANIME WAIFU',
                        content: ['Here is your waifu! ✨']
                    }
                ]);

                await sock.sendMessage(jid, { image: buf, caption: text }, { quoted: msg });
            } catch (err) {
                logger.error({ err: err.message }, '[Anime] Waifu error');
                await sock.sendMessage(jid, { text: `❌ Could not fetch waifu: ${err.message}` }, { quoted: msg });
            }
        }
    },

    neko: {
        description: 'Send a cute random anime neko image',
        run: async ({ sock, msg, jid }) => {
            await sock.sendMessage(jid, { text: '🐱 Summoning neko...' }, { quoted: msg });
            try {
                const imgUrl = await fetchWaifuImage('neko');
                const res = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                const buf = Buffer.from(await res.arrayBuffer());

                const text = formatFramedMessage([
                    {
                        emoji: '🐱',
                        title: 'ANIME NEKO',
                        content: ['Nyaa~ Here is your neko! 🐾']
                    }
                ]);

                await sock.sendMessage(jid, { image: buf, caption: text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Could not fetch neko: ${err.message}` }, { quoted: msg });
            }
        }
    },

    shinobu: {
        description: 'Send a random Shinobu anime image',
        run: async ({ sock, msg, jid }) => {
            try {
                const imgUrl = await fetchWaifuImage('shinobu');
                const res = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                const buf = Buffer.from(await res.arrayBuffer());
                await sock.sendMessage(jid, { image: buf, caption: '🦋 *Shinobu Kocho*' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    megumin: {
        description: 'Send a random Megumin anime image',
        run: async ({ sock, msg, jid }) => {
            try {
                const imgUrl = await fetchWaifuImage('megumin');
                const res = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                const buf = Buffer.from(await res.arrayBuffer());
                await sock.sendMessage(jid, { image: buf, caption: '💥 *Explosion! Megumin*' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    animequote: {
        description: 'Get an inspirational anime quote',
        aliases: ['aquote'],
        run: async ({ sock, msg, jid }) => {
            let quoteObj = null;

            try {
                const res = await fetch('https://animechan.xyz/api/random', { signal: AbortSignal.timeout(5000) });
                if (res.ok) {
                    const data = await res.json();
                    if (data?.quote) {
                        quoteObj = { quote: data.quote, character: data.character, anime: data.anime };
                    }
                }
            } catch {}

            if (!quoteObj) {
                quoteObj = ANIME_QUOTES[Math.floor(Math.random() * ANIME_QUOTES.length)];
            }

            const text = formatFramedMessage([
                {
                    emoji: '🌸',
                    title: 'ANIME WISDOM',
                    content: [
                        `💬 _"${quoteObj.quote}"_`,
                        ``,
                        `👤 *Character:* ${quoteObj.character}`,
                        `📺 *Anime:* ${quoteObj.anime}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    wallpaper: {
        description: 'Fetch an anime HD wallpaper',
        run: async ({ sock, msg, jid }) => {
            try {
                const imgUrl = await fetchWaifuImage('wallpaper');
                const res = await fetch(imgUrl, { signal: AbortSignal.timeout(10000) });
                const buf = Buffer.from(await res.arrayBuffer());
                await sock.sendMessage(jid, { image: buf, caption: '🖼️ *HD Anime Wallpaper*' }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Wallpaper fetch failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
};
