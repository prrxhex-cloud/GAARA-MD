import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

export const searchCommands = {
    google: {
        description: 'Search Google for instant summary and search links',
        aliases: ['g', 'search'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.google <query>*. Example: *.google Node.js release*' }, { quoted: msg });
            }

            const query = args.join(' ');
            await sock.sendMessage(jid, { text: `🔍 Searching for: _"${query}"_...` }, { quoted: msg });

            try {
                // Try DuckDuckGo instant answer API
                const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
                const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
                const data = await res.json();

                const answer = data.AbstractText || data.Answer || data.Definition || `Google Search link: https://www.google.com/search?q=${encodeURIComponent(query)}`;
                const source = data.AbstractSource || 'Web';

                const text = formatFramedMessage([
                    {
                        emoji: '🔍',
                        title: `SEARCH: ${query.toUpperCase()}`,
                        content: [
                            `📌 *Summary:*`,
                            answer.slice(0, 500),
                            ``,
                            `🌐 *Source:* ${source}`,
                            `🔗 *Link:* https://www.google.com/search?q=${encodeURIComponent(query)}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                logger.error({ err: err.message }, '[Search] Google search error');
                const fallback = formatFramedMessage([
                    {
                        emoji: '🔍',
                        title: `SEARCH: ${query.toUpperCase()}`,
                        content: [
                            `🔗 Direct Google Link:`,
                            `https://www.google.com/search?q=${encodeURIComponent(query)}`
                        ]
                    }
                ]);
                await sock.sendMessage(jid, { text: fallback }, { quoted: msg });
            }
        }
    },

    wiki: {
        description: 'Search Wikipedia for articles and summaries',
        aliases: ['wikipedia'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.wiki <topic>*. Example: *.wiki Albert Einstein*' }, { quoted: msg });
            }

            const query = args.join(' ');
            try {
                const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
                const res = await fetch(url, {
                    headers: { 'User-Agent': 'GAARA-X-MD-WhatsApp-Bot/1.0' },
                    signal: AbortSignal.timeout(8000)
                });

                if (!res.ok) throw new Error('Wikipedia article not found');
                const data = await res.json();

                const text = formatFramedMessage([
                    {
                        emoji: '📚',
                        title: `WIKIPEDIA: ${data.title}`,
                        content: [
                            data.description ? `📝 *Description:* _${data.description}_` : '',
                            `📖 *Extract:*`,
                            data.extract || 'No extract available.',
                            ``,
                            `🔗 *Read More:* ${data.content_urls?.desktop?.page || ''}`
                        ].filter(Boolean)
                    }
                ]);

                if (data.thumbnail?.source) {
                    try {
                        const imgRes = await fetch(data.thumbnail.source, { signal: AbortSignal.timeout(6000) });
                        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                        return await sock.sendMessage(jid, { image: imgBuf, caption: text }, { quoted: msg });
                    } catch {}
                }

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Wikipedia search failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    lyrics: {
        description: 'Find lyrics for a song',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.lyrics <song title or artist - song>*' }, { quoted: msg });
            }

            const query = args.join(' ');
            await sock.sendMessage(jid, { text: `🎵 Searching lyrics for: _"${query}"_...` }, { quoted: msg });

            try {
                const searchUrl = `https://api.siputzx.my.id/api/s/lyrics?query=${encodeURIComponent(query)}`;
                let lyrics = '';
                let title = query;
                let artist = '';

                try {
                    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(10000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.lyrics) lyrics = data.data.lyrics;
                        if (data?.data?.title) title = data.data.title;
                        if (data?.data?.artist) artist = data.data.artist;
                    }
                } catch {}

                if (!lyrics) {
                    // Fallback to lyrics.ovh
                    const parts = query.split('-');
                    if (parts.length >= 2) {
                        const a = parts[0].trim();
                        const t = parts[1].trim();
                        const r2 = await fetch(`https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(8000) });
                        if (r2.ok) {
                            const d2 = await r2.json();
                            if (d2.lyrics) lyrics = d2.lyrics;
                        }
                    }
                }

                if (!lyrics) {
                    throw new Error('Lyrics not found or service unavailable');
                }

                const text = formatFramedMessage([
                    {
                        emoji: '🎤',
                        title: `LYRICS: ${title.toUpperCase()}`,
                        content: [
                            artist ? `👤 *Artist:* ${artist}` : '',
                            ``,
                            lyrics.slice(0, 1500)
                        ].filter(Boolean)
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Lyrics error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    github: {
        description: 'Search GitHub user profile or repository',
        aliases: ['git'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.github <username>* or *.github <owner/repo>*' }, { quoted: msg });
            }

            const target = args[0].trim();
            try {
                if (target.includes('/')) {
                    // Repository search
                    const res = await fetch(`https://api.github.com/repos/${target}`, { signal: AbortSignal.timeout(8000) });
                    if (!res.ok) throw new Error('Repository not found');
                    const repo = await res.json();

                    const text = formatFramedMessage([
                        {
                            emoji: '📦',
                            title: `GITHUB REPO: ${repo.name}`,
                            content: [
                                `📝 *Description:* ${repo.description || 'No description'}`,
                                `⭐ *Stars:* ${repo.stargazers_count} | 🍴 *Forks:* ${repo.forks_count}`,
                                `💻 *Language:* ${repo.language || 'Multiple'}`,
                                `📜 *License:* ${repo.license?.name || 'None'}`,
                                `🔗 *Link:* ${repo.html_url}`
                            ]
                        }
                    ]);
                    return await sock.sendMessage(jid, { text }, { quoted: msg });
                }

                // User search
                const res = await fetch(`https://api.github.com/users/${target}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error('GitHub user not found');
                const user = await res.json();

                const text = formatFramedMessage([
                    {
                        emoji: '🐙',
                        title: `GITHUB USER: ${user.login}`,
                        content: [
                            `👤 *Name:* ${user.name || 'N/A'}`,
                            `📝 *Bio:* ${user.bio || 'No bio'}`,
                            `📦 *Public Repos:* ${user.public_repos}`,
                            `👥 *Followers:* ${user.followers} | *Following:* ${user.following}`,
                            `📍 *Location:* ${user.location || 'Unknown'}`,
                            `🔗 *Profile:* ${user.html_url}`
                        ]
                    }
                ]);

                if (user.avatar_url) {
                    try {
                        const av = await fetch(user.avatar_url, { signal: AbortSignal.timeout(6000) });
                        const buf = Buffer.from(await av.arrayBuffer());
                        return await sock.sendMessage(jid, { image: buf, caption: text }, { quoted: msg });
                    } catch {}
                }

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ GitHub error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    npm: {
        description: 'Lookup package info from NPM registry',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.npm <package-name>*' }, { quoted: msg });
            }

            const pkg = args[0].toLowerCase().trim();
            try {
                const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error(`NPM package "${pkg}" not found`);
                const data = await res.json();

                const latest = data['dist-tags']?.latest;
                const desc = data.description || 'No description';
                const license = data.license || 'N/A';
                const homepage = data.homepage || `https://www.npmjs.com/package/${pkg}`;

                const text = formatFramedMessage([
                    {
                        emoji: '📦',
                        title: `NPM: ${data.name}`,
                        content: [
                            `🔖 *Latest Version:* ${latest}`,
                            `📝 *Description:* ${desc}`,
                            `📜 *License:* ${license}`,
                            `🔗 *URL:* ${homepage}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ NPM error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    crypto: {
        description: 'Get real-time cryptocurrency exchange rates',
        aliases: ['btc', 'coin'],
        run: async ({ sock, msg, jid, args }) => {
            const coin = (args[0] || 'bitcoin').toLowerCase();
            const coinMap = {
                btc: 'bitcoin',
                eth: 'ethereum',
                sol: 'solana',
                bnb: 'binancecoin',
                xrp: 'ripple',
                doge: 'dogecoin',
                ada: 'cardano',
                trx: 'tron'
            };
            const coinId = coinMap[coin] || coin;

            try {
                const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${coinId}&vs_currencies=usd,eur,gbp`, {
                    signal: AbortSignal.timeout(8000)
                });
                if (!res.ok) throw new Error('Crypto service unavailable');
                const data = await res.json();

                if (!data[coinId]) {
                    throw new Error(`Coin "${coin}" not found`);
                }

                const prices = data[coinId];
                const text = formatFramedMessage([
                    {
                        emoji: '🪙',
                        title: `CRYPTO: ${coinId.toUpperCase()}`,
                        content: [
                            `💵 *USD:* $${prices.usd.toLocaleString()}`,
                            `💶 *EUR:* €${prices.eur?.toLocaleString() || 'N/A'}`,
                            `💷 *GBP:* £${prices.gbp?.toLocaleString() || 'N/A'}`
                        ]
                    }
                ]);

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Crypto price check failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    imdb: {
        description: 'Search movies and TV shows for ratings and plot',
        aliases: ['movie'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.imdb <movie title>*' }, { quoted: msg });
            }

            const query = args.join(' ');
            try {
                const res = await fetch(`https://www.omdbapi.com/?t=${encodeURIComponent(query)}&apikey=trilogy`, { signal: AbortSignal.timeout(8000) });
                if (!res.ok) throw new Error('Movie database unavailable');
                const movie = await res.json();

                if (movie.Response === 'False') {
                    throw new Error(movie.Error || 'Movie not found');
                }

                const text = formatFramedMessage([
                    {
                        emoji: '🎬',
                        title: `MOVIE: ${movie.Title} (${movie.Year})`,
                        content: [
                            `⭐ *IMDb Rating:* ${movie.imdbRating}/10`,
                            `🎭 *Genre:* ${movie.Genre}`,
                            `🎬 *Director:* ${movie.Director}`,
                            `👥 *Actors:* ${movie.Actors}`,
                            `⏱️ *Runtime:* ${movie.Runtime}`,
                            `📖 *Plot:* ${movie.Plot}`
                        ]
                    }
                ]);

                if (movie.Poster && movie.Poster.startsWith('http')) {
                    try {
                        const imgRes = await fetch(movie.Poster, { signal: AbortSignal.timeout(6000) });
                        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
                        return await sock.sendMessage(jid, { image: imgBuf, caption: text }, { quoted: msg });
                    } catch {}
                }

                await sock.sendMessage(jid, { text }, { quoted: msg });
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ IMDb search failed: ${err.message}` }, { quoted: msg });
            }
        }
    }
};
