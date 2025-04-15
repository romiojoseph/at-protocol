// --- START OF FILE utils.js ---

// js/utils.js
import { LOADING_OVERLAY_ID, LOADING_TEXT_ID } from './config.js';

/**
 * Formats an ISO date string (or Date object) into a custom, readable format.
 */
export function formatISODateToCustomString(isoDateInput) {
    if (!isoDateInput) return 'N/A';
    try {
        const date = typeof isoDateInput === 'string' ? new Date(isoDateInput) : isoDateInput;
        if (!(date instanceof Date) || isNaN(date.getTime())) return 'Invalid Date';
        const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
        const day = String(date.getDate()).padStart(2, '0');
        const month = months[date.getMonth()];
        const year = date.getFullYear();
        let hour = date.getHours(); const minute = String(date.getMinutes()).padStart(2, '0');
        const ampm = hour >= 12 ? 'PM' : 'AM'; hour = hour % 12; hour = hour ? hour : 12;
        const hourStr = String(hour).padStart(2, '0');
        return `${day} ${month} ${year}, ${hourStr}:${minute} ${ampm}`;
    } catch (e) { console.error("Date formatting error:", e); return 'Date Error'; }
}

/**
 * Basic HTML sanitization using textContent.
 * NOTE: Very basic. Not sufficient for untrusted HTML input.
 */
export function sanitize(str) {
    if (str === null || typeof str === 'undefined') return '';
    const temp = document.createElement('div');
    temp.textContent = String(str); return temp.innerHTML;
}

/**
 * Updates the document title and meta description.
 */
export function updateMeta(title, description) {
    try {
        document.title = sanitize(title);
        let metaDesc = document.querySelector('meta[name="description"]');
        if (!metaDesc) {
            metaDesc = document.createElement('meta'); metaDesc.setAttribute('name', 'description');
            document.head.appendChild(metaDesc);
        }
        metaDesc.setAttribute('content', sanitize(description));
    } catch (e) { console.error("Error updating meta tags:", e); }
}

/** Helper function to set or update a specific meta tag */
function setMetaTag(attrName, content, useProperty = false) {
    try {
        const selector = useProperty ? `meta[property="${attrName}"]` : `meta[name="${attrName}"]`;
        let metaTag = document.querySelector(selector);
        if (!metaTag) {
            metaTag = document.createElement('meta');
            if (useProperty) metaTag.setAttribute('property', attrName); else metaTag.setAttribute('name', attrName);
            document.head.prepend(metaTag);
        }
        metaTag.setAttribute('content', content);
    } catch (e) { console.error("Error setting meta tag:", attrName, e); }
}

/** Helper function to remove a specific meta tag */
function removeMetaTag(attrName, useProperty = false) {
    try {
        const selector = useProperty ? `meta[property="${attrName}"]` : `meta[name="${attrName}"]`;
        const metaTag = document.querySelector(selector); if (metaTag) metaTag.remove();
    } catch (e) { console.error("Error removing meta tag:", attrName, e); }
}

/**
 * Updates Open Graph (OG) meta tags.
 */
export function updateOgMeta(title, type = 'website', description, imageUrl) {
    try {
        const safeTitle = sanitize(title);
        const safeDescription = sanitize(description);
        const metas = {
            'og:title': safeTitle, 'og:type': type, 'og:description': safeDescription,
            'og:url': window.location.href, 'og:site_name': "AT Pages: Search and read long-form posts on ATProto",
        };
        if (imageUrl) {
            const safeImageUrl = sanitize(imageUrl);
            // Ensure URL is absolute for OG tags
            try {
                const absoluteImageUrl = new URL(safeImageUrl, window.location.origin).href;
                metas['og:image'] = absoluteImageUrl;
                if (absoluteImageUrl.startsWith('https://')) { metas['og:image:secure_url'] = absoluteImageUrl; }
            } catch (urlError) {
                console.error("Error creating absolute image URL for OG tag:", urlError);
                removeMetaTag('og:image', true); removeMetaTag('og:image:secure_url', true);
            }
        } else { removeMetaTag('og:image', true); removeMetaTag('og:image:secure_url', true); }
        for (const [key, content] of Object.entries(metas)) { setMetaTag(key, content, true); }
    } catch (e) { console.error("Error updating OG meta tags:", e); }
}

/**
 * Shows or hides the full-screen loading overlay.
 */
export function showLoaderOverlay(show = true, text = 'Loading...') {
    const overlay = document.getElementById(LOADING_OVERLAY_ID);
    const loadingText = document.getElementById(LOADING_TEXT_ID);
    if (overlay) {
        try {
            if (loadingText) { loadingText.textContent = sanitize(text); }
            if (show) {
                overlay.style.display = 'flex';
                requestAnimationFrame(() => { requestAnimationFrame(() => { overlay.classList.add('visible'); }); });
            } else {
                overlay.classList.remove('visible');
                // Use event listener with fallback timeout for hiding
                const hideCompletely = () => {
                    if (!overlay.classList.contains('visible')) {
                        overlay.style.display = 'none';
                    }
                    overlay.removeEventListener('transitionend', hideCompletely);
                };
                overlay.addEventListener('transitionend', hideCompletely);
                setTimeout(hideCompletely, 350); // Fallback timer
            }
        } catch (e) { console.error("Error updating loader overlay:", e); overlay.style.display = show ? 'flex' : 'none'; overlay.style.opacity = show ? '1' : '0'; }
    } else { console.warn(`Loading overlay element with ID '${LOADING_OVERLAY_ID}' not found.`); }
}


/**
 * Attempts to trigger the rendering of Bluesky embeds by dynamically re-adding the script.
 */
export function triggerBlueskyEmbeds() {
    // Delay slightly to allow DOM updates
    setTimeout(() => {
        try {
            const scriptSrc = 'https://embed.bsky.app/static/embed.js';
            // Remove any existing instances first
            document.querySelectorAll(`script[src="${scriptSrc}"]`).forEach(s => s.remove());

            // Create and append the new script
            const script = document.createElement('script');
            script.src = scriptSrc;
            script.async = true;
            script.charset = 'utf-8';
            script.id = `bluesky-embed-trigger-${Date.now()}`;
            document.body.appendChild(script);

            // Optional: Clean up the trigger script itself after a delay
            script.onload = () => { setTimeout(() => { script.remove(); }, 2000); };
            script.onerror = () => { console.error(`Failed to load dynamically added script: ${script.id}`); script.remove(); }
        } catch (error) { console.error("Error trying to trigger Bluesky embeds:", error); }
    }, 100);
}

/**
 * Basic validation for a Bluesky handle string.
 */
export function isValidHandle(handle) {
    if (typeof handle !== 'string' || handle.length < 3 || handle.length > 256) {
        return false;
    }
    if (!/^[a-zA-Z0-9.-]+$/.test(handle)) {
        return false;
    }
    if (handle.includes('..') || handle.startsWith('.') || handle.endsWith('.') || handle.startsWith('-') || handle.endsWith('-')) {
        return false;
    }
    if (!handle.includes('.')) {
        return false;
    }
    const parts = handle.split('.');
    if (parts[parts.length - 1].length < 2) {
        return false;
    }
    return true;
}

/**
 * Basic validation for a DID string.
 */
export function isValidDID(did) {
    return typeof did === 'string' && /^did:(plc:|web:)[a-zA-Z0-9._:%-]*[a-zA-Z0-9]$/.test(did);
}

// --- END OF FILE utils.js ---