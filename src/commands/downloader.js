import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

export const downloaderCommands = {
    play: {
        description: 'Search and download song / audio',
        aliases: ['song', 'ytmp3', 'music'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.play <song title or artist>*. Example: *.play Alan Walker Faded*' }, { quoted: msg });
            }

            const query = args.join(' ');
            await sock.sendMessage(jid, { text: `🔍 Searching & fetching audio for: _"${query}"_...` }, { quoted: msg });

            try {
                // Provider 1: Public audio search/download API
                const searchUrl = `https://api.siputzx.my.id/api/d/ytmp3?url=${encodeURIComponent(query)}`;
                let audioUrl = null;
                let title = query;

                try {
                    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(12000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.dl) audioUrl = data.data.dl;
                        if (data?.data?.title) title = data.data.title;
                    }
                } catch {}

                // Provider 2 fallback: Widipe proxy
                if (!audioUrl) {
                    const fallbackUrl = `https://widipe.com/download/ytdl?url=${encodeURIComponent(query)}`;
                    try {
                        const res2 = await fetch(fallbackUrl, { signal: AbortSignal.timeout(12000) });
                        if (res2.ok) {
                            const data2 = await res2.json();
                            if (data2?.result?.mp3) audioUrl = data2.result.mp3;
                            if (data2?.result?.title) title = data2.result.title;
                        }
                    } catch {}
                }

                if (audioUrl) {
                    const audioBuffer = await (await fetch(audioUrl, { signal: AbortSignal.timeout(30000) })).arrayBuffer();
                    await sock.sendMessage(jid, {
                        audio: Buffer.from(audioBuffer),
                        mimetype: 'audio/mp4',
                        fileName: `${title}.mp3`
                    }, { quoted: msg });
                } else {
                    const info = formatFramedMessage([
                        {
                            emoji: '🎵',
                            title: 'AUDIO SEARCH RESULTS',
                            content: [
                                `🔍 *Query:* ${query}`,
                                `⚠️ Public stream server is busy or rate-limited.`,
                                `💡 Tip: Try passing a direct YouTube link or try again shortly.`
                            ]
                        }
                    ]);
                    await sock.sendMessage(jid, { text: info }, { quoted: msg });
                }
            } catch (err) {
                logger.error({ err: err.message }, '[Downloader] Play error');
                await sock.sendMessage(jid, { text: `❌ Download error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    video: {
        description: 'Download video by query or link',
        aliases: ['ytmp4', 'ytvideo'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.video <title or YouTube URL>*' }, { quoted: msg });
            }

            const query = args.join(' ');
            await sock.sendMessage(jid, { text: `📹 Fetching video for: _"${query}"_...` }, { quoted: msg });

            try {
                let videoUrl = null;
                let title = query;

                const searchUrl = `https://api.siputzx.my.id/api/d/ytmp4?url=${encodeURIComponent(query)}`;
                try {
                    const res = await fetch(searchUrl, { signal: AbortSignal.timeout(15000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.dl) videoUrl = data.data.dl;
                        if (data?.data?.title) title = data.data.title;
                    }
                } catch {}

                if (videoUrl) {
                    const vidRes = await fetch(videoUrl, { signal: AbortSignal.timeout(45000) });
                    const vidBuffer = Buffer.from(await vidRes.arrayBuffer());

                    await sock.sendMessage(jid, {
                        video: vidBuffer,
                        caption: `🎬 *${title}*\n\nTHIS BOT BUILT BY GAARA DEV OFC.`
                    }, { quoted: msg });
                } else {
                    const text = formatFramedMessage([
                        {
                            emoji: '🎬',
                            title: 'VIDEO DOWNLOADER',
                            content: [
                                `🔍 Query: ${query}`,
                                `⚠️ Stream endpoint timed out or video size exceeded limit (>50MB).`
                            ]
                        }
                    ]);
                    await sock.sendMessage(jid, { text }, { quoted: msg });
                }
            } catch (err) {
                logger.error({ err: err.message }, '[Downloader] Video error');
                await sock.sendMessage(jid, { text: `❌ Video download error: ${err.message}` }, { quoted: msg });
            }
        }
    },

    tiktok: {
        description: 'Download TikTok videos without watermark',
        aliases: ['tt'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.tiktok <TikTok Video URL>*' }, { quoted: msg });
            }

            const url = args[0].trim();
            await sock.sendMessage(jid, { text: '⏳ Fetching TikTok video...' }, { quoted: msg });

            try {
                let videoUrl = null;
                const endpoint = `https://api.siputzx.my.id/api/d/tiktok?url=${encodeURIComponent(url)}`;
                try {
                    const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.play) videoUrl = data.data.play;
                        else if (data?.data?.video) videoUrl = data.data.video;
                    }
                } catch {}

                if (videoUrl) {
                    const vidBuf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
                    await sock.sendMessage(jid, { video: vidBuf, caption: '🎬 TikTok Video Downloaded!' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: `⚠️ Could not download TikTok video. Ensure the video is public and the link is valid.` }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ TikTok download failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    ig: {
        description: 'Download Instagram reels or posts',
        aliases: ['instagram', 'reels'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.ig <Instagram Post / Reel URL>*' }, { quoted: msg });
            }

            const url = args[0].trim();
            await sock.sendMessage(jid, { text: '⏳ Fetching Instagram content...' }, { quoted: msg });

            try {
                let mediaUrl = null;
                const endpoint = `https://api.siputzx.my.id/api/d/igdl?url=${encodeURIComponent(url)}`;
                try {
                    const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (Array.isArray(data?.data) && data.data[0]?.url) {
                            mediaUrl = data.data[0].url;
                        }
                    }
                } catch {}

                if (mediaUrl) {
                    const buf = Buffer.from(await (await fetch(mediaUrl, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
                    await sock.sendMessage(jid, { video: buf, caption: '📸 Instagram Reel Downloaded!' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Could not fetch Instagram media. Link may be private or expired.' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Instagram download failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    fb: {
        description: 'Download Facebook public videos',
        aliases: ['facebook'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.fb <Facebook Video URL>*' }, { quoted: msg });
            }

            const url = args[0].trim();
            await sock.sendMessage(jid, { text: '⏳ Fetching Facebook video...' }, { quoted: msg });

            try {
                let videoUrl = null;
                const endpoint = `https://api.siputzx.my.id/api/d/facebook?url=${encodeURIComponent(url)}`;
                try {
                    const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.urls?.[0]?.hd) videoUrl = data.data.urls[0].hd;
                        else if (data?.data?.urls?.[0]?.sd) videoUrl = data.data.urls[0].sd;
                    }
                } catch {}

                if (videoUrl) {
                    const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
                    await sock.sendMessage(jid, { video: buf, caption: '🎥 Facebook Video Downloaded!' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Could not fetch Facebook video. Check link or privacy settings.' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Facebook download failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    twitter: {
        description: 'Download Twitter / X videos',
        aliases: ['x'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.twitter <Tweet URL>*' }, { quoted: msg });
            }

            const url = args[0].trim();
            await sock.sendMessage(jid, { text: '⏳ Fetching Twitter video...' }, { quoted: msg });

            try {
                let videoUrl = null;
                const endpoint = `https://api.siputzx.my.id/api/d/twitter?url=${encodeURIComponent(url)}`;
                try {
                    const res = await fetch(endpoint, { signal: AbortSignal.timeout(12000) });
                    if (res.ok) {
                        const data = await res.json();
                        if (data?.data?.url) videoUrl = data.data.url;
                    }
                } catch {}

                if (videoUrl) {
                    const buf = Buffer.from(await (await fetch(videoUrl, { signal: AbortSignal.timeout(30000) })).arrayBuffer());
                    await sock.sendMessage(jid, { video: buf, caption: '🐦 Twitter/X Video Downloaded!' }, { quoted: msg });
                } else {
                    await sock.sendMessage(jid, { text: '⚠️ Could not fetch Twitter video. Tweet may not contain video media.' }, { quoted: msg });
                }
            } catch (err) {
                await sock.sendMessage(jid, { text: `❌ Twitter download failed: ${err.message}` }, { quoted: msg });
            }
        }
    },

    gitclone: {
        description: 'Download a public GitHub repository as a ZIP link',
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.gitclone <https://github.com/owner/repo>*' }, { quoted: msg });
            }

            const input = args[0].trim();
            const match = input.match(/github\.com\/([^\/]+)\/([^\/\.]+)/i);
            if (!match) {
                return sock.sendMessage(jid, { text: '❌ Invalid GitHub repository URL provided.' }, { quoted: msg });
            }

            const [, user, repo] = match;
            const zipUrl = `https://api.github.com/repos/${user}/${repo}/zipball`;

            const text = formatFramedMessage([
                {
                    emoji: '📦',
                    title: 'GIT CLONE ZIP',
                    content: [
                        `Repository: ${user}/${repo}`,
                        `Direct ZIP URL: ${zipUrl}`,
                        `💡 _Download directly from your browser!_`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
};
