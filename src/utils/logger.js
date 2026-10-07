import pino from 'pino';

export const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    timestamp: pino.stdTimeFunctions.isoTime
});

export const baileysLogger = pino({ level: 'silent' });

export default logger;
