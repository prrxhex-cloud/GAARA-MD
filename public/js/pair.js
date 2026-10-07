let pollTimer = null;
const apiBaseUrl = localStorage.getItem('api_base_url') || '';

function apiUrl(endpoint) {
    if (!apiBaseUrl) return endpoint;
    const base = apiBaseUrl.replace(/\/+$/, '');
    return `${base}${endpoint}`;
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

    try {
        const res = await fetch(apiUrl('/api/pair'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone })
        });
        const data = await res.json();

        if (data.success && data.code) {
            displayCode(data.code);
            showToast('✅ Pairing code generated! Enter it on WhatsApp.');
            startStatusPolling();
        } else {
            showToast(data.error || 'Failed to request pairing code', true);
        }
    } catch (err) {
        showToast('Request error. Please check server logs.', true);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = '⚡ GET PAIRING CODE';
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
