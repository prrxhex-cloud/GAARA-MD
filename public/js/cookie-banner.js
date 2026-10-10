/**
 * GAARA X MD - Persistent Universal Cookie Consent Banner
 * Ensures compliance and minimal essential session storage transparency.
 */
(function() {
    function initCookieBanner() {
        const consent = localStorage.getItem('gxm_cookie_consent');
        let banner = document.getElementById('cookieConsentBanner');

        if (consent === 'true') {
            if (banner) banner.style.display = 'none';
            return;
        }

        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'cookieConsentBanner';
            banner.className = 'cookie-banner';
            banner.innerHTML = `
                <p class="cookie-text">
                    We use minimal cookies and local storage essential for dashboard authentication and security preferences.
                </p>
                <div class="cookie-actions">
                    <a href="/cookies" class="btn-cookie-link">Learn more</a>
                    <button type="button" class="btn-cookie-accept" onclick="acceptCookieConsent()">Accept</button>
                </div>
            `;
            document.body.appendChild(banner);
        } else {
            banner.style.display = 'flex';
        }
    }

    window.acceptCookieConsent = function() {
        try {
            localStorage.setItem('gxm_cookie_consent', 'true');
        } catch {}
        const banner = document.getElementById('cookieConsentBanner');
        if (banner) {
            banner.style.opacity = '0';
            banner.style.transform = 'translate(-50%, 20px)';
            banner.style.transition = 'opacity 0.2s, transform 0.2s';
            setTimeout(() => { banner.style.display = 'none'; }, 220);
        }
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCookieBanner);
    } else {
        initCookieBanner();
    }
})();
