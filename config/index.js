import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Load .env
dotenv.config({ path: path.join(rootDir, '.env') });

// Ensure critical directories exist
const dataDir = path.resolve(rootDir, process.env.DATA_DIR || './data');
const sessionDir = path.resolve(rootDir, process.env.SESSION_DIR || './session');

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}
if (!fs.existsSync(sessionDir)) {
    fs.mkdirSync(sessionDir, { recursive: true });
}

export const config = {
    rootDir,
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv: process.env.NODE_ENV || 'production',
    appUrl: process.env.APP_URL || process.env.RENDER_BACKEND_URL || 'https://gaara-md-cf37.onrender.com',

    // Bot Identity
    botName: process.env.BOT_NAME || 'GAARA X MD',
    botPrefix: process.env.BOT_PREFIX || '.',
    botLogoUrl: process.env.BOT_LOGO_URL || 'https://raw.githubusercontent.com/GaaraDev/assets/main/gaara-logo.png',
    botIconPath: path.resolve(rootDir, 'assets', 'bot_icon.jpg'),

    // Owner Settings
    ownerNumber: process.env.OWNER_NUMBER || '',
    ownerName: process.env.OWNER_NAME || 'GAARA DEV OFC',
    ownerBio: process.env.OWNER_BIO || 'Creator of GAARA X MD Multi-Device WhatsApp Bot',

    // External APIs (Zero hardcoding in client - server-side configured)
    sasaDevApiKey: process.env.SASA_DEV_API_KEY || 'Sasa_Dev_Api_3a20968903b0fa8f866eb471f05003a7cd016c44',
    sasaDevApiBaseUrl: process.env.SASA_DEV_API_BASE_URL || 'https://sasa-dev-api.xyz',
    renderBackendUrl: process.env.RENDER_BACKEND_URL || 'https://gaara-md-cf37.onrender.com',

    // Dashboard Security
    panelUsername: process.env.PANEL_USERNAME || 'admin',
    panelPasswordEnv: process.env.PANEL_PASSWORD || '',
    jwtSecret: process.env.PANEL_JWT_SECRET || 'gaara_x_md_secure_token_secret_key_2026',

    // Storage Paths
    dataDir,
    sessionDir,

    // Anti-Ban Safeguards
    humanJitterMinMs: parseInt(process.env.HUMAN_JITTER_MIN_MS || '100', 10),
    humanJitterMaxMs: parseInt(process.env.HUMAN_JITTER_MAX_MS || '250', 10),
    memoryGuardMb: parseInt(process.env.MEMORY_GUARD_MB || '200', 10),
    lowMemoryMode: process.env.LOW_MEMORY_MODE !== 'false',
    alwaysOn: process.env.ALWAYS_ON !== 'false',
    alwaysOnline: process.env.ALWAYS_ONLINE !== 'false'
};

export default config;
