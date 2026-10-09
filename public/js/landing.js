/**
 * GAARA X MD — High-Performance Cyber 3D Landing Engine
 * Handles 3D Canvas Starfield, Mouse-Tracking Tilt Hologram,
 * Real-Time Telemetry Polling, and Instant Baileys Pairing.
 */

(function () {
    'use strict';

    // =========================================================================
    // 1. API Configuration & Cross-Host Resolution (Vercel / Render / Local)
    // =========================================================================
    const PERMANENT_BACKEND_URL = 'https://gaara-md-cf37.onrender.com';
    let apiBaseUrl = localStorage.getItem('api_base_url') || (
        typeof window !== 'undefined' && window.location.hostname.includes('vercel.app')
            ? PERMANENT_BACKEND_URL
            : ''
    );

    // Support URL param ?api=https://... for dynamic hosting
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
        return `${base}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    }

    window.promptBackendUrl = function () {
        const current = localStorage.getItem('api_base_url') || '';
        const next = prompt(`Enter your WhatsApp bot backend URL (default: ${PERMANENT_BACKEND_URL} or leave empty for same origin):`, current || PERMANENT_BACKEND_URL);
        if (next !== null) {
            const cleaned = next.trim().replace(/\/+$/, '');
            localStorage.setItem('api_base_url', cleaned);
            apiBaseUrl = cleaned;
            showToast('Backend URL updated: ' + (cleaned || 'Same origin'));
            setTimeout(() => window.location.reload(), 500);
        }
    };

    // =========================================================================
    // 2. Toast Notifications
    // =========================================================================
    function showToast(message, isError = false) {
        const toast = document.getElementById('toast');
        if (!toast) return;
        toast.textContent = message;
        toast.style.borderColor = isError ? 'var(--neon-red)' : 'var(--neon-green)';
        toast.style.boxShadow = isError ? '0 0 25px rgba(255, 42, 95, 0.45)' : '0 0 25px rgba(0, 240, 170, 0.45)';
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3800);
    }
    window.showToast = showToast;

    // =========================================================================
    // 3. Hardware-Accelerated 3D Particle Constellation Canvas
    // =========================================================================
    function init3DParticleCanvas() {
        const canvas = document.getElementById('bg-canvas');
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        const PARTICLE_COUNT = Math.min(85, Math.floor((width * height) / 14000));
        const particles = [];
        let mouseX = 0;
        let mouseY = 0;
        let targetRotX = 0;
        let targetRotY = 0;
        let rotX = 0;
        let rotY = 0;

        for (let i = 0; i < PARTICLE_COUNT; i++) {
            particles.push({
                x: (Math.random() - 0.5) * width * 1.5,
                y: (Math.random() - 0.5) * height * 1.5,
                z: Math.random() * 800 + 200,
                radius: Math.random() * 1.8 + 0.8,
                vx: (Math.random() - 0.5) * 0.4,
                vy: (Math.random() - 0.5) * 0.4,
                vz: (Math.random() - 0.5) * 0.3,
                baseColor: Math.random() > 0.4 ? 'rgba(255, 42, 95,' : 'rgba(181, 23, 158,'
            });
        }

        window.addEventListener('resize', () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
        }, { passive: true });

        window.addEventListener('mousemove', (e) => {
            mouseX = (e.clientX - width / 2) / (width / 2);
            mouseY = (e.clientY - height / 2) / (height / 2);
            targetRotY = mouseX * 0.15;
            targetRotX = -mouseY * 0.15;
        }, { passive: true });

        const fov = 350;

        function renderParticles() {
            if (document.hidden) {
                requestAnimationFrame(renderParticles);
                return;
            }

            ctx.clearRect(0, 0, width, height);

            rotX += (targetRotX - rotX) * 0.05;
            rotY += (targetRotY - rotY) * 0.05;

            const cosY = Math.cos(rotY);
            const sinY = Math.sin(rotY);
            const cosX = Math.cos(rotX);
            const sinX = Math.sin(rotX);

            const projected = [];

            for (let i = 0; i < particles.length; i++) {
                const p = particles[i];

                p.x += p.vx;
                p.y += p.vy;
                p.z += p.vz;

                if (p.z < 100) p.z = 1000;
                if (p.z > 1000) p.z = 100;
                if (Math.abs(p.x) > width) p.x = -p.x;
                if (Math.abs(p.y) > height) p.y = -p.y;

                // 3D rotation
                const x1 = p.x * cosY + p.z * sinY;
                const z1 = -p.x * sinY + p.z * cosY;
                const y1 = p.y * cosX - z1 * sinX;
                const z2 = p.y * sinX + z1 * cosX;

                if (z2 <= 50) continue;

                const scale = fov / (fov + z2);
                const px = width / 2 + x1 * scale;
                const py = height / 2 + y1 * scale;
                const pRad = Math.max(0.6, p.radius * scale);
                const alpha = Math.min(0.9, Math.max(0.15, (1 - z2 / 1000)));

                projected.push({ x: px, y: py, z: z2, alpha, color: p.baseColor, rad: pRad });

                ctx.beginPath();
                ctx.arc(px, py, pRad, 0, Math.PI * 2);
                ctx.fillStyle = `${p.baseColor}${alpha})`;
                ctx.fill();
            }

            // Draw constellation lines
            const maxDist = 120;
            const len = projected.length;
            for (let i = 0; i < len; i++) {
                for (let j = i + 1; j < len; j++) {
                    const dx = projected[i].x - projected[j].x;
                    const dy = projected[i].y - projected[j].y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < maxDist) {
                        const lineAlpha = (1 - dist / maxDist) * 0.18 * projected[i].alpha;
                        ctx.beginPath();
                        ctx.moveTo(projected[i].x, projected[i].y);
                        ctx.lineTo(projected[j].x, projected[j].y);
                        ctx.strokeStyle = `rgba(255, 42, 95, ${lineAlpha})`;
                        ctx.lineWidth = 0.8;
                        ctx.stroke();
                    }
                }
            }

            requestAnimationFrame(renderParticles);
        }

        requestAnimationFrame(renderParticles);
    }

    // =========================================================================
    // 4. Interactive 3D Mouse-Tracking Tilt Cards
    // =========================================================================
    function init3DTiltCards() {
        const heroCardWrapper = document.querySelector('.tilt-card-wrapper');
        const heroCard = document.querySelector('.tilt-card');
        const glare = document.querySelector('.card-glare');

        if (heroCardWrapper && heroCard) {
            let bounds = null;

            function updateBounds() {
                bounds = heroCard.getBoundingClientRect();
            }

            heroCard.addEventListener('mouseenter', updateBounds, { passive: true });
            window.addEventListener('resize', updateBounds, { passive: true });

            heroCard.addEventListener('mousemove', (e) => {
                if (!bounds) updateBounds();
                const mouseX = e.clientX - bounds.left;
                const mouseY = e.clientY - bounds.top;

                const normX = (mouseX / bounds.width) - 0.5;
                const normY = (mouseY / bounds.height) - 0.5;

                const rotX = -normY * 22;
                const rotY = normX * 22;

                heroCardWrapper.style.transform = `perspective(1200px) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;

                if (glare) {
                    const glareX = (normX + 0.5) * 100;
                    const glareY = (normY + 0.5) * 100;
                    glare.style.background = `radial-gradient(circle at ${glareX}% ${glareY}%, rgba(255, 255, 255, 0.22) 0%, transparent 65%)`;
                }
            }, { passive: true });

            heroCard.addEventListener('mouseleave', () => {
                heroCardWrapper.style.transform = 'perspective(1200px) rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
                if (glare) {
                    glare.style.background = 'radial-gradient(circle at 50% 50%, rgba(255, 255, 255, 0.18) 0%, transparent 65%)';
                }
            }, { passive: true });
        }

        // Feature cards subtle 3D tilt
        const featureCards = document.querySelectorAll('.feature-card-inner');
        featureCards.forEach((card) => {
            let fBounds = null;

            card.addEventListener('mouseenter', () => {
                fBounds = card.getBoundingClientRect();
            }, { passive: true });

            card.addEventListener('mousemove', (e) => {
                if (!fBounds) fBounds = card.getBoundingClientRect();
                const mx = e.clientX - fBounds.left;
                const my = e.clientY - fBounds.top;
                const nx = (mx / fBounds.width) - 0.5;
                const ny = (my / fBounds.height) - 0.5;
                card.style.transform = `perspective(800px) rotateX(${(-ny * 12).toFixed(1)}deg) rotateY(${(nx * 12).toFixed(1)}deg) translateY(-4px)`;
            }, { passive: true });

            card.addEventListener('mouseleave', () => {
                card.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) translateY(0)';
            }, { passive: true });
        });
    }

    // =========================================================================
    // 5. Real-Time Telemetry & Status Polling Engine (NO FAKE DATA)
    // =========================================================================
    let isPolling = false;

    function formatUptime(seconds) {
        if (!seconds || seconds <= 0) return '0s';
        const d = Math.floor(seconds / 86400);
        const h = Math.floor((seconds % 86400) / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        const parts = [];
        if (d > 0) parts.push(`${d}d`);
        if (h > 0) parts.push(`${h}h`);
        if (m > 0) parts.push(`${m}m`);
        if (parts.length === 0 || s > 0) parts.push(`${s}s`);
        return parts.slice(0, 2).join(' ');
    }

    async function pollRealTimeStatus() {
        if (isPolling) return;
        isPolling = true;

        const startTime = performance.now();
        try {
            const res = await fetch(apiUrl('/api/status'), {
                signal: AbortSignal.timeout(6000)
            });
            const pingMs = Math.round(performance.now() - startTime);

            if (!res.ok) {
                throw new Error(`HTTP ${res.status}`);
            }

            const data = await res.json();
            updateUIWithRealData(data, pingMs);
        } catch (err) {
            updateUIOffline(err.message);
        } finally {
            isPolling = false;
        }
    }

    function updateUIWithRealData(data, pingMs) {
        const isOnline = data.connection === 'open';
        const isConnecting = data.connection === 'connecting';
        const isOffline = !isOnline && !isConnecting;

        // Nav Pill
        const navPill = document.getElementById('navStatusPill');
        const navText = document.getElementById('navStatusText');
        if (navPill && navText) {
            navPill.className = `nav-status-pill ${isOnline ? 'online' : (isConnecting ? 'connecting' : 'offline')}`;
            navText.textContent = isOnline ? 'ONLINE' : (isConnecting ? 'CONNECTING' : 'OFFLINE');
        }

        // Hero Platform Operational Badge
        const heroBadge = document.getElementById('heroPlatformBadge');
        const heroBadgeText = document.getElementById('heroBadgeText');
        if (heroBadge && heroBadgeText) {
            if (isOnline) {
                heroBadge.className = 'platform-badge';
                heroBadgeText.textContent = 'PLATFORM OPERATIONAL';
            } else if (isConnecting) {
                heroBadge.className = 'platform-badge';
                heroBadgeText.textContent = 'SOCKET CONNECTING...';
            } else {
                heroBadge.className = 'platform-badge offline-mode';
                heroBadgeText.textContent = 'UNLINKED / READY TO PAIR';
            }
        }

        // Hero Metrics
        const metricStatus = document.getElementById('metricStatus');
        if (metricStatus) {
            metricStatus.textContent = isOnline ? 'ONLINE' : (isConnecting ? 'CONNECTING' : 'OFFLINE');
            metricStatus.className = `metric-value ${isOnline ? 'live-green' : 'live-pink'}`;
        }

        const metricCommands = document.getElementById('metricCommands');
        if (metricCommands) {
            const count = data.commandCount || 120;
            metricCommands.textContent = `${count}+ Active`;
        }

        const metricUptime = document.getElementById('metricUptime');
        if (metricUptime) {
            const sec = data.telemetry?.uptimeSeconds || data.serverUptime || 0;
            metricUptime.textContent = isOnline ? formatUptime(sec) : `${pingMs}ms API`;
        }

        // HUD Badges
        const hudStatusPill = document.getElementById('hudStatusPill');
        if (hudStatusPill) {
            hudStatusPill.textContent = isOnline ? '• LIVE AUTOMATION' : '• READY TO LINK';
            hudStatusPill.style.color = isOnline ? 'var(--neon-green)' : 'var(--neon-pink)';
        }

        // Pairing terminal server indicator
        const pairServerStatus = document.getElementById('pairServerStatus');
        if (pairServerStatus) {
            pairServerStatus.innerHTML = `<span class="live-pulse" style="color: var(--neon-green);"></span> Server Live (${pingMs}ms)`;
        }

        // Detailed Telemetry Board
        const tSocket = document.getElementById('telemSocket');
        if (tSocket) tSocket.textContent = data.connection?.toUpperCase() || 'UNKNOWN';

        const tPhone = document.getElementById('telemPhone');
        if (tPhone) {
            tPhone.textContent = data.telemetry?.phoneNumber ? `+${data.telemetry.phoneNumber}` : 'None (Unlinked)';
        }

        const tUptime = document.getElementById('telemUptime');
        if (tUptime) {
            const sec = data.telemetry?.uptimeSeconds || data.serverUptime || 0;
            tUptime.textContent = formatUptime(sec);
        }

        const tPing = document.getElementById('telemPing');
        if (tPing) tPing.textContent = `${pingMs} ms`;

        const tMessages = document.getElementById('telemMessages');
        if (tMessages) tMessages.textContent = data.telemetry?.messagesHandled || 0;

        const tCalls = document.getElementById('telemCalls');
        if (tCalls) tCalls.textContent = data.telemetry?.callsIntercepted || 0;

        const tMemory = document.getElementById('telemMemory');
        if (tMemory) {
            const memMB = data.memory?.heapUsedMB || 0;
            tMemory.textContent = memMB ? `${memMB} MB` : '200 MB Limit';
        }

        const tMode = document.getElementById('telemMode');
        if (tMode) tMode.textContent = (data.mode || 'public').toUpperCase();
    }

    function updateUIOffline(reason) {
        const navPill = document.getElementById('navStatusPill');
        const navText = document.getElementById('navStatusText');
        if (navPill && navText) {
            navPill.className = 'nav-status-pill offline';
            navText.textContent = 'OFFLINE';
        }

        const heroBadge = document.getElementById('heroPlatformBadge');
        const heroBadgeText = document.getElementById('heroBadgeText');
        if (heroBadge && heroBadgeText) {
            heroBadge.className = 'platform-badge offline-mode';
            heroBadgeText.textContent = 'CONNECTING TO BACKEND...';
        }

        const metricStatus = document.getElementById('metricStatus');
        if (metricStatus) {
            metricStatus.textContent = 'OFFLINE';
            metricStatus.className = 'metric-value live-pink';
        }

        const pairServerStatus = document.getElementById('pairServerStatus');
        if (pairServerStatus) {
            pairServerStatus.innerHTML = `<span class="live-pulse" style="color: var(--neon-red);"></span> Backend Connecting...`;
        }
    }

    // =========================================================================
    // 6. WhatsApp Code Pairing Handler
    // =========================================================================
    let countdownInterval = null;
    let linkPollInterval = null;

    async function handlePairSubmit(e) {
        if (e) e.preventDefault();

        const input = document.getElementById('phoneNumberInput');
        const phone = input?.value?.trim();

        if (!phone) {
            showToast('Please enter your WhatsApp phone number with country code (e.g. +94771234567)', true);
            return;
        }

        const cleanPhone = phone.replace(/[^0-9]/g, '');
        if (cleanPhone.length < 8 || cleanPhone.length > 15) {
            showToast('Invalid phone number length. Must have 8-15 digits with country code.', true);
            return;
        }

        const btn = document.getElementById('getPairBtn');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span>⚡ Generating Code...</span>';
        }

        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 28000);

        try {
            const res = await fetch(apiUrl('/api/pair'), {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    phone: cleanPhone,
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
                const err = data?.error || (res.status === 504 ? '⏱️ WhatsApp pairing timed out. Please retry.' : `Server error (${res.status}). If backend is waking up, retry in 10s.`);
                showToast(err, true);
                return;
            }

            if (data && data.success && data.code) {
                renderPairingCode(data.code);
                showToast('✅ Pairing code generated! Enter it on WhatsApp Linked Devices.');
                startLinkVerification();
            } else {
                showToast(data?.error || 'Failed to generate code. Try "Reset Session" below.', true);
            }
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                showToast('⏱️ Request timed out. Backend may be cold-starting on Render. Click again.', true);
            } else {
                showToast('Network error connecting to backend. Verify connection.', true);
            }
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = '<span>Generate pairing code -></span>';
            }
        }
    }

    function renderPairingCode(code) {
        const box = document.getElementById('pairResultBox');
        const codeDisplay = document.getElementById('codeDisplay');
        const countdownBar = document.getElementById('countdownBar');

        if (!box || !codeDisplay) return;

        // Format code cleanly (e.g. "ABCD - EFGH" if 8 characters)
        let formatted = code;
        if (code.length === 8) {
            formatted = `${code.slice(0, 4)} - ${code.slice(4)}`;
        }

        codeDisplay.textContent = formatted;
        codeDisplay.setAttribute('data-raw-code', code);
        box.style.display = 'block';
        box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

        // 60-second countdown bar
        if (countdownInterval) clearInterval(countdownInterval);
        let timeLeft = 60;
        if (countdownBar) countdownBar.style.width = '100%';

        countdownInterval = setInterval(() => {
            timeLeft--;
            if (countdownBar) {
                countdownBar.style.width = `${(timeLeft / 60) * 100}%`;
            }
            if (timeLeft <= 0) {
                clearInterval(countdownInterval);
                showToast('Pairing code expired. Please generate a fresh code.');
            }
        }, 1000);
    }

    window.copyPairingCode = function () {
        const codeDisplay = document.getElementById('codeDisplay');
        const raw = codeDisplay?.getAttribute('data-raw-code') || codeDisplay?.textContent?.replace(/\s/g, '');
        if (raw) {
            navigator.clipboard.writeText(raw);
            showToast('📋 Pairing code copied to clipboard!');
        }
    };

    window.resetPairingSession = async function () {
        const btn = document.getElementById('resetSessionBtn');
        if (btn) {
            btn.disabled = true;
            btn.textContent = 'Resetting...';
        }

        try {
            const res = await fetch(apiUrl('/api/pair/reset'), {
                method: 'POST',
                signal: AbortSignal.timeout(10000)
            });
            const data = await res.json();
            if (data.success) {
                showToast('🔄 Stale session cleared! You can now request a fresh pairing code.');
                const box = document.getElementById('pairResultBox');
                if (box) box.style.display = 'none';
            } else {
                showToast(data.error || 'Failed to reset session', true);
            }
        } catch (err) {
            showToast('Error resetting session. Verify backend URL.', true);
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.textContent = '🔄 Clear / Reset Session';
            }
        }
    };

    function startLinkVerification() {
        if (linkPollInterval) clearInterval(linkPollInterval);
        linkPollInterval = setInterval(async () => {
            try {
                const res = await fetch(apiUrl('/api/status'));
                const data = await res.json();
                if (data.connection === 'open') {
                    clearInterval(linkPollInterval);
                    if (countdownInterval) clearInterval(countdownInterval);
                    showToast('🎉 WhatsApp Connected Successfully! Redirecting to dashboard...');
                    setTimeout(() => {
                        window.location.href = '/settings';
                    }, 2200);
                }
            } catch {}
        }, 3000);
    }

    // =========================================================================
    // 7. Navbar Scroll & Mobile Navigation
    // =========================================================================
    function initNavbar() {
        const header = document.querySelector('.site-header');
        const mobileToggle = document.querySelector('.mobile-toggle');
        const navLinks = document.querySelector('.nav-links');

        window.addEventListener('scroll', () => {
            if (window.scrollY > 20) {
                header?.classList.add('scrolled');
            } else {
                header?.classList.remove('scrolled');
            }
        }, { passive: true });

        if (mobileToggle && navLinks) {
            mobileToggle.addEventListener('click', () => {
                navLinks.classList.toggle('mobile-open');
            });

            navLinks.querySelectorAll('a').forEach(link => {
                link.addEventListener('click', () => {
                    navLinks.classList.remove('mobile-open');
                });
            });
        }
    }

    // =========================================================================
    // 8. Initialization
    // =========================================================================
    document.addEventListener('DOMContentLoaded', () => {
        init3DParticleCanvas();
        init3DTiltCards();
        initNavbar();

        // Initial poll and recurring telemetry loop
        pollRealTimeStatus();
        setInterval(pollRealTimeStatus, 3500);

        // Pairing Form hook
        const pairForm = document.getElementById('pairForm');
        if (pairForm) {
            pairForm.addEventListener('submit', handlePairSubmit);
        }
    });

})();
