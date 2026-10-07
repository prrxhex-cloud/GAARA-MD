import express from 'express';
import cors from 'cors';
import path from 'path';
import config from '../../config/index.js';
import { setupRoutes } from './routes.js';

export function createServer() {
    const app = express();

    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Serve public static frontend
    app.use(express.static(path.join(config.rootDir, 'public')));

    // Register routes
    setupRoutes(app);

    return app;
}

export default createServer;
