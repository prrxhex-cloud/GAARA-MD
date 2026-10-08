/**
 * GAARA X MD - Security Utility Module
 * Provides ReDoS protection, prototype pollution defense, and input sanitization.
 */

/**
 * Checks whether a regular expression string is safe to execute without ReDoS risk.
 * Catches catastrophic backtracking, nested quantifiers, overlapping repetitions, and invalid regexes.
 *
 * @param {string} pattern - Raw regex string to validate
 * @returns {{ safe: boolean, reason?: string }}
 */
export function isSafeRegex(pattern) {
    if (!pattern || typeof pattern !== 'string') {
        return { safe: false, reason: 'Empty pattern' };
    }

    // 1. Length constraint: Reject overly complex patterns
    if (pattern.length > 150) {
        return { safe: false, reason: 'Pattern exceeds maximum safe length of 150 characters' };
    }

    // 2. Syntax validation
    try {
        new RegExp(pattern);
    } catch (syntaxErr) {
        return { safe: false, reason: `Invalid regex syntax: ${syntaxErr.message}` };
    }

    // 3. Catastrophic backtracking detection:
    // a. Nested quantifiers: e.g. (a+)+, (a*)*, (x+)*, (.*)*, ([a-z]+)+, (\d+)+
    const nestedQuantifierRegex = /\([^)]*(\+|\*|\{[0-9]+,?[0-9]*\})\)[*+?]|\([^)]*(\+|\*)\)\{[0-9]+,?[0-9]*\}/;
    if (nestedQuantifierRegex.test(pattern)) {
        return { safe: false, reason: 'Detected dangerous nested quantifier (catastrophic backtracking risk)' };
    }

    // b. Overlapping alternations inside repeated group: e.g. (a|a)+, (.*|a)+
    const overlappingRepeatedAlternation = /\(([^|()]+)\|([^|()]+)\)[*+]/;
    const altMatch = pattern.match(overlappingRepeatedAlternation);
    if (altMatch && altMatch[1] && altMatch[2]) {
        const left = altMatch[1].trim();
        const right = altMatch[2].trim();
        if (left === right || left.startsWith(right) || right.startsWith(left)) {
            return { safe: false, reason: 'Detected overlapping alternation in repeated group' };
        }
    }

    // c. Unbounded wildcards inside quantified group: e.g. (.*a)+, (.+)+
    if (/\(\.[*+][^)]*\)[*+]/.test(pattern)) {
        return { safe: false, reason: 'Detected repeated wildcard group (ReDoS risk)' };
    }

    return { safe: true };
}

/**
 * Deeply sanitizes an object by recursively stripping reserved prototype properties
 * (__proto__, constructor, prototype) to prevent Prototype Pollution attacks.
 *
 * @param {*} obj - Object or value to sanitize
 * @returns {*} Sanitized object copy
 */
export function sanitizeObject(obj) {
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return obj;
    }

    const safe = Object.create(null);
    for (const [key, value] of Object.entries(obj)) {
        // Drop dangerous prototype pollution keys
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            continue;
        }

        if (value && typeof value === 'object' && !Array.isArray(value)) {
            safe[key] = sanitizeObject(value);
        } else if (Array.isArray(value)) {
            safe[key] = value.map(item => (item && typeof item === 'object' ? sanitizeObject(item) : item));
        } else {
            safe[key] = value;
        }
    }

    return { ...safe };
}

/**
 * Sanitizes a filename to protect against Path Traversal and illegal character injections.
 *
 * @param {string} filename - Untrusted filename
 * @param {string} fallback - Fallback filename if input is invalid
 * @returns {string} Safe filename
 */
export function sanitizeFilename(filename, fallback = 'file') {
    if (!filename || typeof filename !== 'string') return fallback;

    // Strip directory traversal sequences and illegal path characters
    let clean = filename
        .replace(/\0/g, '') // Null bytes
        .replace(/[/\\?%*:|"<>]/g, '_') // Windows/Unix path separators & reserved chars
        .replace(/\.\.+/g, '_') // Directory traversal dots
        .trim();

    if (!clean) return fallback;
    return clean.slice(0, 120);
}

/**
 * Masks sensitive credential strings so they are safe to display in APIs and logs.
 *
 * @param {string} str - Raw secret string
 * @returns {string} Masked string e.g. '••••••••••••••••••••••••••••••••••••••••••••'
 */
export function maskSecret(str) {
    if (!str || typeof str !== 'string') return '';
    return '••••••••••••••••••••••••••••••••••••••••••••';
}

export default {
    isSafeRegex,
    sanitizeObject,
    sanitizeFilename,
    maskSecret
};
