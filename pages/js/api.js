// --- START OF FILE api.js ---

// js/api.js
import { LIST_RECORDS_BASE_URL, MAX_LIST_LIMIT, RESOLVE_HANDLE_URL } from './config.js';
import { sanitize } from './utils.js';

/**
 * Generates the URL for the com.atproto.repo.listRecords XRPC method.
 */
export function getListRecordsURL(did, collection, limit, cursor) {
    const actualLimit = Math.min(limit, MAX_LIST_LIMIT);
    let url = `${LIST_RECORDS_BASE_URL}?repo=${did}&collection=${collection}&limit=${actualLimit}&reverse=true`;
    if (cursor) {
        url += `&cursor=${cursor}`;
    }
    return url;
}

/**
 * Fetches records using listRecords with pagination support.
 */
export async function fetchRecords(did, collection, limit, cursor) {
    const url = getListRecordsURL(did, collection, limit, cursor);
    try {
        const response = await fetch(url, { credentials: 'omit' });

        if (!response.ok) {
            let errorMsg = `HTTP error! Status: ${response.status} ${response.statusText}`;
            if (response.status === 400) {
                errorMsg = `Could not list records. User may not exist, have posts in this format (${collection}), or repo is invalid. (Status 400)`;
            } else {
                try { const errorData = await response.json(); errorMsg += ` - ${errorData.message || 'No specific error message.'}`; } catch (e) { /* Ignore */ }
            }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const records = data?.records ?? [];
        const nextCursor = data?.cursor ?? null;
        return { records, cursor: nextCursor };

    } catch (error) {
        console.error(`Error fetching records for DID ${did}, Collection ${collection}:`, error);
        throw error;
    }
}

/**
 * Fetches all records for a specific user and collection by paginating through listRecords.
 */
export async function fetchAllRecordsForUser(did, collection, accumulatedCategories, maxPages = 30) {
    let allRecords = [];
    let pagesFetched = 0;
    let currentCursor = null;
    accumulatedCategories.clear();

    try {
        do {
            pagesFetched++;
            const { records: batchRecords, cursor: nextCursor } = await fetchRecords(
                did, collection, MAX_LIST_LIMIT, currentCursor
            );

            if (batchRecords.length > 0) {
                allRecords = allRecords.concat(batchRecords);
                batchRecords.forEach(record => {
                    if (record?.value?.category) {
                        accumulatedCategories.add(sanitize(record.value.category));
                    }
                });
            }

            currentCursor = nextCursor;

            if (!currentCursor) {
                break;
            }
            if (pagesFetched >= maxPages) {
                console.warn(`fetchAllRecordsForUser: Hit page limit (${maxPages}) for ${did}.`);
                break;
            }
        } while (currentCursor);

        return allRecords;

    } catch (error) {
        // Log actual fetch errors, but treat "not found" as empty result
        if (error.message.includes("Could not list records") || error.message.includes("Status 400")) {
            // Don't log this as an error, it's expected if user has no posts
            return []; // Return empty array on 400/not found
        }
        console.error(`fetchAllRecordsForUser ERROR for DID ${did}:`, error);
        throw error; // Re-throw other errors
    }
}


/**
 * Fetches a single record by slug by paginating through listRecords.
 */
export async function findRecordBySlug(did, collection, slug, maxPagesToCheck = 20) {
    let currentCursor = null;
    let pagesFetched = 0;

    try {
        do {
            pagesFetched++;
            const { records, cursor: nextCursor } = await fetchRecords(did, collection, MAX_LIST_LIMIT, currentCursor);

            for (const record of records) {
                if (record?.value?.slug === slug) {
                    return record; // Return the found record immediately
                }
            }

            currentCursor = nextCursor;

            if (!currentCursor) {
                return null; // Reached end of list
            }
            if (pagesFetched >= maxPagesToCheck) {
                console.warn(`findRecordBySlug: Stopped searching for slug '${slug}' after ${maxPagesToCheck} pages (limit reached).`);
                return null;
            }

        } while (currentCursor);

        return null; // Should not be reached if loop logic is correct

    } catch (error) {
        console.error(`findRecordBySlug: Error during search for slug '${slug}':`, error);
        return null; // Return null on error
    }
}

/**
 * Resolves a Bluesky handle to a DID.
 */
export async function resolveHandleToDid(handle) {
    const url = `${RESOLVE_HANDLE_URL}?handle=${encodeURIComponent(handle)}`;
    try {
        const response = await fetch(url, { credentials: 'omit' });

        if (!response.ok) {
            if (response.status === 400 || response.status === 404) {
                // Don't log error for not found, just return null
                return null;
            }
            // Log other HTTP errors
            let errorMsg = `HTTP error resolving handle! Status: ${response.status} ${response.statusText}`;
            try { const errorData = await response.json(); errorMsg += ` - ${errorData.message || 'No specific error message.'}`; } catch (e) { /* Ignore */ }
            throw new Error(errorMsg);
        }

        const data = await response.json();
        const did = data?.did;

        if (!did || typeof did !== 'string' || !did.startsWith('did:')) {
            console.warn("Invalid DID received from resolveHandle:", data); // Keep warning for bad data
            return null;
        }

        return did;

    } catch (error) {
        console.error(`Error resolving handle '${handle}':`, error);
        return null;
    }
}

// --- END OF FILE api.js ---