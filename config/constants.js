/**
 * GAARA X MD - Application Constants & Defaults
 */

export const SUPPORT_HEADER = 'GAARA X MD SUPPORT 🌸';
export const BOT_FOOTER = 'THIS BOT BUILT BY GAARA DEV OFC.';
export const DEFAULT_CHANNEL_URL = 'https://whatsapp.com/channel/gaaraxmd';

export const DEFAULT_SETTINGS = {
    botName: 'GAARA X MD',
    prefix: '.',
    mode: 'public', // 'public' | 'private' | 'groups' | 'inbox'
    antiCall: true,
    antiCallMaxWarnings: 3,
    antiCallTemplate: '⚠️ *CALL REJECTED*\nWarning: {warning}/3\nCaller: {caller}\n{remaining_text}',
    
    // Anti-Delete (messages & media)
    antiDelete: true,
    antiDeleteDestination: 'self', // 'self' | 'same'
    antiDeleteNotifySelf: true,

    // Anti-Edit (message updates)
    antiEdit: true,
    antiEditDestination: 'self', // 'self' | 'same'

    // Anti View-Once (photos, videos, audio)
    viewOnceSaver: true,
    viewOnceDestination: 'self', // 'self' | 'same'
    viewOnceTriggerMode: 'both', // 'both' | 'command' | 'emoji'

    // Status Anti-Delete & Auto-Status
    autoStatus: true,
    autoStatusEmoji: '💖',
    statusAntiDelete: true,
    statusDestination: 'self', // 'self' | 'same'

    // Bot Logs & Notifications
    botLogs: true,
    botLogsDestination: 'self', // 'self' | 'same'

    // Header & Framing
    headerTitle: SUPPORT_HEADER,
    footerText: BOT_FOOTER,

    autoReply: false,
    aiAutoReply: false,
    ownerNumber: '',
    ownerName: 'GAARA DEV OFC',
    ownerBio: 'Official Developer & Creator of GAARA X MD Multi-Device WhatsApp Bot.',
    blacklist: [],
    customLogoUrl: 'https://raw.githubusercontent.com/GaaraDev/assets/main/gaara-logo.png',
    channelUrl: DEFAULT_CHANNEL_URL,
    sasaDevApiKey: ''
};

export const CRASH_PATTERNS = [
    // Zero-width space flooding (> 500 contiguous zero-width chars)
    /[\u200B-\u200D\uFEFF]{500,}/,
    // Bidirectional text override flood
    /[\u202A-\u202E]{20,}/,
    // Extremely deep tag nesting or known crash bugs
    /wa\.me\/settings\?v=/,
    /\u0000{10,}/
];

export const MAX_MESSAGE_LENGTH = 15000;
