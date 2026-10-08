let token = localStorage.getItem('panel_token') || '';
let apiBaseUrl = localStorage.getItem('api_base_url') || '';

// Parse ?api= URL query parameter for seamless Vercel frontend config
const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has('api')) {
    const passedApi = urlParams.get('api').trim().replace(/\/+$/, '');
    if (passedApi) {
        localStorage.setItem('api_base_url', passedApi);
        apiBaseUrl = passedApi;
    }
}

function apiUrl(endpoint) {
    if (!apiBaseUrl) return endpoint;
    const base = apiBaseUrl.replace(/\/+$/, '');
    return `${base}${endpoint}`;
}

function promptBackendUrl() {
    const current = localStorage.getItem('api_base_url') || '';
    const next = prompt('Enter your WhatsApp bot backend URL (e.g. https://gaara-x-md.onrender.com or leave blank for local/same origin):', current);
    if (next !== null) {
        const cleaned = next.trim().replace(/\/+$/, '');
        localStorage.setItem('api_base_url', cleaned);
        apiBaseUrl = cleaned;
        showToast('Backend URL updated: ' + (cleaned || 'Same origin'));
        setTimeout(() => window.location.reload(), 600);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    initAuthCheck();
    initTabNav();
    loadAllData();

    // Live polling for real-time connection status & disconnect detection
    setInterval(loadConnectionStatus, 3000);

    // Init Backend API Base URL inputs
    const apiInput = document.getElementById('apiBaseUrlInput');
    if (apiInput) {
        apiInput.value = apiBaseUrl;
    }
    const loginApiInput = document.getElementById('loginApiBaseUrlInput');
    if (loginApiInput) {
        loginApiInput.value = apiBaseUrl;
    }
});

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = isError ? '#ff334b' : '#00f0aa';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}

// ----------------------------------------------------
// Tab Navigation
// ----------------------------------------------------
function initTabNav() {
    const tabBtns = document.querySelectorAll('.tab-btn');
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const targetId = btn.getAttribute('data-tab');
            tabBtns.forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));

            btn.classList.add('active');
            const targetEl = document.getElementById(targetId);
            if (targetEl) targetEl.classList.add('active');
        });
    });
}

// ----------------------------------------------------
// Auth Handlers
// ----------------------------------------------------
async function initAuthCheck() {
    const modal = document.getElementById('loginModal');
    const loginApiInput = document.getElementById('loginApiBaseUrlInput');
    if (loginApiInput && apiBaseUrl) {
        loginApiInput.value = apiBaseUrl;
    }

    if (!token) {
        if (modal) modal.style.display = 'flex';
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/auth/check'), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.authenticated && modal) {
            modal.style.display = 'flex';
        }
    } catch {
        if (modal) modal.style.display = 'flex';
    }
}

async function handleLogin() {
    const loginApiInput = document.getElementById('loginApiBaseUrlInput');
    if (loginApiInput && loginApiInput.value.trim()) {
        const customUrl = loginApiInput.value.trim().replace(/\/+$/, '');
        localStorage.setItem('api_base_url', customUrl);
        apiBaseUrl = customUrl;
    }

    const passInput = document.getElementById('panelPasswordInput');
    const password = passInput?.value?.trim();
    if (!password) {
        showToast('Please enter panel password', true);
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/auth/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });
        const data = await res.json();

        if (data.success && data.token) {
            token = data.token;
            localStorage.setItem('panel_token', token);
            document.getElementById('loginModal').style.display = 'none';
            showToast('✅ Login successful!');
            loadAllData();
        } else {
            showToast(data.error || 'Invalid password', true);
        }
    } catch (err) {
        showToast('Login request failed. Verify Backend URL.', true);
    }
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

// ----------------------------------------------------
// Load & Render Data
// ----------------------------------------------------
async function loadAllData() {
    loadSettings();
    loadSchedules();
    loadReplies();
    loadConnectionStatus();
}

async function loadSettings() {
    try {
        const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
        if (!res.ok) return;
        const s = await res.json();

        // 01 Automation & Restore Destinations
        setCheck('antiDeleteToggle', s.antiDelete !== false);
        setVal('antiDeleteDestSelect', s.antiDeleteDestination || 'self');

        setCheck('antiEditToggle', s.antiEdit !== false);
        setVal('antiEditDestSelect', s.antiEditDestination || 'self');

        setCheck('viewOnceSaverToggle', s.viewOnceSaver !== false);
        setVal('viewOnceDestSelect', s.viewOnceDestination || 'self');
        setVal('viewOnceTriggerModeSelect', s.viewOnceTriggerMode || 'both');

        setCheck('autoStatusToggle', s.autoStatus !== false);
        setVal('autoStatusEmoji', s.autoStatusEmoji || '💖');
        setCheck('statusAntiDeleteToggle', s.statusAntiDelete !== false);
        setVal('statusDestSelect', s.statusDestination || 'self');

        setCheck('botLogsToggle', s.botLogs !== false);
        setVal('botLogsDestSelect', s.botLogsDestination || 'self');

        setCheck('antiCallToggle', s.antiCall);
        setVal('antiCallWarnings', s.antiCallMaxWarnings);
        setVal('antiCallTemplate', s.antiCallTemplate);

        setCheck('autoReplyToggle', s.autoReply);
        setCheck('aiAutoReplyToggle', s.aiAutoReply);
        setVal('sasaApiKeyInput', s.sasaDevApiKey ? '••••••••••••••••••••••••••••••••••••••••••••' : '');

        // 05 Identity & Profile
        setVal('botNameInput', s.botName);
        setVal('prefixInput', s.prefix);
        setVal('modeSelect', s.mode || 'public');
        setVal('headerTitleInput', s.headerTitle || 'GAARA X MD SUPPORT 🌸');
        setVal('footerTextInput', s.footerText || 'THIS BOT BUILT BY GAARA DEV OFC.');
        setVal('logoUrlInput', s.customLogoUrl || '');
        setVal('channelUrlInput', s.channelUrl || '');
        setVal('ownerNameInput', s.ownerName);
        setVal('ownerNumberInput', s.ownerNumber);
        setVal('ownerBioInput', s.ownerBio);
    } catch (err) {
        console.error('Error loading settings', err);
    }
}

async function saveAutomationSettings() {
    const payload = {
        antiDelete: getCheck('antiDeleteToggle'),
        antiDeleteDestination: getVal('antiDeleteDestSelect'),

        antiEdit: getCheck('antiEditToggle'),
        antiEditDestination: getVal('antiEditDestSelect'),

        viewOnceSaver: getCheck('viewOnceSaverToggle'),
        viewOnceDestination: getVal('viewOnceDestSelect'),
        viewOnceTriggerMode: getVal('viewOnceTriggerModeSelect') || 'both',

        autoStatus: getCheck('autoStatusToggle'),
        autoStatusEmoji: getVal('autoStatusEmoji'),
        statusAntiDelete: getCheck('statusAntiDeleteToggle'),
        statusDestination: getVal('statusDestSelect'),

        botLogs: getCheck('botLogsToggle'),
        botLogsDestination: getVal('botLogsDestSelect'),

        antiCall: getCheck('antiCallToggle'),
        antiCallMaxWarnings: parseInt(getVal('antiCallWarnings') || '3', 10),
        antiCallTemplate: getVal('antiCallTemplate'),

        autoReply: getCheck('autoReplyToggle'),
        aiAutoReply: getCheck('aiAutoReplyToggle')
    };

    const apiKeyVal = getVal('sasaApiKeyInput');
    if (apiKeyVal && !apiKeyVal.includes('•••')) {
        payload.sasaDevApiKey = apiKeyVal;
    }

    try {
        const res = await fetch(apiUrl('/api/settings'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Automation & Destination settings saved!');
        } else {
            showToast(data.error || 'Failed saving settings', true);
        }
    } catch {
        showToast('Save failed', true);
    }
}

async function saveProfileSettings() {
    const payload = {
        botName: getVal('botNameInput'),
        prefix: getVal('prefixInput'),
        mode: getVal('modeSelect'),
        headerTitle: getVal('headerTitleInput'),
        footerText: getVal('footerTextInput'),
        customLogoUrl: getVal('logoUrlInput'),
        channelUrl: getVal('channelUrlInput'),
        ownerName: getVal('ownerNameInput'),
        ownerNumber: getVal('ownerNumberInput'),
        ownerBio: getVal('ownerBioInput')
    };

    try {
        const res = await fetch(apiUrl('/api/settings'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Profile & Identity saved!');
        } else {
            showToast(data.error || 'Failed saving profile', true);
        }
    } catch {
        showToast('Save failed', true);
    }
}

// ----------------------------------------------------
// 02 Schedules Handlers
// ----------------------------------------------------
async function loadSchedules() {
    try {
        const res = await fetch(apiUrl('/api/schedules'), { headers: authHeaders() });
        if (!res.ok) return;
        const list = await res.json();
        const tbody = document.getElementById('schedulesTableBody');
        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No schedules configured yet.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => `
            <tr>
                <td><strong>+${item.jid.split('@')[0]}</strong></td>
                <td>${escapeHtml(item.message)}</td>
                <td><span class="status-pill status-online">${item.type.toUpperCase()}</span></td>
                <td>${item.time}</td>
                <td>
                    <button class="btn btn-secondary" onclick="toggleSchedule('${item.id}')">${item.active ? '⏸️ Pause' : '▶️ Resume'}</button>
                    <button class="btn btn-danger" onclick="deleteSchedule('${item.id}')">🗑️ Delete</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Error loading schedules', err);
    }
}

async function addSchedule() {
    const jid = getVal('schedTargetInput');
    const message = getVal('schedMessageInput');
    const type = getVal('schedTypeSelect');
    const time = getVal('schedTimeInput');

    if (!jid || !message || !time) {
        showToast('Please fill all schedule fields', true);
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/schedules'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ jid, message, type, time })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Schedule added!');
            setVal('schedTargetInput', '');
            setVal('schedMessageInput', '');
            loadSchedules();
        } else {
            showToast(data.error || 'Error adding schedule', true);
        }
    } catch {
        showToast('Request failed', true);
    }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this schedule?')) return;
    try {
        await fetch(apiUrl(`/api/schedules/${id}`), { method: 'DELETE', headers: authHeaders() });
        showToast('✅ Schedule deleted');
        loadSchedules();
    } catch {
        showToast('Delete failed', true);
    }
}

async function toggleSchedule(id) {
    try {
        await fetch(apiUrl(`/api/schedules/${id}/toggle`), { method: 'POST', headers: authHeaders() });
        loadSchedules();
    } catch {
        showToast('Toggle failed', true);
    }
}

// ----------------------------------------------------
// 04 Custom Replies Handlers
// ----------------------------------------------------
async function loadReplies() {
    try {
        const res = await fetch(apiUrl('/api/replies'), { headers: authHeaders() });
        if (!res.ok) return;
        const list = await res.json();
        const tbody = document.getElementById('repliesTableBody');
        if (!tbody) return;

        if (list.length === 0) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; color: var(--text-muted);">No custom replies found.</td></tr>`;
            return;
        }

        tbody.innerHTML = list.map(item => `
            <tr>
                <td><strong>${escapeHtml(item.trigger)}</strong></td>
                <td><span class="status-pill status-connecting">${item.matchType}</span></td>
                <td>${escapeHtml(item.response)}</td>
                <td>
                    <button class="btn btn-danger" onclick="deleteReply('${item.id}')">🗑️ Remove</button>
                </td>
            </tr>
        `).join('');
    } catch (err) {
        console.error('Error loading replies', err);
    }
}

async function addCustomReply() {
    const trigger = getVal('replyTriggerInput');
    const response = getVal('replyResponseInput');
    const matchType = getVal('replyMatchTypeSelect');

    if (!trigger || !response) {
        showToast('Please enter both trigger and response', true);
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/replies'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ trigger, response, matchType })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Custom reply added!');
            setVal('replyTriggerInput', '');
            setVal('replyResponseInput', '');
            loadReplies();
        } else {
            showToast(data.error || 'Error adding reply', true);
        }
    } catch {
        showToast('Request failed', true);
    }
}

async function deleteReply(id) {
    try {
        await fetch(apiUrl(`/api/replies/${id}`), { method: 'DELETE', headers: authHeaders() });
        showToast('✅ Reply removed');
        loadReplies();
    } catch {
        showToast('Remove failed', true);
    }
}

// ----------------------------------------------------
// 03 Connection & Diagnostics (Live Polling)
// ----------------------------------------------------
async function loadConnectionStatus() {
    try {
        const res = await fetch(apiUrl('/api/status'));
        const data = await res.json();

        const badge = document.getElementById('connStatusBadge');
        if (badge) {
            const isOnline = data.connection === 'open';
            const isOffline = data.connection === 'unlinked' || data.connection === 'disconnected';
            const label = isOnline ? 'ONLINE' : (isOffline ? 'OFFLINE / UNLINKED' : 'CONNECTING');

            badge.textContent = label;
            badge.className = `status-pill ${isOnline ? 'status-online' : (isOffline ? 'status-offline' : 'status-connecting')}`;
        }

        const phoneEl = document.getElementById('connPhone');
        if (phoneEl) {
            phoneEl.textContent = data.telemetry?.phoneNumber ? `+${data.telemetry.phoneNumber}` : 'Not linked / Offline';
        }

        const platformEl = document.getElementById('connPlatform');
        if (platformEl) platformEl.textContent = data.telemetry?.platform || 'Windows (Desktop)';

        const uptimeEl = document.getElementById('connUptime');
        if (uptimeEl) {
            const sec = data.telemetry?.uptimeSeconds || 0;
            const h = Math.floor(sec / 3600);
            const m = Math.floor((sec % 3600) / 60);
            const s = sec % 60;
            uptimeEl.textContent = `${h}h ${m}m ${s}s`;
        }

        const msgsEl = document.getElementById('connMsgs');
        if (msgsEl) msgsEl.textContent = data.telemetry?.messagesHandled || 0;

        const callsEl = document.getElementById('connCalls');
        if (callsEl) callsEl.textContent = data.telemetry?.callsIntercepted || 0;
    } catch (err) {
        const badge = document.getElementById('connStatusBadge');
        if (badge) {
            badge.textContent = 'OFFLINE / UNLINKED';
            badge.className = 'status-pill status-offline';
        }
    }
}

async function restartBot() {
    if (!confirm('Restart WhatsApp bot connection?')) return;
    try {
        const res = await fetch(apiUrl('/api/bot/restart'), { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        showToast(data.message || 'Restarting...');
        setTimeout(loadConnectionStatus, 3000);
    } catch {
        showToast('Restart failed', true);
    }
}

async function disconnectBot() {
    if (!confirm('Are you sure you want to disconnect and unlink this WhatsApp session?')) return;
    try {
        const res = await fetch(apiUrl('/api/disconnect'), { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        showToast(data.message || 'Bot disconnected successfully');
        setTimeout(() => {
            window.location.href = '/pair';
        }, 1200);
    } catch {
        showToast('Disconnect request failed', true);
    }
}

// ----------------------------------------------------
// Cloudflare D1 Sync Handlers
// ----------------------------------------------------
async function pullFromCloudflare() {
    showToast('☁️ Pulling persistent data from Cloudflare D1...');
    try {
        const res = await fetch(apiUrl('/api/sync/pull'), { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Cloudflare D1 data restored!');
            loadAllData();
        } else {
            showToast(data.reason || data.error || 'Failed pulling from Cloudflare', true);
        }
    } catch {
        showToast('Cloudflare pull request failed', true);
    }
}

async function pushToCloudflare() {
    showToast('☁️ Pushing backup to Cloudflare D1...');
    try {
        const res = await fetch(apiUrl('/api/sync/push'), { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Cloudflare D1 backup complete!');
        } else {
            showToast(data.reason || data.error || 'Failed pushing to Cloudflare', true);
        }
    } catch {
        showToast('Cloudflare push request failed', true);
    }
}

// ----------------------------------------------------
// Vercel Deployment & Backend URL Handlers
// ----------------------------------------------------
function saveApiBaseUrl() {
    const val = getVal('apiBaseUrlInput').trim();
    if (!val) {
        localStorage.removeItem('api_base_url');
        apiBaseUrl = '';
        showToast('✅ Backend URL reset to current origin');
    } else {
        localStorage.setItem('api_base_url', val);
        apiBaseUrl = val;
        showToast(`✅ Backend URL saved: ${val}`);
    }
    loadAllData();
}

// ----------------------------------------------------
// Security & Password Change
// ----------------------------------------------------
async function changePassword() {
    const newPassword = getVal('newPasswordInput');
    if (!newPassword || newPassword.length < 4) {
        showToast('Password must be at least 4 characters', true);
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/auth/change-password'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ newPassword })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Password changed successfully!');
            setVal('newPasswordInput', '');
        } else {
            showToast(data.error || 'Failed updating password', true);
        }
    } catch {
        showToast('Request failed', true);
    }
}

// Helpers
function getVal(id) { const el = document.getElementById(id); return el ? el.value : ''; }
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = (v !== undefined && v !== null) ? v : ''; }
function getCheck(id) { const el = document.getElementById(id); return el ? el.checked : false; }
function setCheck(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
