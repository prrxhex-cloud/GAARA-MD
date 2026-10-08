import config from '../../config/index.js';
import db from '../../config/database.js';
import logger from '../utils/logger.js';

export const SASA_DEV_BASE_URL = config.sasaDevApiBaseUrl || 'https://sasa-dev-api.xyz';
export const PERMANENT_SASA_KEY = config.sasaDevApiKey || 'Sasa_Dev_Api_3a20968903b0fa8f866eb471f05003a7cd016c44';
export const RENDER_BACKEND_URL = config.renderBackendUrl || 'https://gaara-md-cf37.onrender.com';

/**
 * Returns the server-side SASA DEV API Key safely.
 */
export function getSasaDevApiKey() {
    const settings = db.getSettings();
    return settings.sasaDevApiKey || PERMANENT_SASA_KEY;
}

/**
 * Primary Sasa AI Plus chat query endpoint:
 * /api/sasaaiplus/chat?apikey=...&text=...
 *
 * @param {string} prompt - User or context prompt
 * @param {object} options - Optional configuration (timeoutMs, etc.)
 * @returns {Promise<{ success: boolean, reply: string, error?: string }>}
 */
export async function chatSasaAiPlus(prompt, { timeoutMs = 12000 } = {}) {
    if (!prompt || typeof prompt !== 'string') {
        return { success: false, reply: '', error: 'Prompt must be a non-empty string' };
    }

    const apiKey = getSasaDevApiKey();
    if (!apiKey) {
        return { success: false, reply: '', error: 'Sasa Dev API key not configured' };
    }

    try {
        const url = `${SASA_DEV_BASE_URL}/api/sasaaiplus/chat?apikey=${encodeURIComponent(apiKey)}&text=${encodeURIComponent(prompt)}`;
        const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });

        if (!res.ok) {
            throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();
        let reply = '';
        if (data && data.status && data.result) {
            reply = data.result;
        } else if (data && data.reply) {
            reply = data.reply;
        } else if (data && data.result) {
            reply = data.result;
        } else if (data && data.message) {
            reply = data.message;
        } else if (data && data.error) {
            logger.warn({ error: data.error }, '[SasaApi] Sasa AI returned API error');
            return { success: false, reply: '', error: data.error };
        }

        return { success: true, reply, data };
    } catch (err) {
        logger.warn({ err: err.message, prompt: prompt.slice(0, 50) }, '[SasaApi] Request failed');
        return { success: false, reply: '', error: err.message };
    }
}

export default {
    SASA_DEV_BASE_URL,
    PERMANENT_SASA_KEY,
    RENDER_BACKEND_URL,
    getSasaDevApiKey,
    chatSasaAiPlus
};
