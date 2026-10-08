import express from 'express';
import cors from 'cors';
import path from 'path';
import config from '../../config/index.js';
import { setupRoutes } from './routes.js';
import logger from '../utils/logger.js';

export function createServer() {
    const app = express();

    // Disable X-Powered-By to prevent framework fingerprinting
    app.disable('x-powered-by');

    // Trust reverse proxy (Cloudflare / Render / Vercel)
    app.set('trust proxy', 1);

    // Security HTTP Headers (Defense-in-depth against Clickjacking, MIME sniffing, XSS)
    app.use((req, res, next) => {
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '1; mode=block');
        res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
        res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
        res.setHeader(
            'Content-Security-Policy',
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https:;"
        );

        if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
            res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
        }

        next();
    });

    // CORS policy
    app.use(cors());

    // Request body parser with bounded limits (1mb) to mitigate memory exhaustion DoS
    app.use(express.json({ limit: '1mb' }));
    app.use(express.urlencoded({ extended: true, limit: '1mb' }));

    // Serve public static frontend
    app.use(express.static(path.join(config.rootDir, 'public')));

    // Register routes
    setupRoutes(app);

    // 404 handler for unknown API endpoints
    app.use('/api/*', (req, res) => {
        res.status(404).json({ error: 'Endpoint not found' });
    });

    // Centralized safe error handler (prevents leaking stack traces or internal secrets)
    app.use((err, req, res, next) => {
        logger.error({ err: err.message, status: err.status || 500 }, '[Server] Handled request error');
        const status = err.status || err.statusCode || 500;
        res.status(status).json({
            error: status === 500 ? 'Internal Server Error' : err.message
        });
    });

    return app;
}

export default createServer;
