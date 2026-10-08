/**
 * GAARA X MD - In-Memory Sliding Window Rate Limiter Middleware
 * Provides protection against brute force attacks, credential stuffing, and DoS.
 */

export function createRateLimiter({
    windowMs = 60 * 1000,
    max = 5,
    message = 'Too many requests, please try again later.',
    statusCode = 429
} = {}) {
    const hits = new Map();

    // Automatic cleanup of stale IP records
    const cleanupInterval = setInterval(() => {
        const now = Date.now();
        for (const [ip, record] of hits.entries()) {
            if (now > record.resetTime) {
                hits.delete(ip);
            }
        }
    }, Math.max(windowMs, 30000));

    // Ensure timer does not prevent process exit in tests or runtime
    if (cleanupInterval.unref) {
        cleanupInterval.unref();
    }

    const middleware = function rateLimitMiddleware(req, res, next) {
        // Resolve client IP (support Cloudflare, proxies, and direct socket)
        const ip =
            req.headers['cf-connecting-ip'] ||
            (req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : null) ||
            req.ip ||
            req.socket?.remoteAddress ||
            '127.0.0.1';

        const now = Date.now();
        let record = hits.get(ip);

        if (!record || now > record.resetTime) {
            record = { count: 1, resetTime: now + windowMs };
            hits.set(ip, record);
            res.setHeader('X-RateLimit-Limit', max);
            res.setHeader('X-RateLimit-Remaining', Math.max(0, max - 1));
            res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));
            return next();
        }

        record.count++;
        const remaining = Math.max(0, max - record.count);
        res.setHeader('X-RateLimit-Limit', max);
        res.setHeader('X-RateLimit-Remaining', remaining);
        res.setHeader('X-RateLimit-Reset', Math.ceil(record.resetTime / 1000));

        if (record.count > max) {
            const retryAfterSec = Math.max(1, Math.ceil((record.resetTime - now) / 1000));
            res.setHeader('Retry-After', retryAfterSec);
            return res.status(statusCode).json({
                error: message,
                retryAfterSeconds: retryAfterSec
            });
        }

        next();
    };

    // Helper method to reset hits (useful for testing)
    middleware.reset = function () {
        hits.clear();
    };

    return middleware;
}

export default createRateLimiter;
