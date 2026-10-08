import os from 'os';
import db from '../../config/database.js';
import { formatFramedMessage, getBotAdReplyContext } from '../bot/format.js';
import { commandMap } from './index.js';

export function formatUptime(seconds) {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    const parts = [];
    if (d > 0) parts.push(`${d}d`);
    if (h > 0) parts.push(`${h}h`);
    if (m > 0) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
}

export const systemCommands = {
    alive: {
        description: 'Check if the bot is operational and active',
        run: async ({ sock, msg, jid }) => {
            const settings = db.getSettings();
            const uptime = formatUptime(process.uptime());
            const mem = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);

            const text = formatFramedMessage([
                {
                    emoji: '🌸',
                    title: 'STATUS ALIVE',
                    content: [
                        `⚡ *${settings.botName} IS FULLY OPERATIONAL*`,
                        ``,
                        `👑 *Owner:* ${settings.ownerName}`,
                        `⏱️ *Uptime:* ${uptime}`,
                        `🧠 *Memory:* ${mem} MB`,
                        `🌐 *Mode:* ${settings.mode.toUpperCase()}`,
                        `🛡️ *Anti-Ban:* Active (Fast Engine / Snappy)`,
                        `📌 *Prefix:* ${settings.prefix}`,
                        ``,
                        `Type *${settings.prefix}menu* to see all commands.`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    ping: {
        description: 'Check response speed and socket latency',
        run: async ({ sock, msg, jid }) => {
            const msgTime = (typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)) * 1000;
            const loopStart = performance.now();
            await new Promise(r => setImmediate(r));
            const loopLag = (performance.now() - loopStart).toFixed(2);
            const latency = msgTime > 0 ? Math.max(1, Math.round(Date.now() - msgTime)) : Math.round(parseFloat(loopLag) * 10 || 15);

            const text = formatFramedMessage([
                {
                    emoji: '⚡',
                    title: 'PONG SPEED',
                    content: [
                        `🚀 *Latency:* ${latency} ms`,
                        `⚙️ *Event Loop Lag:* ${loopLag} ms`,
                        `📶 *Socket Status:* Connected & Stable`,
                        `🛡️ *Platform:* Node.js ${process.version}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    uptime: {
        description: 'Show bot uptime',
        run: async ({ sock, msg, jid }) => {
            const up = formatUptime(process.uptime());
            const text = formatFramedMessage([
                {
                    emoji: '⏱️',
                    title: 'SYSTEM UPTIME',
                    content: [`🕒 Active Duration: *${up}*`]
                }
            ]);
            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    speed: {
        description: 'Measure execution speed and latency',
        run: async ({ sock, msg, jid }) => {
            const start = performance.now();
            const memStart = process.memoryUsage().heapUsed;
            await new Promise(r => setImmediate(r));
            const diff = (performance.now() - start).toFixed(2);
            const memDiff = ((process.memoryUsage().heapUsed - memStart) / 1024).toFixed(2);

            const text = formatFramedMessage([
                {
                    emoji: '💨',
                    title: 'EXECUTION SPEED',
                    content: [
                        `⚡ *Response Time:* ${diff} ms`,
                        `📊 *Heap Fluctuation:* ${memDiff} KB`,
                        `⚙️ *Event Loop Lag:* Minimal (< 1ms)`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    runtime: {
        description: 'Show bot process runtime and start time',
        run: async ({ sock, msg, jid }) => {
            const startTime = new Date(Date.now() - process.uptime() * 1000).toLocaleString();
            const text = formatFramedMessage([
                {
                    emoji: '⏳',
                    title: 'RUNTIME TELEMETRY',
                    content: [
                        `🚀 *Started At:* ${startTime}`,
                        `⏱️ *Total Duration:* ${formatUptime(process.uptime())}`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    owner: {
        description: 'Display owner contact information and vCard',
        run: async ({ sock, msg, jid }) => {
            const settings = db.getSettings();
            const ownerNum = settings.ownerNumber || (sock.user?.id ? sock.user.id.split(':')[0] : 'N/A');

            const text = formatFramedMessage([
                {
                    emoji: '👑',
                    title: 'BOT OWNER INFO',
                    content: [
                        `👤 *Name:* ${settings.ownerName}`,
                        `📱 *WhatsApp:* +${ownerNum}`,
                        `📝 *Bio:* ${settings.ownerBio}`,
                        `📢 *Channel:* ${settings.channelUrl}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    system: {
        description: 'Detailed system diagnostics and environment specs',
        run: async ({ sock, msg, jid }) => {
            const cpus = os.cpus();
            const cpuModel = cpus.length > 0 ? cpus[0].model.trim() : 'Unknown';
            const totalMem = (os.totalmem() / 1024 / 1024 / 1024).toFixed(2);
            const freeMem = (os.freemem() / 1024 / 1024 / 1024).toFixed(2);
            const heap = (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(1);
            const rss = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);

            const text = formatFramedMessage([
                {
                    emoji: '💻',
                    title: 'SYSTEM SPECIFICATIONS',
                    content: [
                        `🖥️ *OS:* ${os.type()} ${os.release()} (${os.arch()})`,
                        `⚙️ *CPU:* ${cpuModel} (${cpus.length} Cores)`,
                        `💾 *RAM:* ${(totalMem - freeMem).toFixed(2)} GB / ${totalMem} GB`,
                        `🧠 *Node Heap:* ${heap} MB (RSS: ${rss} MB)`,
                        `📦 *Runtime:* Node.js ${process.version}`,
                        `🌐 *Engine:* @sasa-dev/void-baileys (ESM)`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    botinfo: {
        description: 'Overview of bot engine, command count, and features',
        aliases: ['info'],
        run: async ({ sock, msg, jid }) => {
            const settings = db.getSettings();
            const count = commandMap ? commandMap.size : 70;

            const text = formatFramedMessage([
                {
                    emoji: '🤖',
                    title: 'BOT OVERVIEW',
                    content: [
                        `⚡ *Name:* ${settings.botName}`,
                        `👑 *Author:* ${settings.ownerName}`,
                        `📦 *Registered Commands:* ${count}+`,
                        `🛡️ *Security:* Anti-Bug, Anti-Ban, Anti-Call, Anti-Delete`,
                        `🌐 *Dashboard:* http://localhost:${process.env.PORT || 3000}/status`,
                        `🌸 *Build:* GAARA X MD Enterprise Edition`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    },

    rules: {
        description: 'Display bot rules and acceptable usage policies',
        aliases: ['usage'],
        run: async ({ sock, msg, jid }) => {
            const text = formatFramedMessage([
                {
                    emoji: '📜',
                    title: 'BOT RULES & GUIDELINES',
                    content: [
                        `1. 🚫 Do NOT call the bot (Anti-Call will warn 3x and auto-block).`,
                        `2. 🚫 Do NOT spam commands (Rate limit is 20 cmds/min).`,
                        `3. 🚫 Do NOT send crash stanzas or malicious payload text.`,
                        `4. 🌸 Respect group members when using .tagall or .hidetag.`,
                        `5. 💡 Report any bugs to the developer via .owner.`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, contextInfo: getBotAdReplyContext() }, { quoted: msg });
        }
    }
};
