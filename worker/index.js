/**
 * Cloudflare Worker: ofc
 * URL: https://ofc.sayurusenavirathna70.workers.dev
 * Database: ofc-database (binding: env.D1)
 */

const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
    'Content-Type': 'application/json'
};

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: corsHeaders
    });
}

function checkAuth(request, env) {
    const authHeader = request.headers.get('Authorization') || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    if (env.API_AUTH_TOKEN) {
        return token === env.API_AUTH_TOKEN;
    }
    // Default: require valid Bearer token string
    return !!token && token.length > 0;
}

export default {
    async fetch(request, env, ctx) {
        // Handle CORS Preflight
        if (request.method === 'OPTIONS') {
            return new Response(null, {
                status: 204,
                headers: corsHeaders
            });
        }

        const url = new URL(request.url);
        const path = url.pathname;
        const method = request.method;

        // Public Health Endpoint
        if (path === '/' || path === '/health') {
            return json({
                status: 'ok',
                service: 'ofc',
                worker: 'GAARA X MD Cloudflare D1 Service',
                timestamp: new Date().toISOString()
            });
        }

        // Bearer Authentication for /api routes
        if (path.startsWith('/api/')) {
            if (!checkAuth(request, env)) {
                return json({ error: 'Unauthorized: Valid Bearer token required' }, 401);
            }
        }

        try {
            // ----------------------------------------------------
            // 1. Secrets Route: GET /api/secrets
            // ----------------------------------------------------
            if (path === '/api/secrets' && method === 'GET') {
                const { results } = await env.D1.prepare(
                    'SELECT key, value, created_at FROM secrets'
                ).all();
                return json({ success: true, secrets: results || [] });
            }

            // Route pattern: /api/user/:phone/:resource
            const userRouteMatch = path.match(/^\/api\/user\/([^/]+)\/(settings|schedules|replies)$/);
            if (userRouteMatch) {
                const rawPhone = userRouteMatch[1];
                const cleanPhone = rawPhone.replace(/[^0-9]/g, '');
                const resource = userRouteMatch[2];

                if (!cleanPhone) {
                    return json({ error: 'Invalid phone number format' }, 400);
                }

                // --- Settings Endpoints ---
                if (resource === 'settings') {
                    if (method === 'GET') {
                        const row = await env.D1.prepare(
                            'SELECT settings_json, updated_at FROM user_settings WHERE phone = ?'
                        ).bind(cleanPhone).first();

                        if (!row) {
                            return json({ success: true, phone: cleanPhone, settings: null });
                        }

                        let parsed = {};
                        try {
                            parsed = JSON.parse(row.settings_json);
                        } catch {
                            parsed = {};
                        }
                        return json({
                            success: true,
                            phone: cleanPhone,
                            settings: parsed,
                            updated_at: row.updated_at
                        });
                    }

                    if (method === 'POST') {
                        const body = await request.json();
                        const serialized = JSON.stringify(body);
                        await env.D1.prepare(`
                            INSERT INTO user_settings (phone, settings_json, updated_at)
                            VALUES (?, ?, CURRENT_TIMESTAMP)
                            ON CONFLICT(phone) DO UPDATE SET
                                settings_json = excluded.settings_json,
                                updated_at = CURRENT_TIMESTAMP
                        `).bind(cleanPhone, serialized).run();

                        return json({
                            success: true,
                            message: 'Settings saved successfully',
                            phone: cleanPhone
                        });
                    }
                }

                // --- Schedules Endpoints ---
                if (resource === 'schedules') {
                    if (method === 'GET') {
                        const { results } = await env.D1.prepare(
                            'SELECT id, jid, message, type, time, active, created_at, updated_at FROM user_schedules WHERE phone = ?'
                        ).bind(cleanPhone).all();

                        const mapped = (results || []).map(r => ({
                            id: r.id,
                            jid: r.jid,
                            message: r.message,
                            type: r.type,
                            time: r.time,
                            active: !!r.active,
                            createdAt: r.created_at,
                            updatedAt: r.updated_at
                        }));

                        return json({ success: true, phone: cleanPhone, schedules: mapped });
                    }

                    if (method === 'POST') {
                        const body = await request.json();
                        const items = Array.isArray(body) ? body : [body];

                        for (const s of items) {
                            if (!s.jid || !s.message || !s.time) continue;
                            const id = s.id || `sched-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                            const activeVal = s.active === false ? 0 : 1;

                            await env.D1.prepare(`
                                INSERT INTO user_schedules (id, phone, jid, message, type, time, active, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                ON CONFLICT(id) DO UPDATE SET
                                    jid = excluded.jid,
                                    message = excluded.message,
                                    type = excluded.type,
                                    time = excluded.time,
                                    active = excluded.active,
                                    updated_at = CURRENT_TIMESTAMP
                            `).bind(id, cleanPhone, s.jid, s.message, s.type || 'daily', s.time, activeVal).run();
                        }

                        return json({ success: true, message: 'Schedules saved', count: items.length });
                    }
                }

                // --- Replies Endpoints ---
                if (resource === 'replies') {
                    if (method === 'GET') {
                        const { results } = await env.D1.prepare(
                            'SELECT id, trigger, response, match_type as matchType, enabled, created_at FROM user_replies WHERE phone = ?'
                        ).bind(cleanPhone).all();

                        const mapped = (results || []).map(r => ({
                            id: r.id,
                            trigger: r.trigger,
                            response: r.response,
                            matchType: r.matchType,
                            enabled: !!r.enabled,
                            createdAt: r.created_at
                        }));

                        return json({ success: true, phone: cleanPhone, replies: mapped });
                    }

                    if (method === 'POST') {
                        const body = await request.json();
                        const items = Array.isArray(body) ? body : [body];

                        for (const r of items) {
                            if (!r.trigger || !r.response) continue;
                            const id = r.id || `reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
                            const enabledVal = r.enabled === false ? 0 : 1;
                            const matchType = r.matchType || r.match_type || 'contains';

                            await env.D1.prepare(`
                                INSERT INTO user_replies (id, phone, trigger, response, match_type, enabled, updated_at)
                                VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                                ON CONFLICT(id) DO UPDATE SET
                                    trigger = excluded.trigger,
                                    response = excluded.response,
                                    match_type = excluded.match_type,
                                    enabled = excluded.enabled,
                                    updated_at = CURRENT_TIMESTAMP
                            `).bind(id, cleanPhone, r.trigger.trim(), r.response.trim(), matchType, enabledVal).run();
                        }

                        return json({ success: true, message: 'Replies saved', count: items.length });
                    }
                }
            }

            return json({ error: 'Endpoint not found' }, 404);
        } catch (err) {
            return json({ error: err.message || 'Internal Worker Error' }, 500);
        }
    }
};
