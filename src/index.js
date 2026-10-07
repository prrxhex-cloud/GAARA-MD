import createServer from './server/app.js';
import config from '../config/index.js';
import db from '../config/database.js';
import { initBotSocket, getSocket } from './bot/socket.js';
import logger from './utils/logger.js';

async function bootstrap() {
    try {
        console.log(`
  ======================================================
  ⚡ GAARA X MD - WhatsApp Bot & Management Panel
  🌸 Developer: GAARA DEV OFC
  ======================================================
        `);

        // 1. Start Express Web Server
        const app = createServer();
        const server = app.listen(config.port, () => {
            logger.info(`[Server] Web Dashboard running at http://localhost:${config.port}`);
            logger.info(`[Server] Pairing Portal at http://localhost:${config.port}/pair`);
            logger.info(`[Server] Settings Panel at http://localhost:${config.port}/settings`);
            logger.info(`[Server] Telemetry at http://localhost:${config.port}/status`);
        });

        // 2. Initialize WhatsApp Bot Engine
        logger.info('[Bot] Starting GAARA X MD Baileys Client...');
        try {
            await initBotSocket();
        } catch (botErr) {
            logger.error({ err: botErr.message }, '[Bot] Failed to start socket on boot; will wait for dashboard trigger');
        }

        // 3. Render Anti-Sleep Keepalive Worker (pings /health every 10 mins)
        if (config.appUrl && !config.appUrl.includes('localhost') && !config.appUrl.includes('127.0.0.1')) {
            setInterval(async () => {
                try {
                    await fetch(`${config.appUrl}/health`);
                    logger.debug('[KeepAlive] Sent self-ping to prevent idle sleep');
                } catch (kaErr) {
                    logger.debug({ err: kaErr.message }, '[KeepAlive] Self-ping failed');
                }
            }, 600000); // 10 minutes
        }

        // 4. Graceful Shutdown
        const shutdown = () => {
            logger.info('[System] Gracefully shutting down...');
            server.close(() => {
                const sock = getSocket();
                if (sock?.shutdown) {
                    sock.shutdown();
                }
                process.exit(0);
            });
        };

        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);

    } catch (err) {
        logger.fatal({ err: err.message, stack: err.stack }, '[System] Fatal bootstrap error');
        process.exit(1);
    }
}

bootstrap();
