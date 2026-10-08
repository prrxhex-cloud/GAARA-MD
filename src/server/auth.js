import crypto from 'crypto';
import config from '../../config/index.js';

// Base64Url helper functions
function base64UrlEncode(strOrBuffer) {
    const buf = Buffer.isBuffer(strOrBuffer) ? strOrBuffer : Buffer.from(strOrBuffer, 'utf8');
    return buf
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
}

function base64UrlDecode(str) {
    let base64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (base64.length % 4) {
        base64 += '=';
    }
    return Buffer.from(base64, 'base64').toString('utf8');
}

// In-memory revoked tokens tracker and fallback legacy session map
const revokedTokens = new Set();
const legacySessionTokens = new Map();

/**
 * Creates a cryptographically signed HMAC-SHA256 JWT session token.
 * Contains issuer, audience, subject, expiration (7 days), and unique jti.
 */
export function createSessionToken(extraPayload = {}) {
    const secret = config.jwtSecret || 'gaara_x_md_secure_token_secret_key_2026';
    const header = {
        alg: 'HS256',
        typ: 'JWT'
    };

    const now = Math.floor(Date.now() / 1000);
    const payload = {
        sub: 'admin',
        iss: 'gaara-x-md',
        iat: now,
        exp: now + 7 * 24 * 60 * 60, // 7 days expiration
        jti: crypto.randomBytes(16).toString('hex'),
        ...extraPayload
    };

    const headerEncoded = base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = base64UrlEncode(JSON.stringify(payload));
    const dataToSign = `${headerEncoded}.${payloadEncoded}`;

    const signature = crypto
        .createHmac('sha256', secret)
        .update(dataToSign)
        .digest();
    const signatureEncoded = base64UrlEncode(signature);

    return `${dataToSign}.${signatureEncoded}`;
}

/**
 * Validates a session token with timing attack resistance, algorithm verification,
 * and expiration checking.
 */
export function isValidSession(token) {
    if (!token || typeof token !== 'string') return false;

    // Check if token has been explicitly revoked
    if (revokedTokens.has(token)) return false;

    // Check legacy in-memory session token fallback
    if (legacySessionTokens.has(token)) {
        const expiresAt = legacySessionTokens.get(token);
        if (Date.now() > expiresAt) {
            legacySessionTokens.delete(token);
            return false;
        }
        return true;
    }

    // Verify JWT format: header.payload.signature
    const parts = token.split('.');
    if (parts.length !== 3) return false;

    const [headerB64, payloadB64, signatureB64] = parts;

    try {
        const header = JSON.parse(base64UrlDecode(headerB64));

        // Strict algorithm check: prevent "alg: none" or algorithm confusion attacks
        if (header.alg !== 'HS256' || header.typ !== 'JWT') {
            return false;
        }

        const payload = JSON.parse(base64UrlDecode(payloadB64));

        // Check expiration
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && typeof payload.exp === 'number' && payload.exp < now) {
            return false;
        }

        // Compute expected signature
        const secret = config.jwtSecret || 'gaara_x_md_secure_token_secret_key_2026';
        const expectedSig = crypto
            .createHmac('sha256', secret)
            .update(`${headerB64}.${payloadB64}`)
            .digest();
        const expectedSigB64 = base64UrlEncode(expectedSig);

        // Constant-time comparison to prevent timing attacks
        const providedSigBuf = Buffer.from(signatureB64, 'utf8');
        const expectedSigBuf = Buffer.from(expectedSigB64, 'utf8');

        if (providedSigBuf.length !== expectedSigBuf.length) {
            return false;
        }

        return crypto.timingSafeEqual(providedSigBuf, expectedSigBuf);
    } catch {
        return false;
    }
}

/**
 * Revokes an active session token immediately.
 */
export function revokeSessionToken(token) {
    if (token && typeof token === 'string') {
        revokedTokens.add(token);
        legacySessionTokens.delete(token);
    }
}

/**
 * Express middleware to protect panel API routes.
 */
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7).trim();
    } else if (req.headers['x-panel-token']) {
        token = req.headers['x-panel-token'];
    }

    if (!isValidSession(token)) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or expired session token.' });
    }

    next();
}

export default {
    createSessionToken,
    isValidSession,
    revokeSessionToken,
    requireAuth
};
