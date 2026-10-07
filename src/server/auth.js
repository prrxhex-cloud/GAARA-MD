import crypto from 'crypto';
import config from '../../config/index.js';
import db from '../../config/database.js';

// Simple, fast in-memory active sessions map (token -> expiry)
const activeTokens = new Map();

export function createSessionToken() {
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000; // 7 days
    activeTokens.set(token, expiresAt);
    return token;
}

export function isValidSession(token) {
    if (!token) return false;
    const expiresAt = activeTokens.get(token);
    if (!expiresAt) return false;
    if (Date.now() > expiresAt) {
        activeTokens.delete(token);
        return false;
    }
    return true;
}

/**
 * Express middleware to protect panel API routes.
 */
export function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    let token = null;

    if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.slice(7);
    } else if (req.headers['x-panel-token']) {
        token = req.headers['x-panel-token'];
    } else if (req.query && req.query.token) {
        token = req.query.token;
    }

    if (!isValidSession(token)) {
        return res.status(401).json({ error: 'Unauthorized. Invalid or expired session token.' });
    }

    next();
}
