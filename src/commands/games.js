import { formatFramedMessage } from '../bot/format.js';
import logger from '../utils/logger.js';

const JOKES = [
    "Why do programmers prefer dark mode? Because light attracts bugs!",
    "There are 10 types of people in the world: those who understand binary, and those who don't.",
    "A SQL query walks into a bar, walks up to two tables and asks: 'Can I join you?'",
    "Why did the developer go broke? Because they used up all their cache!",
    "Why do Java programmers have to wear glasses? Because they don't C#!",
    "Hardware: the part of a computer that you can kick when software problems arise.",
    "Debugging: Being the detective in a crime movie where you are also the murderer.",
    "There are 2 hard things in computer science: cache invalidation, naming things, and off-by-one errors."
];

const FACTS = [
    "The first computer bug was an actual real moth stuck inside Harvard's Mark II computer in 1947.",
    "Honey never spoils. Archaeologists have found pots of honey in ancient Egyptian tombs that are over 3,000 years old and still perfectly edible.",
    "A single bolt of lightning contains enough energy to toast 100,000 slices of bread.",
    "Octopuses have three hearts and blue blood.",
    "The first domain name ever registered was Symbolics.com on March 15, 1985.",
    "Bananas are curved because they grow towards the sun against gravity.",
    "A day on Venus is longer than a year on Venus."
];

const TRUTHS = [
    "What is the most embarrassing thing you have ever searched on Google?",
    "If you could trade lives with anyone in this group for a day, who would it be and why?",
    "What is a secret talent that nobody here knows you possess?",
    "What is the biggest lie you have ever told without getting caught?",
    "What is your biggest guilty pleasure song or movie?",
    "Have you ever pretended to be sick just to avoid seeing someone?"
];

const DARES = [
    "Send a voice note singing the chorus of your favorite song right now!",
    "Change your WhatsApp bio to 'I love GAARA X MD Bot' for the next 24 hours.",
    "Send the most recent photo in your gallery to this chat without context.",
    "Type your name with your nose and send it right now.",
    "Send a screenshot of your WhatsApp home screen.",
    "Text your best friend that you are moving to Antarctica tomorrow."
];

const EIGHT_BALL_ANSWERS = [
    "It is certain.",
    "It is decidedly so.",
    "Without a doubt.",
    "Yes – definitely.",
    "You may rely on it.",
    "As I see it, yes.",
    "Most likely.",
    "Outlook good.",
    "Yes.",
    "Signs point to yes.",
    "Reply hazy, try again.",
    "Ask again later.",
    "Better not tell you now.",
    "Cannot predict now.",
    "Concentrate and ask again.",
    "Don't count on it.",
    "My reply is no.",
    "My sources say no.",
    "Outlook not so good.",
    "Very doubtful."
];

const RIDDLES = [
    { question: "I speak without a mouth and hear without ears. I have no body, but I come alive with wind. What am I?", answer: "An echo" },
    { question: "You see a boat filled with people. It has not sunk, but when you look again you don’t see a single person on the boat. Why?", answer: "All the people were married" },
    { question: "The more of this there is, the less you see. What is it?", answer: "Darkness" },
    { question: "What has keys, but no locks; space, but no room; and you can enter, but not go in?", answer: "A keyboard" },
    { question: "What gets wetter the more it dries?", answer: "A towel" }
];

const QUOTES = [
    "The only way to do great work is to love what you do. — Steve Jobs",
    "It does not matter how slowly you go as long as you do not stop. — Confucius",
    "In the middle of difficulty lies opportunity. — Albert Einstein",
    "Success is not final, failure is not fatal: it is the courage to continue that counts. — Winston Churchill",
    "Believe you can and you're halfway there. — Theodore Roosevelt"
];

const ROASTS = [
    "You bring everyone so much joy... when you leave the room.",
    "I'd agree with you, but then we’d both be wrong.",
    "You have an entire lifetime to be an idiot; why not take today off?",
    "I’m not insulting you, I’m describing you.",
    "Your secrets are always safe with me. I never even listen to what you say."
];

const COMPLIMENTS = [
    "You have a great energy that brightens up the entire room!",
    "You are more capable than you ever give yourself credit for.",
    "Your creativity and unique perspective are truly inspiring.",
    "You make difficult things look easy with your calm persistence.",
    "Anyone is lucky to have you as a friend!"
];

export const gameCommands = {
    tictactoe: {
        description: 'Play Tic-Tac-Toe vs Bot or move in ongoing game',
        aliases: ['ttt'],
        run: async ({ sock, msg, jid, args }) => {
            if (args.length > 0 && (args[0].startsWith('cell') || !isNaN(Number(args[0])))) {
                // Player move
                const moveVal = args[0].startsWith('cell') ? args[0] : `cell ${args[0]}`;
                if (sock.gameMove) {
                    try {
                        const ok = await sock.gameMove(jid, moveVal);
                        if (!ok) {
                            return sock.sendMessage(jid, { text: '❌ Invalid move or cell already taken.' }, { quoted: msg });
                        }
                        return;
                    } catch (err) {
                        logger.warn({ err: err.message }, '[Game] Error in ttt move');
                    }
                }
            }

            if (args[0] === 'end' || args[0] === 'stop') {
                if (sock.endGame) sock.endGame(jid);
                return sock.sendMessage(jid, { text: '🏁 Tic-Tac-Toe game ended.' }, { quoted: msg });
            }

            // Start new game
            if (sock.startGame) {
                try {
                    await sock.startGame(jid, 'tictactoe', { vsBot: true, theme: 'neon' });
                    await sock.sendMessage(jid, { text: '🎮 *Tic-Tac-Toe Started!* Type *.ttt <1-9>* to make your move (1=top-left, 9=bottom-right).' });
                    return;
                } catch (err) {
                    logger.error({ err: err.message }, '[Game] Failed starting void-baileys ttt');
                }
            }

            // Standalone Fallback Board
            const text = formatFramedMessage([
                {
                    emoji: '🎮',
                    title: 'TIC-TAC-TOE',
                    content: [
                        `Board Positions:`,
                        `1 | 2 | 3`,
                        `---------`,
                        `4 | 5 | 6`,
                        `---------`,
                        `7 | 8 | 9`,
                        ``,
                        `Type *.ttt <1-9>* to place your marker!`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    chess: {
        description: 'Play Chess against built-in chess engine',
        run: async ({ sock, msg, jid, args }) => {
            if (args[0] === 'end' || args[0] === 'stop') {
                if (sock.endGame) sock.endGame(jid);
                return sock.sendMessage(jid, { text: '🏁 Chess game ended.' }, { quoted: msg });
            }

            if (args.length > 0 && /^[a-h][1-8][a-h][1-8]$/i.test(args[0])) {
                // UCI move e.g. e2e4
                if (sock.gameMove) {
                    try {
                        const ok = await sock.gameMove(jid, args[0].toLowerCase());
                        if (!ok) {
                            return sock.sendMessage(jid, { text: `❌ Invalid move: "${args[0]}". Use UCI notation like e2e4.` }, { quoted: msg });
                        }
                        return;
                    } catch (err) {
                        logger.error({ err: err.message }, '[Chess] Move error');
                    }
                }
            }

            if (sock.startGame) {
                try {
                    await sock.startGame(jid, 'chess', { vsBot: true, theme: 'sunset' });
                    await sock.sendMessage(jid, { text: '♟️ *Chess match initiated!* You play White. Enter moves in UCI notation like *.chess e2e4*.' });
                    return;
                } catch (err) {
                    logger.error({ err: err.message }, '[Chess] Start error');
                }
            }

            await sock.sendMessage(jid, { text: '♟️ Chess engine ready. Enter *.chess e2e4* to open match!' }, { quoted: msg });
        }
    },

    roll: {
        description: 'Roll a random dice',
        aliases: ['dice'],
        run: async ({ sock, msg, jid, args }) => {
            const max = args[0] && !isNaN(Number(args[0])) ? parseInt(args[0], 10) : 6;
            const roll = Math.floor(Math.random() * max) + 1;
            const diceEmojis = ['⚀', '⚁', '⚂', '⚃', '⚄', '⚅'];
            const emoji = max === 6 ? diceEmojis[roll - 1] : '🎲';

            const text = formatFramedMessage([
                {
                    emoji: '🎲',
                    title: 'DICE ROLL',
                    content: [
                        `${emoji} You rolled a *${roll}* (out of ${max})!`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    coin: {
        description: 'Flip a coin',
        aliases: ['flip', 'toss'],
        run: async ({ sock, msg, jid }) => {
            const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
            const text = formatFramedMessage([
                {
                    emoji: '🪙',
                    title: 'COIN FLIP',
                    content: [
                        `🪙 The coin landed on: *${result}*!`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    joke: {
        description: 'Get a funny random joke',
        run: async ({ sock, msg, jid }) => {
            const randomJoke = JOKES[Math.floor(Math.random() * JOKES.length)];
            const text = formatFramedMessage([
                {
                    emoji: '😂',
                    title: 'RANDOM JOKE',
                    content: [randomJoke]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    fact: {
        description: 'Get an interesting random fact',
        run: async ({ sock, msg, jid }) => {
            const randomFact = FACTS[Math.floor(Math.random() * FACTS.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🧠',
                    title: 'DID YOU KNOW?',
                    content: [randomFact]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    truth: {
        description: 'Get a random truth question for party or group play',
        run: async ({ sock, msg, jid }) => {
            const item = TRUTHS[Math.floor(Math.random() * TRUTHS.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🎯',
                    title: 'TRUTH QUESTION',
                    content: [`❓ ${item}`]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    dare: {
        description: 'Get a random dare challenge',
        run: async ({ sock, msg, jid }) => {
            const item = DARES[Math.floor(Math.random() * DARES.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🔥',
                    title: 'DARE CHALLENGE',
                    content: [`⚡ ${item}`]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    '8ball': {
        description: 'Ask Magic 8-Ball a question about your future',
        aliases: ['fortune'],
        run: async ({ sock, msg, jid, args }) => {
            if (!args || args.length === 0) {
                return sock.sendMessage(jid, { text: '⚠️ Ask the 8-Ball a question. Example: *.8ball Will I become a millionaire?*' }, { quoted: msg });
            }

            const q = args.join(' ');
            const ans = EIGHT_BALL_ANSWERS[Math.floor(Math.random() * EIGHT_BALL_ANSWERS.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🎱',
                    title: 'MAGIC 8-BALL',
                    content: [
                        `❓ *Question:* ${q}`,
                        `🔮 *Prediction:* *${ans}*`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    ship: {
        description: 'Calculate love compatibility between two people or tags',
        aliases: ['love'],
        run: async ({ sock, msg, jid, args }) => {
            const context = msg.message?.extendedTextMessage?.contextInfo;
            const mentions = context?.mentionedJid || [];

            let name1 = 'User 1';
            let name2 = 'User 2';

            if (mentions.length >= 2) {
                name1 = `@${mentions[0].split('@')[0]}`;
                name2 = `@${mentions[1].split('@')[0]}`;
            } else if (mentions.length === 1) {
                name1 = `@${(msg.key.participant || msg.key.remoteJid).split('@')[0]}`;
                name2 = `@${mentions[0].split('@')[0]}`;
            } else if (args.length >= 2) {
                name1 = args[0];
                name2 = args[1];
            } else {
                return sock.sendMessage(jid, { text: '⚠️ Usage: *.ship @user1 @user2* or *.ship Name1 Name2*' }, { quoted: msg });
            }

            // Pseudo-deterministic percentage based on character sum
            const combined = `${name1.toLowerCase()}_${name2.toLowerCase()}`;
            let hash = 0;
            for (let i = 0; i < combined.length; i++) {
                hash = (hash * 31 + combined.charCodeAt(i)) % 101;
            }
            const percentage = Math.abs(hash);

            let verdict = '';
            if (percentage >= 80) verdict = '💖 A match made in heaven!';
            else if (percentage >= 50) verdict = '✨ Great potential together!';
            else if (percentage >= 30) verdict = '🤝 Better off as good friends.';
            else verdict = '💔 Warning: Severe incompatibility!';

            const text = formatFramedMessage([
                {
                    emoji: '💘',
                    title: 'LOVE COMPATIBILITY',
                    content: [
                        `👩‍❤️‍👨 *Couple:* ${name1} + ${name2}`,
                        `📊 *Score:* *${percentage}%*`,
                        `💬 *Verdict:* ${verdict}`
                    ]
                }
            ]);

            await sock.sendMessage(jid, { text, mentions }, { quoted: msg });
        }
    },

    riddle: {
        description: 'Get a brain-teasing riddle',
        run: async ({ sock, msg, jid }) => {
            const item = RIDDLES[Math.floor(Math.random() * RIDDLES.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🧩',
                    title: 'RIDDLE',
                    content: [
                        `❓ ${item.question}`,
                        ``,
                        `💡 _Answer:_ ||${item.answer}||`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    quote: {
        description: 'Get an inspiring quote from history and literature',
        run: async ({ sock, msg, jid }) => {
            const item = QUOTES[Math.floor(Math.random() * QUOTES.length)];
            const text = formatFramedMessage([
                {
                    emoji: '📜',
                    title: 'INSPIRATIONAL QUOTE',
                    content: [`"${item}"`]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    roast: {
        description: 'Deliver a funny playful roast',
        run: async ({ sock, msg, jid }) => {
            const item = ROASTS[Math.floor(Math.random() * ROASTS.length)];
            const text = formatFramedMessage([
                {
                    emoji: '🔥',
                    title: 'ROAST MACHINE',
                    content: [`${item}`]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    compliment: {
        description: 'Receive a kind, heartwarming compliment',
        run: async ({ sock, msg, jid }) => {
            const item = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];
            const text = formatFramedMessage([
                {
                    emoji: '💖',
                    title: 'KIND WORDS',
                    content: [`${item}`]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    },

    rate: {
        description: 'Rate any item, person, or concept',
        run: async ({ sock, msg, jid, args }) => {
            const target = args.join(' ') || 'You';
            const rating = Math.floor(Math.random() * 101);
            const text = formatFramedMessage([
                {
                    emoji: '⭐',
                    title: 'RATING MACHINE',
                    content: [
                        `🎯 *Item:* ${target}`,
                        `📊 *Rating:* *${rating}/100*`
                    ]
                }
            ]);
            await sock.sendMessage(jid, { text }, { quoted: msg });
        }
    }
};
