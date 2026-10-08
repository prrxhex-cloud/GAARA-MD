const PERMANENT_BACKEND_URL = 'https://gaara-md-cf37.onrender.com';
let apiBaseUrl = localStorage.getItem('api_base_url') || (
    typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
        ? PERMANENT_BACKEND_URL
        : ''
);

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
    const next = prompt(`Enter your WhatsApp bot backend URL (default: ${PERMANENT_BACKEND_URL} or leave blank for local/same origin):`, current || PERMANENT_BACKEND_URL);
    if (next !== null) {
        const cleaned = next.trim().replace(/\/+$/, '');
        localStorage.setItem('api_base_url', cleaned);
        apiBaseUrl = cleaned;
        showToast('Backend URL updated: ' + (cleaned || 'Same origin'));
        updateBackendDisplay();
        setTimeout(() => window.location.reload(), 600);
    }
}

function updateBackendDisplay() {
    const display = document.getElementById('currentApiDisplay');
    if (display) {
        display.textContent = apiBaseUrl || '(Same origin / local)';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    updateBackendDisplay();
    checkConnectionStatus();
});

async function checkConnectionStatus() {
    try {
        const res = await fetch(apiUrl('/api/status'), { signal: AbortSignal.timeout(5000) });
        if (res.ok) {
            const data = await res.json();
            if (data.connection === 'open') {
                showToast('ℹ️ WhatsApp is already connected! Redirecting to settings...');
                setTimeout(() => {
                    window.location.href = '/settings';
                }, 2500);
            }
        }
    } catch {}
}

async function requestPairCode() {
    const input = document.getElementById('phoneNumberInput');
    const phone = input?.value?.trim();

    if (!phone) {
        showToast('Please enter your WhatsApp phone number with country code', true);
        return;
    }

    const btn = document.getElementById('getPairBtn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Generating...';
    }

    // 28-second timeout controller (accommodates Render cold-starts while avoiding indefinite hang)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 28000);

    try {
        const res = await fetch(apiUrl('/api/pair'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                phone,
                frontendUrl: window.location.origin
            }),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        let data = null;
        try {
            data = await res.json();
        } catch {
            data = null;
        }

        if (!res.ok) {
            const errorMsg = data?.error || (res.status === 504
                ? '⏱️ WhatsApp pairing timed out. Please check your phone number and retry.'
                : `Backend responded with error (${res.status}). If Render is waking up, please retry in 15s.`);
            showToast(errorMsg, true);
            return;
        }

        if (data && data.success && data.code) {
            displayCode(data.code);
            showToast('✅ Pairing code generated! Enter it on WhatsApp.');
            startStatusPolling();
        } else {
            showToast(data?.error || 'Failed to request pairing code. Click "Reset Session" below if needed.', true);
        }
    } catch (err) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
            showToast('⏱️ Request timed out. Backend may be waking up (Render cold-start). Please click again to retry.', true);
        } else {
            showToast('Request error. Verify Backend URL or server logs. You can try "Reset Session".', true);
        }
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚡ GET PAIRING CODE';
        }
    }
}

async function resetPairingSession() {
    const resetBtn = document.getElementById('resetSessionBtn');
    if (resetBtn) {
        resetBtn.disabled = true;
        resetBtn.textContent = 'Resetting...';
    }

    try {
        const res = await fetch(apiUrl('/api/pair/reset'), {
            method: 'POST',
            signal: AbortSignal.timeout(10000)
        });
        const data = await res.json();
        if (data.success) {
            showToast('🔄 Stale session cleared! You can now request a fresh pairing code.');
            const codeContainer = document.getElementById('codeResultContainer');
            if (codeContainer) codeContainer.style.display = 'none';
            const codeVal = document.getElementById('codeValue');
            if (codeVal) codeVal.textContent = '----';
        } else {
            showToast(data.error || 'Failed to reset session', true);
        }
    } catch (err) {
        showToast('Error resetting session. Check backend server URL.', true);
    } finally {
        if (resetBtn) {
            resetBtn.disabled = false;
            resetBtn.textContent = '🔄 Clear / Reset Session';
        }
    }
}

function displayCode(code) {
    const codeDisplay = document.getElementById('pairingCodeBox');
    const codeVal = document.getElementById('codeValue');
    const codeContainer = document.getElementById('codeResultContainer');

    if (codeVal) codeVal.textContent = code;
    if (codeContainer) codeContainer.style.display = 'block';
}

function copyPairingCode() {
    const codeVal = document.getElementById('codeValue')?.textContent;
    if (codeVal) {
        navigator.clipboard.writeText(codeVal);
        showToast('📋 Pairing code copied to clipboard!');
    }
}

function startStatusPolling() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = setInterval(async () => {
        try {
            const res = await fetch(apiUrl('/api/status'));
            const data = await res.json();
            if (data.connection === 'open') {
                clearInterval(pollTimer);
                showToast('🎉 WhatsApp Connected Successfully! Redirecting...');
                setTimeout(() => {
                    window.location.href = '/settings';
                }, 2000);
            }
        } catch {}
    }, 3000);
}

function showToast(message, isError = false) {
    const toast = document.getElementById('toast');
    if (!toast) return;
    toast.textContent = message;
    toast.style.borderColor = isError ? '#ff334b' : '#00f0aa';
    toast.classList.add('show');
    setTimeout(() => toast.classList.remove('show'), 3500);
}
