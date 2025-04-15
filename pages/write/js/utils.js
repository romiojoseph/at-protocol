// js/utils.js
import { AtUri } from '@atproto/api';
import { format, parse, isValid, formatISO, compareAsc, compareDesc, parseISO } from 'date-fns'; // Added compare functions, parseISO
import { CUSTOM_DATE_FORMAT, DATETIME_LOCAL_FORMAT } from './config.js'; // Added DATETIME_LOCAL_FORMAT
import { showLoading as showLoadingOverlay, hideLoading as hideLoadingOverlay } from './ui.js'; // Import overlay controls
import { getAgent } from './state.js';

// --- Date Helpers ---

export function parseCustomDateString(input) {
    if (!input) return null;
    try {
        const parsedDate = parse(input, CUSTOM_DATE_FORMAT, new Date());
        if (isValid(parsedDate)) return parsedDate;
    } catch (e) { /* ignore */ }

    try {
        const directParsed = new Date(input);
        if (isValid(directParsed)) return directParsed;
    } catch (e) { /* ignore */ }

    // console.warn(`Failed to parse date string using custom format: "${input}"`); // Keep warn
    return null;
}

export function parseDateTimeLocalString(input) {
    if (!input) return null;
    try {
        const parsedDate = parseISO(input);
        return isValid(parsedDate) ? parsedDate : null;
    } catch (e) {
        console.warn(`Failed to parse datetime-local string: "${input}"`, e); // Keep warn
        return null;
    }
}

export function formatDateToCustomString(dateInput) {
    if (!dateInput) return '';
    try {
        const dateObj = (typeof dateInput === 'string' || typeof dateInput === 'number') ? new Date(dateInput) : dateInput;
        return isValid(dateObj) ? format(dateObj, CUSTOM_DATE_FORMAT) : '';
    } catch (e) {
        console.warn("Date formatting to custom string failed:", dateInput, e); // Keep warn
        return '';
    }
}

export function formatDateToDateTimeLocalString(dateInput) {
    if (!dateInput) return '';
    try {
        const dateObj = (typeof dateInput === 'string' || typeof dateInput === 'number') ? new Date(dateInput) : dateInput;
        return isValid(dateObj) ? format(dateObj, DATETIME_LOCAL_FORMAT) : '';
    } catch (e) {
        console.warn("Date formatting to datetime-local string failed:", dateInput, e); // Keep warn
        return '';
    }
}

export function formatDateToISO(dateInput) {
    if (!dateInput) return null;
    try {
        const dateObj = (typeof dateInput === 'string' || typeof dateInput === 'number') ? new Date(dateInput) : dateInput;
        return isValid(dateObj) ? formatISO(dateObj) : null;
    } catch (e) {
        console.error("Error formatting date to ISO:", dateInput, e); // Keep error
        return null;
    }
}

// --- AT URI Helper ---
export async function convertBskyUrlToAtUri(urlInput, statusElement) {
    const updateStatus = (message, className = '') => {
        if (statusElement) {
            statusElement.textContent = message;
            statusElement.className = className;
            if (className === 'invalid' || className === 'error') {
                statusElement.closest('.form-field')?.querySelector('input')?.classList.add('invalid-input');
            } else {
                statusElement.closest('.form-field')?.querySelector('input')?.classList.remove('invalid-input');
            }
        }
        // else { console.debug(`[Comment URI Status]: ${message} (${className})`); } // Removed
    };

    updateStatus('');

    if (!urlInput || typeof urlInput !== 'string') return null;
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return null;

    if (trimmedUrl.startsWith('at://')) {
        try {
            new AtUri(trimmedUrl);
            updateStatus('Valid AT URI.', 'valid');
            return trimmedUrl;
        } catch (e) {
            console.warn(`[Convert URL] Invalid AT URI format: ${trimmedUrl}`, e); // Keep warn
            updateStatus('Invalid AT URI format.', 'invalid');
            return null;
        }
    }

    if (trimmedUrl.startsWith('https://bsky.app/profile/')) {
        try {
            const url = new URL(trimmedUrl);
            const pathParts = url.pathname.split('/').filter(Boolean);

            if (pathParts.length !== 4 || pathParts[0] !== 'profile' || pathParts[2] !== 'post') {
                throw new Error("URL path doesn't match expected /profile/{id}/post/{rkey} structure.");
            }

            let identifier = pathParts[1];
            const rkey = pathParts[3];
            let did = '';

            if (identifier.startsWith('did:')) {
                did = identifier;
                updateStatus('Resolving DID...', 'resolving');
            } else {
                updateStatus('Resolving handle...', 'resolving');
                const agent = getAgent();
                if (!agent || !agent.session) {
                    throw new Error("Agent not available for handle resolution. Cannot convert URL.");
                }

                try {
                    const resolveResult = await agent.resolveHandle({ handle: identifier });
                    if (!resolveResult.data.did) {
                        throw new Error(`Could not resolve handle "${identifier}"`);
                    }
                    did = resolveResult.data.did;
                } catch (resolveError) {
                    console.error(`[Convert URL] Failed to resolve handle "${identifier}":`, resolveError); // Keep error
                    let errorMsg = `Error resolving handle: ${identifier}`;
                    if (resolveError.message?.includes('Unable to resolve handle')) {
                        errorMsg += ' (Handle may not exist)';
                    } else if (resolveError.message) {
                        errorMsg += ` (${resolveError.message})`;
                    }
                    updateStatus(errorMsg, 'error');
                    return null;
                }
            }

            const collection = 'app.bsky.feed.post';
            const atUri = `at://${did}/${collection}/${rkey}`;

            new AtUri(atUri);
            updateStatus('Converted to valid AT URI.', 'valid');
            return atUri;

        } catch (error) {
            console.error(`[Convert URL] Failed to convert URL "${trimmedUrl}":`, error); // Keep error
            updateStatus(`Conversion failed: ${error.message || 'Unknown error'}`, 'error');
            return null;
        }
    }

    updateStatus('Invalid format. Use https://bsky.app/... or at://...', 'invalid');
    return null;
}

// --- Author Handle Validation ---
export async function validateHandleAndFetchProfile(handle, handleInputEl, didInputEl, nameInputEl, statusEl) {
    const updateStatus = (message, className = '') => {
        if (!statusEl) return;
        statusEl.textContent = message;
        statusEl.className = className;
        if (className === 'invalid' || className === 'error') {
            handleInputEl?.classList.add('invalid-input');
        } else {
            handleInputEl?.classList.remove('invalid-input');
        }
    }
    const clearDependentFields = () => {
        if (didInputEl) didInputEl.value = '';
        if (nameInputEl) nameInputEl.value = '';
    }

    updateStatus('');
    clearDependentFields();

    const trimmedHandle = handle?.trim();
    if (!trimmedHandle) {
        handleInputEl?.classList.remove('invalid-input');
        return null;
    }

    updateStatus(`Validating ${trimmedHandle}...`, 'resolving');
    try {
        const agent = getAgent();
        if (!agent || !agent.session) {
            throw new Error("Not logged in or session expired. Cannot validate handle.");
        }

        const response = await agent.api.app.bsky.actor.getProfile({ actor: trimmedHandle });

        if (response.data) {
            const profile = {
                did: response.data.did,
                handle: response.data.handle,
                displayName: response.data.displayName || response.data.handle
            };
            updateStatus(`✅ Valid: ${profile.displayName}`, 'valid');

            if (didInputEl) didInputEl.value = profile.did;
            if (nameInputEl) nameInputEl.value = profile.displayName;
            if (handleInputEl && handleInputEl.value !== profile.handle) {
                handleInputEl.value = profile.handle;
            }
            handleInputEl?.classList.remove('invalid-input');
            return profile;
        } else {
            throw new Error("Profile data missing in successful response.");
        }
    } catch (err) {
        console.error(`[Validate Handle] Failed for "${trimmedHandle}":`, err); // Keep error
        clearDependentFields();
        const errorMsg = err.message || err.error || 'Unknown error';
        let displayMsg = `❌ Validation failed`;
        if (err.message?.includes('Profile not found') || err.status === 400) {
            displayMsg = `❌ Profile not found for "${trimmedHandle}"`;
        } else if (err.message?.includes('Unable to resolve handle')) {
            displayMsg = `❌ Could not resolve handle "${trimmedHandle}"`;
        } else {
            displayMsg += `: ${errorMsg}`;
        }
        updateStatus(displayMsg, 'invalid');
        return null;
    }
}

// --- Slug Sanitization ---
export function sanitizeSlug(inputSlug, final = false) {
    if (!inputSlug) return '';
    let slug = inputSlug.toString().toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '').replace(/--+/g, '-');
    if (final) { slug = slug.replace(/^-+|-+$/g, ''); }
    return slug;
}

// --- Filtering and Sorting Helper ---
export function getFilteredAndSortedPosts(posts, searchTerm, category, sortOrder) {
    if (!Array.isArray(posts)) return [];
    let filteredPosts = [...posts];

    if (category) {
        if (category === "Recommended") {
            filteredPosts = filteredPosts.filter(post => post?.value?.recommended === true);
        } else {
            filteredPosts = filteredPosts.filter(post => post?.value?.category === category);
        }
    }

    if (searchTerm) {
        const lowerSearchTerm = searchTerm.toLowerCase();
        filteredPosts = filteredPosts.filter(post => {
            const p = post?.value || {};
            return (
                p.title?.toLowerCase().includes(lowerSearchTerm) ||
                p.shortDescription?.toLowerCase().includes(lowerSearchTerm) ||
                p.content?.toLowerCase().includes(lowerSearchTerm) ||
                p.slug?.toLowerCase().includes(lowerSearchTerm) ||
                p.category?.toLowerCase().includes(lowerSearchTerm) ||
                (Array.isArray(p.tags) && p.tags.some(tag => tag.toLowerCase().includes(lowerSearchTerm)))
            );
        });
    }

    const sortCompareFn = (a, b) => {
        const dateA = a?.value?.publishedAt ? new Date(a.value.publishedAt) : new Date(0);
        const dateB = b?.value?.publishedAt ? new Date(b.value.publishedAt) : new Date(0);
        if (!isValid(dateA) && !isValid(dateB)) return 0;
        if (!isValid(dateA)) return 1;
        if (!isValid(dateB)) return -1;
        return sortOrder === 'oldest' ? compareAsc(dateA, dateB) : compareDesc(dateA, dateB);
    };
    filteredPosts.sort(sortCompareFn);
    return filteredPosts;
}