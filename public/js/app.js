/* ==========================================================================
   GAARA X MD — Live Dashboard App Logic
   Powers settings, live toggles, schedule creator, media uploads, and socket status
   ========================================================================== */

let token = localStorage.getItem('panel_token') || '';
let selectedLogoBase64 = null;
let selectedVoiceBase64 = null;
let selectedVoiceFileName = '';

const PERMANENT_BACKEND_URL = 'https://gaara-md-cf37.onrender.com';
const urlParams = new URLSearchParams(typeof window !== 'undefined' ? window.location.search : '');
if (urlParams.has('api')) {
    const passedApi = urlParams.get('api').trim().replace(/\/+$/, '');
    if (passedApi) {
        localStorage.setItem('api_base_url', passedApi);
    }
}

function getApiBase() {
    const stored = localStorage.getItem('api_base_url');
    if (stored) return stored.replace(/\/+$/, '');
    if (typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')) {
        return PERMANENT_BACKEND_URL;
    }
    return '';
}

function apiUrl(endpoint) {
    const base = getApiBase();
    return base ? `${base}${endpoint}` : endpoint;
}

function authHeaders() {
    return {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
    };
}

function showToast(message) {
    const toast = document.getElementById('toastNotification');
    const msg = document.getElementById('toastMessage');
    if (!toast || !msg) return;
    msg.textContent = message;
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3500);
}

function toggleNav() {
    const nav = document.getElementById('mainNav');
    if (nav) nav.classList.toggle('mobile-open');
}

// ----------------------------------------------------
// Tab Navigation (Smooth scroll to section & active state)
// ----------------------------------------------------
function switchTab(tabId, btn) {
    const target = document.getElementById(tabId);
    if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
    document.querySelectorAll('.tab-pill').forEach(b => b.classList.remove('active'));
    if (btn) btn.classList.add('active');
}

function initTabScrollSpy() {
    const sections = ['tab-automation', 'tab-schedules', 'tab-connection'];
    const pills = document.querySelectorAll('.tab-pill');
    if (!pills.length) return;

    window.addEventListener('scroll', () => {
        let current = '';
        sections.forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                const rect = el.getBoundingClientRect();
                if (rect.top <= 250 && rect.bottom > 150) {
                    current = id;
                }
            }
        });
        if (current) {
            pills.forEach(p => {
                if (p.getAttribute('data-tab') === current) {
                    p.classList.add('active');
                } else {
                    p.classList.remove('active');
                }
            });
        }
    }, { passive: true });
}

// ----------------------------------------------------
// Authentication Check & Login Modal
// ----------------------------------------------------
async function checkAuth() {
    const loginView = document.getElementById('settingsLoginView');
    const dashView = document.getElementById('settingsDashboardView');
    const overlay = document.getElementById('loginOverlay');

    const showLogin = () => {
        if (loginView) loginView.style.display = 'block';
        if (dashView) dashView.style.display = 'none';
        if (overlay) overlay.style.display = 'flex';
    };

    const showDashboard = () => {
        if (loginView) loginView.style.display = 'none';
        if (dashView) dashView.style.display = 'block';
        if (overlay) overlay.style.display = 'none';
        loadAllData();
    };

    if (!token) {
        showLogin();
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/auth/check'), {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        if (!data.authenticated) {
            showLogin();
        } else {
            showDashboard();
        }
    } catch {
        showLogin();
    }
}

function togglePasswordVisibility(inputId, btn) {
    const input = document.getElementById(inputId);
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btn) btn.textContent = '🙈';
    } else {
        input.type = 'password';
        if (btn) btn.textContent = '👁️';
    }
}
window.togglePasswordVisibility = togglePasswordVisibility;

async function handlePanelLogin(e) {
    e.preventDefault();
    const phoneInput = document.getElementById('loginPhoneInput');
    const passInput = document.getElementById('loginPasswordInput');
    const errBox = document.getElementById('loginErrorMsg');
    const btn = document.getElementById('btnLogin');

    const phone = phoneInput ? phoneInput.value.trim() : '';
    const password = passInput ? passInput.value.trim() : '';

    if (!password) {
        if (errBox) {
            errBox.textContent = 'Password is required';
            errBox.style.display = 'block';
        }
        return;
    }

    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Verifying...';
    }
    if (errBox) errBox.style.display = 'none';

    try {
        const res = await fetch(apiUrl('/api/login'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone, password })
        });

        const data = await res.json();
        if (data.success && data.token) {
            token = data.token;
            localStorage.setItem('panel_token', token);
            const loginView = document.getElementById('settingsLoginView');
            const dashView = document.getElementById('settingsDashboardView');
            const overlay = document.getElementById('loginOverlay');
            if (loginView) loginView.style.display = 'none';
            if (dashView) dashView.style.display = 'block';
            if (overlay) overlay.style.display = 'none';
            showToast('✅ Login successful!');
            loadAllData();
        } else {
            if (errBox) {
                errBox.textContent = data.error || 'Incorrect panel password';
                errBox.style.display = 'block';
            }
        }
    } catch (err) {
        if (errBox) {
            errBox.textContent = 'Login failed. Check server connection.';
            errBox.style.display = 'block';
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Sign in securely →';
        }
    }
}

function handleLogout() {
    if (!confirm('Log out from GAARA X MD settings dashboard?')) return;
    localStorage.removeItem('panel_token');
    token = '';
    window.location.reload();
}

// ----------------------------------------------------
// Load & Populate All Settings Data
// ----------------------------------------------------
async function loadAllData() {
    await Promise.all([
        loadSettings(),
        loadStatus(),
        loadReplies(),
        loadSchedules()
    ]);
}

async function loadSettings() {
    try {
        const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
        if (!res.ok) {
            if (res.status === 401) checkAuth();
            return;
        }
        const s = await res.json();

        // 01 Bot Behavior
        setVal('botModeSelect', s.mode || 'public');
        setVal('botPrefixSelect', s.prefix || '.');

        // Bot Profile
        setVal('botNameInput', s.botName || 'GAARA X MD');
        if (s.customLogoUrl) {
            const preview = document.getElementById('botLogoPreview');
            if (preview) preview.src = s.customLogoUrl;
        }

        // Auto Call Voice
        setCheck('toggleAutoCallAnswer', Boolean(s.autoCallAnswerMode));
        if (s.autoCallVoiceFile) {
            const title = document.getElementById('voiceStatusTitle');
            if (title) title.textContent = 'Voice file active: ' + s.autoCallVoiceFile.split(/[\\/]/).pop();
        }

        // Automation Toggles
        setCheck('toggleAntiCall', s.antiCall !== false);
        setCheck('toggleAutoStatusView', s.autoStatusView !== false);
        setCheck('toggleAutoStatusLike', Boolean(s.autoStatusLike));
        setCheck('toggleCommandReactions', s.commandReactions !== false);
        setCheck('toggleAutoTyping', Boolean(s.autoTyping));
        setCheck('toggleAutoRecording', Boolean(s.autoRecording));
        setCheck('toggleAlwaysOnline', Boolean(s.alwaysOnline));
        setCheck('toggleButtonMode', s.buttonMode !== false);
        setCheck('toggleAntiBug', s.antiBug !== false);
        setCheck('toggleAntiDelete', s.antiDelete !== false);
        setVal('antiDeleteDestSelect', s.antiDeleteDestination || 'self');
        setCheck('toggleAutoReply', Boolean(s.autoReply));

        // Call Templates
        setVal('callWarningText', s.antiCallWarningTemplate || s.antiCallTemplate || '⚠️ WARNING : {warning}/3\n🔞 DO NOT CALL THIS BOT NUMBER\n🚫 AUTO BLOCK AFTER : {remaining_text}');
        setVal('callBlockedText', s.antiCallBlockedTemplate || '📞 CALL REJECTED\n⚠️ WARNING LIMIT EXCEEDED : 3/3\n🚫 YOU HAVE BEEN AUTOMATICALLY BLOCKED');

        // Status reaction emoji
        setVal('statusEmojiInput', s.autoStatusEmoji || '🎀');

        // Owner Profile
        setVal('ownerProfileText', s.ownerProfile || s.ownerBio || '');
        updateProfileCount();

        // Blacklist
        renderBlacklist(s.blacklist || []);

    } catch (err) {
        console.error('Error fetching settings:', err);
    }
}

async function loadStatus() {
    try {
        const res = await fetch(apiUrl('/api/status'));
        if (!res.ok) return;
        const data = await res.json();

        const isOpen = data.connection === 'open';
        const phone = data.telemetry?.phoneNumber;

        // Connected Account Box
        const accPhone = document.getElementById('accPhoneNumber');
        const accDot = document.getElementById('accStatusDot');
        if (accPhone) accPhone.textContent = phone ? `+${phone}` : (isOpen ? 'Connected' : 'Not linked');
        if (accDot) accDot.className = `status-dot ${isOpen ? '' : 'offline'}`;

        // Connection Tab status
        const connText = document.getElementById('connSocketText');
        const connDot = document.getElementById('connSocketDot');
        if (connText) connText.textContent = isOpen ? 'Online' : (data.connection === 'connecting' ? 'Connecting...' : 'Standby / Unlinked');
        if (connDot) connDot.className = `status-dot ${isOpen ? '' : 'offline'}`;

    } catch {}
}

function setVal(id, val) {
    const el = document.getElementById(id);
    if (el && val !== undefined) el.value = val;
}

function setCheck(id, val) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(val);
}

// ----------------------------------------------------
// Save Immediate Settings
// ----------------------------------------------------
async function saveImmediateSetting(key, value) {
    try {
        const payload = { [key]: value };
        const res = await fetch(apiUrl('/api/settings'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (data.success) {
            showToast('✓ Saved: ' + key);
        } else {
            showToast('Error: ' + (data.error || 'Failed to save'));
        }
    } catch (err) {
        showToast('Save failed: ' + err.message);
    }
}

// ----------------------------------------------------
// Bot Profile & Logo
// ----------------------------------------------------
function handleLogoFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        alert('Image exceeds 5 MB limit');
        return;
    }
    const reader = new FileReader();
    reader.onload = (evt) => {
        selectedLogoBase64 = evt.target.result;
        const preview = document.getElementById('botLogoPreview');
        if (preview) preview.src = selectedLogoBase64;
    };
    reader.readAsDataURL(file);
}

async function saveBotProfile() {
    const botName = document.getElementById('botNameInput').value.trim();
    try {
        if (selectedLogoBase64) {
            await fetch(apiUrl('/api/upload/logo'), {
                method: 'POST',
                headers: authHeaders(),
                body: JSON.stringify({ dataUrl: selectedLogoBase64 })
            });
        }
        if (botName) {
            await saveImmediateSetting('botName', botName);
        }
        showToast('✓ Bot profile updated!');
    } catch (err) {
        showToast('Failed to save bot profile');
    }
}

async function resetDefaultLogo() {
    const defaultLogo = '/assets/bot_icon.jpg';
    document.getElementById('botLogoPreview').src = defaultLogo;
    selectedLogoBase64 = null;
    await saveImmediateSetting('customLogoUrl', defaultLogo);
    showToast('✓ Reset to default logo');
}

// ----------------------------------------------------
// Auto Call Voice File
// ----------------------------------------------------
function handleVoiceFileSelect(e) {
    const file = e.target.files[0];
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
        alert('Audio file exceeds 15 MB limit');
        return;
    }
    selectedVoiceFileName = file.name;
    const reader = new FileReader();
    reader.onload = (evt) => {
        selectedVoiceBase64 = evt.target.result;
    };
    reader.readAsDataURL(file);
}

async function uploadVoiceFile() {
    if (!selectedVoiceBase64) {
        alert('Please choose an audio file first.');
        return;
    }
    try {
        const res = await fetch(apiUrl('/api/upload/voice'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({
                dataUrl: selectedVoiceBase64,
                fileName: selectedVoiceFileName
            })
        });
        const data = await res.json();
        if (data.success) {
            const title = document.getElementById('voiceStatusTitle');
            if (title) title.textContent = 'Voice file active: ' + data.fileName;
            showToast('✓ Voice file saved!');
        } else {
            alert(data.error || 'Failed to upload voice file');
        }
    } catch (err) {
        alert('Upload error: ' + err.message);
    }
}

// ----------------------------------------------------
// Anti Call Messages & Placeholders
// ----------------------------------------------------
function insertPlaceholder(tag) {
    const warn = document.getElementById('callWarningText');
    if (warn) {
        warn.value += ' ' + tag;
    }
}

async function saveAntiCallTemplates() {
    const warning = document.getElementById('callWarningText').value;
    const blocked = document.getElementById('callBlockedText').value;

    await fetch(apiUrl('/api/settings'), {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
            antiCallWarningTemplate: warning,
            antiCallBlockedTemplate: blocked
        })
    });
    showToast('✓ Call templates updated');
}

function updateProfileCount() {
    const txt = document.getElementById('ownerProfileText').value;
    const counter = document.getElementById('profileCharCount');
    if (counter) counter.textContent = txt.length;
}

// ----------------------------------------------------
// Blacklist Management
// ----------------------------------------------------
function renderBlacklist(list) {
    const container = document.getElementById('blacklistContainer');
    if (!container) return;
    if (!list || list.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">No numbers have been blacklisted.</span>';
        return;
    }
    container.innerHTML = list.map(num => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card-subtle); padding: 0.5rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 0.4rem;">
            <span style="font-family: var(--font-mono); color: #fff;">+${num}</span>
            <button class="logout-link" onclick="removeBlacklistNumber('${num}')" style="background: none; border: none;">Remove</button>
        </div>
    `).join('');
}

async function addBlacklistNumber() {
    const input = document.getElementById('blacklistInput');
    const val = input.value.replace(/[^0-9]/g, '');
    if (!val || val.length < 8) {
        alert('Enter a valid phone number with country code (at least 8 digits)');
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
        const s = await res.json();
        const list = s.blacklist || [];
        if (!list.includes(val)) {
            list.push(val);
            await saveImmediateSetting('blacklist', list);
            input.value = '';
            renderBlacklist(list);
        }
    } catch (err) {
        alert('Failed to update blacklist');
    }
}

async function removeBlacklistNumber(num) {
    try {
        const res = await fetch(apiUrl('/api/settings'), { headers: authHeaders() });
        const s = await res.json();
        let list = s.blacklist || [];
        list = list.filter(n => n !== num);
        await saveImmediateSetting('blacklist', list);
        renderBlacklist(list);
    } catch (err) {
        alert('Failed to remove from blacklist');
    }
}

// ----------------------------------------------------
// Smart Replies Management
// ----------------------------------------------------
async function loadReplies() {
    try {
        const res = await fetch(apiUrl('/api/replies'), { headers: authHeaders() });
        if (!res.ok) return;
        const list = await res.json();
        renderReplies(list);
    } catch {}
}

function renderReplies(list) {
    const container = document.getElementById('repliesListContainer');
    if (!container) return;
    if (!list || list.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">No custom replies configured.</span>';
        return;
    }
    container.innerHTML = list.map(r => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card-subtle); padding: 0.75rem 1rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle);">
            <div>
                <strong style="color: #fff;">${escapeHtml(r.trigger)}</strong>
                <span class="badge-pill" style="margin-left: 0.5rem;">${r.matchType || 'contains'}</span>
                <div style="font-size: 0.82rem; color: var(--text-secondary); margin-top: 0.2rem;">${escapeHtml(r.response)}</div>
            </div>
            <button class="logout-link" onclick="deleteReply('${r.id}')" style="background: none; border: none;">Delete</button>
        </div>
    `).join('');
}

async function addCustomReply() {
    const trigger = document.getElementById('newReplyTrigger').value.trim();
    const response = document.getElementById('newReplyResponse').value.trim();
    const matchType = document.getElementById('newReplyMatch').value;

    if (!trigger || !response) {
        alert('Trigger and response are required');
        return;
    }

    try {
        const res = await fetch(apiUrl('/api/replies'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ trigger, response, matchType })
        });
        const json = await res.json();
        if (json.success) {
            document.getElementById('newReplyTrigger').value = '';
            document.getElementById('newReplyResponse').value = '';
            showToast('✓ Custom reply added');
            loadReplies();
        } else {
            alert(json.error || 'Failed to add reply');
        }
    } catch (err) {
        alert('Error: ' + err.message);
    }
}

async function deleteReply(id) {
    if (!confirm('Delete this smart auto-reply?')) return;
    try {
        await fetch(apiUrl(`/api/replies/${id}`), {
            method: 'DELETE',
            headers: authHeaders()
        });
        showToast('✓ Reply removed');
        loadReplies();
    } catch {}
}

// ----------------------------------------------------
// Schedules Management (Tab 02)
// ----------------------------------------------------
async function loadSchedules() {
    try {
        const res = await fetch(apiUrl('/api/schedules'), { headers: authHeaders() });
        if (!res.ok) return;
        const list = await res.json();
        renderSchedules(list);
    } catch {}
}

function renderSchedules(list) {
    const container = document.getElementById('schedulesListContainer');
    if (!container) return;
    if (!list || list.length === 0) {
        container.innerHTML = '<span style="color: var(--text-muted);">No daily automations scheduled.</span>';
        return;
    }
    container.innerHTML = list.map(s => `
        <div style="display: flex; justify-content: space-between; align-items: center; background: var(--bg-card-subtle); padding: 0.85rem 1.25rem; border-radius: var(--radius-sm); border: 1px solid var(--border-subtle); margin-bottom: 0.5rem;">
            <div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                    <span class="badge-pill green">${s.type || 'daily'}</span>
                    <strong style="color: #fff; font-family: var(--font-mono);">${escapeHtml(s.jid)}</strong>
                    <span style="font-size: 0.8rem; color: var(--neon-amber);">⏰ ${escapeHtml(s.time)}</span>
                </div>
                <div style="font-size: 0.85rem; color: var(--text-secondary); margin-top: 0.3rem;">${escapeHtml(s.message)}</div>
            </div>
            <div style="display: flex; gap: 0.75rem;">
                <button class="logout-link" onclick="deleteSchedule('${s.id}')" style="background: none; border: none;">Delete</button>
            </div>
        </div>
    `).join('');
}

async function handleCreateSchedule(e, type) {
    e.preventDefault();
    let jid, message, time;

    if (type === 'once') {
        jid = document.getElementById('onceDest').value.trim();
        message = document.getElementById('onceMsg').value.trim();
        time = document.getElementById('onceDateTime').value;
    } else {
        jid = document.getElementById('dailyDest').value.trim();
        message = document.getElementById('dailyMsg').value.trim();
        const start = document.getElementById('dailyStartDate').value;
        const end = document.getElementById('dailyEndDate').value;
        const dTime = document.getElementById('dailyTime').value;
        time = `${dTime} (${start} to ${end})`;
    }

    try {
        const res = await fetch(apiUrl('/api/schedules'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ jid, message, time, type })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✓ Automation schedule created!');
            e.target.reset();
            loadSchedules();
        } else {
            alert(data.error || 'Failed to create schedule');
        }
    } catch (err) {
        alert('Schedule creation error: ' + err.message);
    }
}

async function deleteSchedule(id) {
    if (!confirm('Delete this scheduled automation?')) return;
    try {
        await fetch(apiUrl(`/api/schedules/${id}`), {
            method: 'DELETE',
            headers: authHeaders()
        });
        showToast('✓ Schedule deleted');
        loadSchedules();
    } catch {}
}

// ----------------------------------------------------
// Panel Security & Password Update (Tab 03)
// ----------------------------------------------------
async function handlePasswordChange(e) {
    e.preventDefault();
    const currentPass = document.getElementById('currentPass').value;
    const newPass = document.getElementById('newPass').value;

    try {
        const res = await fetch(apiUrl('/api/auth/change-password'), {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify({ currentPassword: currentPass, newPassword: newPass })
        });
        const json = await res.json();
        if (json.success) {
            showToast('✓ Password updated successfully!');
            e.target.reset();
        } else {
            alert(json.error || 'Failed to change password');
        }
    } catch (err) {
        alert('Password update error: ' + err.message);
    }
}

// ----------------------------------------------------
// Bot Controls & Cloudflare Sync (Tab 03)
// ----------------------------------------------------
async function restartBot() {
    if (!confirm('Restart WhatsApp bot socket connection?')) return;
    try {
        const res = await fetch(apiUrl('/api/bot/restart'), {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();
        showToast(data.message || 'Bot restart initiated');
    } catch (err) {
        alert('Restart failed: ' + err.message);
    }
}

async function disconnectBot() {
    if (!confirm('WARNING: Disconnecting will close the active WhatsApp socket session. Proceed?')) return;
    try {
        const res = await fetch(apiUrl('/api/disconnect'), {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();
        showToast(data.message || 'Bot session disconnected');
        setTimeout(() => loadStatus(), 1500);
    } catch (err) {
        alert('Disconnect failed: ' + err.message);
    }
}

async function syncCloudflare(action) {
    try {
        const endpoint = action === 'pull' ? '/api/sync/pull' : '/api/sync/push';
        const res = await fetch(apiUrl(endpoint), {
            method: 'POST',
            headers: authHeaders()
        });
        const data = await res.json();
        showToast(`Cloudflare D1: ${data.success ? 'Sync complete' : (data.error || 'Done')}`);
        if (action === 'pull') loadSettings();
    } catch (err) {
        alert('Sync error: ' + err.message);
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

document.addEventListener('DOMContentLoaded', () => {
    checkAuth();
    initTabScrollSpy();
    setInterval(loadStatus, 3000);
});
