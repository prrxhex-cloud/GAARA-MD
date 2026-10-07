let token = localStorage.getItem('panel_token') || '';

document.addEventListener('DOMContentLoaded', () => {
    initAuthCheck();
    initTabNav();
    loadAllData();
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
    if (!token) {
        if (modal) modal.style.display = 'flex';
        return;
    }

    try {
        const res = await fetch('/api/auth/check', {
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
    const passInput = document.getElementById('panelPasswordInput');
    const password = passInput?.value?.trim();
    if (!password) {
        showToast('Please enter panel password', true);
        return;
    }

    try {
        const res = await fetch('/api/auth/login', {
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
        showToast('Login request failed', true);
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
        const res = await fetch('/api/settings', { headers: authHeaders() });
        if (!res.ok) return;
        const s = await res.json();

        // 01 Automation
        setCheck('antiCallToggle', s.antiCall);
        setVal('antiCallWarnings', s.antiCallMaxWarnings);
        setVal('antiCallTemplate', s.antiCallTemplate);
        setCheck('antiDeleteToggle', s.antiDelete);
        setCheck('antiDeleteNotifySelf', s.antiDeleteNotifySelf);
        setCheck('autoStatusToggle', s.autoStatus);
        setVal('autoStatusEmoji', s.autoStatusEmoji || '💖');
        setCheck('autoReplyToggle', s.autoReply);
        setCheck('aiAutoReplyToggle', s.aiAutoReply);
        setCheck('viewOnceSaverToggle', s.viewOnceSaver);
        setVal('sasaApiKeyInput', s.sasaDevApiKey || '');

        // Identity & Profile
        setVal('botNameInput', s.botName);
        setVal('prefixInput', s.prefix);
        setVal('modeSelect', s.mode);
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
        antiCall: getCheck('antiCallToggle'),
        antiCallMaxWarnings: parseInt(getVal('antiCallWarnings') || '3', 10),
        antiCallTemplate: getVal('antiCallTemplate'),
        antiDelete: getCheck('antiDeleteToggle'),
        antiDeleteNotifySelf: getCheck('antiDeleteNotifySelf'),
        autoStatus: getCheck('autoStatusToggle'),
        autoStatusEmoji: getVal('autoStatusEmoji'),
        autoReply: getCheck('autoReplyToggle'),
        aiAutoReply: getCheck('aiAutoReplyToggle'),
        viewOnceSaver: getCheck('viewOnceSaverToggle'),
        sasaDevApiKey: getVal('sasaApiKeyInput')
    };

    try {
        const res = await fetch('/api/settings', {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('✅ Automation settings saved!');
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
        customLogoUrl: getVal('logoUrlInput'),
        channelUrl: getVal('channelUrlInput'),
        ownerName: getVal('ownerNameInput'),
        ownerNumber: getVal('ownerNumberInput'),
        ownerBio: getVal('ownerBioInput')
    };

    try {
        const res = await fetch('/api/settings', {
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
        const res = await fetch('/api/schedules', { headers: authHeaders() });
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
        const res = await fetch('/api/schedules', {
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
        await fetch(`/api/schedules/${id}`, { method: 'DELETE', headers: authHeaders() });
        showToast('✅ Schedule deleted');
        loadSchedules();
    } catch {
        showToast('Delete failed', true);
    }
}

async function toggleSchedule(id) {
    try {
        await fetch(`/api/schedules/${id}/toggle`, { method: 'POST', headers: authHeaders() });
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
        const res = await fetch('/api/replies', { headers: authHeaders() });
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
        const res = await fetch('/api/replies', {
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
        await fetch(`/api/replies/${id}`, { method: 'DELETE', headers: authHeaders() });
        showToast('✅ Reply removed');
        loadReplies();
    } catch {
        showToast('Remove failed', true);
    }
}

// ----------------------------------------------------
// 03 Connection & Diagnostics
// ----------------------------------------------------
async function loadConnectionStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();

        const badge = document.getElementById('connStatusBadge');
        if (badge) {
            badge.textContent = (data.connection || 'UNKNOWN').toUpperCase();
            badge.className = `status-pill ${data.connection === 'open' ? 'status-online' : data.connection === 'connecting' ? 'status-connecting' : 'status-offline'}`;
        }

        const phoneEl = document.getElementById('connPhone');
        if (phoneEl) {
            phoneEl.textContent = data.telemetry?.phoneNumber ? `+${data.telemetry.phoneNumber}` : 'Not linked yet';
        }

        const platformEl = document.getElementById('connPlatform');
        if (platformEl) platformEl.textContent = data.telemetry?.platform || 'Desktop';

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
        console.error('Error fetching bot status', err);
    }
}

async function restartBot() {
    if (!confirm('Restart WhatsApp bot connection?')) return;
    try {
        const res = await fetch('/api/bot/restart', { method: 'POST', headers: authHeaders() });
        const data = await res.json();
        showToast(data.message || 'Restarting...');
        setTimeout(loadConnectionStatus, 3000);
    } catch {
        showToast('Restart failed', true);
    }
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
        const res = await fetch('/api/auth/change-password', {
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
function setVal(id, v) { const el = document.getElementById(id); if (el) el.value = v; }
function getCheck(id) { const el = document.getElementById(id); return el ? el.checked : false; }
function setCheck(id, v) { const el = document.getElementById(id); if (el) el.checked = !!v; }
function escapeHtml(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
