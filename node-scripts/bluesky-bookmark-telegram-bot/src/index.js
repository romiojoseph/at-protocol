// src/index.js

// --- Constants ---
const BLUESKY_API_URL = "https://bsky.social/xrpc";
const BOOKMARK_COLLECTION = "user.bookmark.feed.public"; // Same collection name
const BLUESKY_SESSION_KEY = "bluesky_session"; // Key for storing session in KV

// --- Utility Functions ---

/**
 * Escapes characters for Telegram MarkdownV2 parse mode.
 * @param {string} text - The text to escape.
 * @returns {string} - The escaped text.
 */
function escapeMarkdownV2(text) {
    if (!text) return '';
    // Escape characters according to Telegram API documentation for MarkdownV2
    // Chars: _ * [ ] ( ) ~ ` > # + - = | { } . !
    // Need to escape the hyphen (-) last or separately as it's used in character ranges
    const charsToEscape = '_*[]()~`>#+=|{}.!';
    let escapedText = text.replace(new RegExp(`[${charsToEscape.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')}]`, 'g'), '\\$&');
    // Escape hyphen separately
    escapedText = escapedText.replace(/-/g, '\\-');
    return escapedText;
}


/**
 * Formats an ISO date string into a more readable format.
 * Example: 21 May 2024, 09:41 PM
 * @param {string} isoString - The ISO date string (e.g., from Bluesky createdAt).
 * @returns {string} - The formatted date string or 'Unknown Date'.
 */
function formatReadableDate(isoString) {
    if (!isoString) return 'Unknown Date';
    try {
        const dt = new Date(isoString);
        if (isNaN(dt)) return 'Invalid Date'; // Check if date is valid

        const optionsDate = { day: 'numeric', month: 'short', year: 'numeric' };
        const optionsTime = { hour: 'numeric', minute: '2-digit', hour12: true };

        // Using en-US for consistent formatting, adjust locale if needed elsewhere
        const datePart = dt.toLocaleDateString('en-GB', optionsDate); // Ex: 21 May 2024
        const timePart = dt.toLocaleTimeString('en-US', optionsTime); // Ex: 09:41 PM

        return `${datePart}, ${timePart}`;
    } catch (e) {
        console.error(`Error formatting date "${isoString}":`, e);
        return 'Formatting Error';
    }
}


// --- Telegram API Interaction ---

/**
 * Sends a message via the Telegram Bot API.
 * @param {string | number} chatId - The target chat ID.
 * @param {string} text - The message text.
 * @param {object} [options] - Optional parameters like parse_mode, reply_markup, reply_to_message_id, disable_web_page_preview.
 * @param {object} env - Cloudflare environment object containing secrets.
 * @returns {Promise<object|null>} - The result from Telegram API (the sent message object) or null on failure.
 */
async function sendTelegramMessage(chatId, text, options = {}, env) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
    const payload = {
        chat_id: chatId,
        text: text,
        ...options, // Include parse_mode, reply_markup etc. here
    };

    try {
        console.debug(`Sending Telegram message to ${chatId}:`, JSON.stringify(payload).substring(0, 200) + "..."); // Log outgoing message snippet
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
            // Add specific error info for easier debugging
            const errorInfo = {
                status: response.status,
                statusText: response.statusText,
                body: data // Contains { ok, error_code, description }
            };
            console.error(`Telegram API error (sendMessage) to chat ${chatId}:`, errorInfo);
            // Throw an error object that includes the description for better handling in .catch
            const error = new Error(`Telegram API Error: ${data.description || response.statusText}`);
            error.details = errorInfo; // Attach details to the error object
            throw error;
        }
        console.debug("Telegram sendMessage successful:", data.result?.message_id);
        return data.result; // Contains the sent message object
    } catch (error) {
        // If error was already processed/thrown above, re-throw.
        // If it's a network error (fetch failed), log that.
        if (!error.details) { // Likely a fetch/network error if details aren't attached
            console.error(`Failed to send Telegram message (Network/Fetch Error) to chat ${chatId}:`, error);
        }
        // Propagate the error so the caller's .catch works as expected
        throw error;
    }
}

/**
 * Edits an existing message via the Telegram Bot API.
 * @param {string | number} chatId - The target chat ID.
 * @param {number} messageId - The ID of the message to edit.
 * @param {string} text - The new message text.
 * @param {object} [options] - Optional parameters like parse_mode, reply_markup.
 * @param {object} env - Cloudflare environment object containing secrets.
 * @returns {Promise<boolean>} - True if successful, false otherwise.
 */
async function editTelegramMessage(chatId, messageId, text, options = {}, env) {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/editMessageText`;
    const payload = {
        chat_id: chatId,
        message_id: messageId,
        text: text,
        ...options,
    };

    try {
        console.debug(`Editing Telegram message ${messageId} in chat ${chatId}:`, JSON.stringify(payload));
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        const data = await response.json();
        if (!response.ok) {
            // Ignore "message is not modified" error specifically
            if (data.description && data.description.includes('message is not modified')) {
                console.warn('Telegram edit skipped: message is not modified.');
                return true; // Treat as success from bot's perspective
            }
            console.error(`Telegram API error (editMessageText): ${response.status} ${response.statusText}`, data);
            return false;
        }
        console.debug(`Telegram editMessageText successful for message ${messageId}`);
        return true;
    } catch (error) {
        console.error('Failed to edit Telegram message:', error);
        return false;
    }
}

// --- BlueSky API Interaction ---

let blueskySessionCache = null; // Simple in-memory cache for the current invocation

/**
 * Retrieves the BlueSky session, attempting refresh or re-authentication if needed.
 * Uses Cloudflare KV for persistence.
 * @param {object} env - Cloudflare environment object (for secrets and KV).
 * @returns {Promise<object|null>} - The session object or null if auth fails.
 */
async function getBlueskySession(env) {
    // 1. Check in-memory cache first (valid only for the current worker invocation)
    if (blueskySessionCache) {
        console.debug("Using in-memory Bluesky session cache.");
        return blueskySessionCache;
    }

    // 2. Try loading from KV
    console.debug("Attempting to load Bluesky session from KV...");
    const storedSession = await env.BLUESKY_SESSION_KV.get(BLUESKY_SESSION_KEY, { type: 'json' });

    if (storedSession && storedSession.refreshJwt) {
        console.info("Found session in KV. Attempting refresh...");
        // 3. Try refreshing the stored session
        const refreshed = await refreshBlueskySession(storedSession.refreshJwt, env);
        if (refreshed) {
            blueskySessionCache = refreshed; // Update cache
            return refreshed;
        } else {
            console.warn("Session refresh failed. Attempting full authentication.");
            // Clear potentially invalid session from KV if refresh fails
            await env.BLUESKY_SESSION_KV.delete(BLUESKY_SESSION_KEY);
        }
    } else {
        console.info("No valid session in KV or missing refresh token.");
    }

    // 4. Authenticate if load/refresh failed
    console.info("Attempting full Bluesky authentication...");
    const newSession = await authenticateWithBluesky(env);
    if (newSession) {
        blueskySessionCache = newSession; // Update cache
    } else {
        console.error("FATAL: Bluesky authentication failed.");
        blueskySessionCache = null; // Clear cache on failure
    }
    return newSession;
}

/**
 * Refreshes the BlueSky session using a refresh token.
 * @param {string} refreshToken - The refresh token.
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<object|null>} - The new session object or null on failure.
 */
async function refreshBlueskySession(refreshToken, env) {
    const url = `${BLUESKY_API_URL}/com.atproto.server.refreshSession`;
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${refreshToken}` },
        });

        if (!response.ok) {
            const errorText = await response.text();
            console.warn(`Failed to refresh session: ${response.status} ${response.statusText}`, errorText);
            // If refresh token is invalid/expired (common cause), return null
            // The caller (getBlueskySession) will handle deletion from KV
            if (response.status === 400 || response.status === 401) {
                console.warn("Refresh token likely invalid/expired.");
            }
            return null;
        }

        const newSessionData = await response.json();
        if (!newSessionData || !newSessionData.accessJwt || !newSessionData.refreshJwt || !newSessionData.did || !newSessionData.handle) {
            console.error("Refreshed BlueSky session data incomplete:", newSessionData);
            return null;
        }

        // Store the refreshed session in KV (overwrite old one)
        await env.BLUESKY_SESSION_KV.put(BLUESKY_SESSION_KEY, JSON.stringify(newSessionData));
        console.info("BlueSky session refreshed and saved to KV.");
        return newSessionData;

    } catch (error) {
        console.error("Error during session refresh:", error);
        return null;
    }
}

/**
 * Authenticates with the BlueSky API using username and app password.
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<object|null>} - The new session object or null on failure.
 */
async function authenticateWithBluesky(env) {
    const url = `${BLUESKY_API_URL}/com.atproto.server.createSession`;
    const payload = {
        identifier: env.BLUESKY_USERNAME,
        password: env.BLUESKY_APP_PASSWORD,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        if (!response.ok) {
            console.error(`BlueSky authentication HTTP error: ${response.status} ${response.statusText}`, await response.text());
            return null;
        }

        const sessionData = await response.json();
        if (!sessionData || !sessionData.accessJwt || !sessionData.refreshJwt || !sessionData.did || !sessionData.handle) {
            console.error("BlueSky authentication response missing required keys:", sessionData);
            return null;
        }

        // Store the new session in KV
        await env.BLUESKY_SESSION_KV.put(BLUESKY_SESSION_KEY, JSON.stringify(sessionData));
        console.info("BlueSky authentication successful, session saved to KV.");
        return sessionData;

    } catch (error) {
        console.error("Unexpected error during BlueSky authentication:", error);
        return null;
    }
}

/**
 * Gets the necessary Authorization header for BlueSky API calls.
 * Ensures the session is valid (loads/refreshes/authenticates if needed).
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<object|null>} - Headers object {'Authorization': Bearer ...} or null on failure.
 */
async function getBlueskyAuthHeaders(env) {
    const session = await getBlueskySession(env);
    if (!session || !session.accessJwt) {
        console.error("Could not obtain valid BlueSky session for auth headers.");
        return null;
    }
    return { 'Authorization': `Bearer ${session.accessJwt}` };
}

/**
 * Resolves a BlueSky handle to a DID.
 * @param {string} handle - The handle to resolve (e.g., 'bsky.app').
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<string|null>} - The DID string or null if not found/error.
 */
async function resolveHandleToDid(handle, env) {
    const headers = await getBlueskyAuthHeaders(env);
    if (!headers) return null;

    const url = new URL(`${BLUESKY_API_URL}/com.atproto.identity.resolveHandle`);
    url.searchParams.append('handle', handle);

    try {
        const response = await fetch(url.toString(), { headers });
        if (!response.ok) {
            if (response.status === 404) console.info(`Handle '${handle}' not found (404).`);
            else console.error(`API error resolving handle '${handle}': ${response.status} ${response.statusText}`, await response.text());
            return null;
        }
        const data = await response.json();
        const did = data?.did;
        if (did) {
            console.info(`Resolved handle '${handle}' to DID '${did}'.`);
            return did;
        } else {
            console.warn(`DID missing in resolveHandle response for '${handle}'.`);
            return null;
        }
    } catch (error) {
        console.error(`Error resolving handle '${handle}':`, error);
        return null;
    }
}

/**
 * Converts a BlueSky web URL or AT-URI string to a canonical AT-URI.
 * @param {string} url - The input URL (bsky.app or at://).
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<string|null>} - The AT-URI string or null on failure.
 */
async function convertToAtUri(url, env) {
    // Check if already an AT-URI
    const atUriRegex = /^(at:\/\/(?:did:[a-z0-9:]+|[a-zA-Z0-9.-]+)\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+)/;
    const atUriMatch = url.match(atUriRegex);
    if (atUriMatch) {
        console.debug(`Input URL is already an AT-URI: ${url}`);
        return atUriMatch[1];
    }

    // Check for bsky.app URL format
    const bskyUrlRegex = /bsky\.app\/profile\/([^/]+)\/post\/([a-zA-Z0-9]+)/;
    const bskyUrlMatch = url.match(bskyUrlRegex);

    if (bskyUrlMatch) {
        const identifier = bskyUrlMatch[1];
        const rkey = bskyUrlMatch[2];
        let did;

        if (identifier.startsWith('did:')) {
            did = identifier;
        } else {
            console.debug(`Attempting to resolve handle: ${identifier}`);
            did = await resolveHandleToDid(identifier, env);
            if (!did) {
                console.error(`Failed to resolve identifier '${identifier}' from URL '${url}'.`);
                return null;
            }
        }
        const resultUri = `at://${did}/app.bsky.feed.post/${rkey}`;
        console.debug(`Converted URL ${url} to AT-URI ${resultUri}`);
        return resultUri;
    } else {
        console.warn(`Could not parse URL as bsky.app or AT-URI: ${url}`);
        return null;
    }
}

/**
 * Lists all records in a specific collection for the authenticated user, handling pagination.
 * @param {string} collection - The collection identifier (e.g., 'user.bookmark.feed.public').
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<Array<object>>} - An array of record objects, or empty array on failure.
 */
async function listAllRecords(collection, env) {
    const session = await getBlueskySession(env); // Need session for DID
    const headers = await getBlueskyAuthHeaders(env);
    if (!headers || !session?.did) {
        console.error(`Cannot list records for ${collection}: Missing auth headers or session DID.`);
        return [];
    }

    const allRecords = [];
    let cursor = null;
    const baseUrl = `${BLUESKY_API_URL}/com.atproto.repo.listRecords`;

    try {
        do {
            const url = new URL(baseUrl);
            url.searchParams.append('repo', session.did);
            url.searchParams.append('collection', collection);
            url.searchParams.append('limit', '100'); // Max limit allowed
            if (cursor) {
                url.searchParams.append('cursor', cursor);
            }

            console.debug(`Listing records for ${collection}, cursor: ${cursor || 'start'}`);
            const response = await fetch(url.toString(), { headers });

            if (!response.ok) {
                console.error(`API error listing ${collection}: ${response.status} ${response.statusText}`, await response.text());
                return []; // Return empty on error
            }

            const data = await response.json();
            const records = data?.records || [];
            allRecords.push(...records);
            cursor = data?.cursor;
            console.debug(`Fetched ${records.length} records from ${collection}. New cursor: ${cursor}`);

        } while (cursor); // Continue while a cursor is returned

        console.info(`Finished listing ${allRecords.length} records from ${collection}.`);
        return allRecords;

    } catch (error) {
        console.error(`Unexpected error listing ${collection}:`, error);
        return []; // Return empty on error
    }
}

/**
 * Checks if a post AT-URI exists in the bookmark collection and returns its 'value' if found.
 * @param {string} postAtUri - The AT-URI of the post to check.
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<object|null>} - The 'value' object of the bookmark record if found, otherwise null.
 */
async function getExistingBookmarkDetails(postAtUri, env) {
    console.debug(`Checking for existing bookmark: ${postAtUri}`);
    const records = await listAllRecords(BOOKMARK_COLLECTION, env);
    for (const record of records) {
        if (record?.value?.uri === postAtUri) {
            console.info(`Found existing bookmark for post ${postAtUri}.`);
            return record.value;
        }
    }
    console.info(`Post ${postAtUri} not found in existing bookmarks.`);
    return null;
}

/**
 * Saves a post AT-URI to the custom bookmark lexicon.
 * @param {string} postAtUri - The AT-URI of the post to bookmark.
 * @param {string} category - The user-defined category.
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<{success: boolean, message: string, data?: object}>} - Result object.
 */
async function savePostToLexicon(postAtUri, category, env) {
    const session = await getBlueskySession(env);
    const headers = await getBlueskyAuthHeaders(env);
    if (!headers || !session?.did) {
        return { success: false, message: 'Authentication failed or session invalid.' };
    }

    const url = `${BLUESKY_API_URL}/com.atproto.repo.createRecord`;
    const nowIso = new Date().toISOString();

    // REMOVED validate: true from this payload
    const payload = {
        repo: session.did,
        collection: BOOKMARK_COLLECTION,
        record: {
            $type: BOOKMARK_COLLECTION,
            uri: postAtUri,
            category: category.trim(),
            createdAt: nowIso,
        },
    };

    console.debug("Attempting to create bookmark record (no server validation):", JSON.stringify(payload));

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });

        const responseBody = await response.text();

        if (!response.ok) {
            let errorDetail = `Status ${response.status}`;
            try {
                const errorJson = JSON.parse(responseBody);
                // Check for specific lexicon not found error even without validate:true, just in case PDS policies change
                if (errorJson.message?.includes('Lexicon not found')) {
                    console.error(`API error saving post: Lexicon '${BOOKMARK_COLLECTION}' might be disallowed by PDS even without validation.`);
                    return { success: false, message: `API error: The server rejected the custom collection type '${BOOKMARK_COLLECTION}'.` };
                }
                errorDetail = errorJson.message || errorJson.error || responseBody;
            } catch (e) {
                errorDetail = responseBody || `Status ${response.status} ${response.statusText}`;
            }

            console.error(`API error saving post: ${errorDetail}`);
            // Check for conflict error
            if (response.status === 409 || (response.status === 400 && typeof errorDetail === 'string' && errorDetail.includes('Record already exists'))) {
                return { success: false, message: 'This post has already been saved (server conflict).' };
            }
            return { success: false, message: `API error: ${errorDetail}` };
        }

        let savedItemResponse;
        try {
            savedItemResponse = JSON.parse(responseBody);
        } catch (e) {
            console.error("Failed to parse successful createRecord response:", e, responseBody);
            return { success: false, message: 'Post saved, but failed to process server response.' };
        }

        console.info(`Successfully created bookmark record: ${savedItemResponse?.uri}`);
        return { success: true, message: 'Post saved successfully!', data: savedItemResponse };

    } catch (error) {
        console.error("Network or unexpected error saving post:", error);
        return { success: false, message: `Unexpected error: ${error.message || error.toString()}` };
    }
}

/**
 * Gets all unique categories from the bookmark collection.
 * @param {object} env - Cloudflare environment object.
 * @returns {Promise<Array<string>>} - A sorted array of unique category names.
 */
async function getAllCategories(env) {
    console.debug("Fetching all categories...");
    const records = await listAllRecords(BOOKMARK_COLLECTION, env);
    const categories = new Set();
    for (const record of records) {
        const category = record?.value?.category;
        if (typeof category === 'string' && category.trim()) {
            categories.add(category.trim());
        }
    }
    // Sort case-insensitively
    const sortedCategories = Array.from(categories).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    console.info(`Found categories: ${sortedCategories.join(', ')}`);
    return sortedCategories;
}


// --- Cloudflare Worker Fetch Handler ---

export default {
    /**
     * Handles incoming fetch requests (Telegram Webhooks).
     * @param {Request} request - The incoming request object.
     * @param {object} env - Environment variables and bindings (secrets, KV).
     * @param {object} ctx - Execution context (includes waitUntil).
     * @returns {Promise<Response>} - The response to send back to Telegram.
     */
    async fetch(request, env, ctx) {
        // 1. Check Request Method
        if (request.method !== 'POST') {
            console.warn(`Received non-POST request: ${request.method}`);
            return new Response('Expected POST', { status: 405 });
        }

        // 2. Optional: Verify Webhook Secret
        if (env.TELEGRAM_WEBHOOK_SECRET) {
            const secretToken = request.headers.get('X-Telegram-Bot-Api-Secret-Token');
            if (secretToken !== env.TELEGRAM_WEBHOOK_SECRET) {
                console.warn("Unauthorized webhook attempt: Invalid secret token.");
                return new Response('Unauthorized - Invalid Secret', { status: 401 });
            }
        }

        // 3. Parse Incoming Update
        let update;
        try {
            update = await request.json();
            console.debug("Received Telegram update:", JSON.stringify(update).substring(0, 500) + "..."); // Log snippet
        } catch (e) {
            console.error("Failed to parse incoming JSON:", e);
            return new Response('Bad Request: Invalid JSON', { status: 400 });
        }

        // 4. Extract Relevant Message Data
        // Handle both new messages and edited messages potentially containing links/commands
        const message = update.message || update.edited_message;
        if (!message || !message.chat || !message.text) {
            console.debug("Ignoring update without message text (e.g., status update, join/left).");
            return new Response('OK: Ignored non-text message'); // Acknowledge Telegram, but do nothing
        }

        const chatId = message.chat.id;
        const messageText = message.text;
        const messageId = message.message_id; // Useful for replies/edits

        // --- 5. Authorization Check ---
        // Ensure AUTHORIZED_CHAT_ID is correctly configured
        let authorizedChatIdNumber;
        try {
            authorizedChatIdNumber = parseInt(env.AUTHORIZED_CHAT_ID, 10);
            if (isNaN(authorizedChatIdNumber)) {
                throw new Error("Value is NaN");
            }
        } catch (e) {
            console.error(`FATAL: Invalid AUTHORIZED_CHAT_ID configured: '${env.AUTHORIZED_CHAT_ID}'. Error: ${e.message}`);
            // Don't message any user back in this fatal config error case
            return new Response("Internal Server Error: Bot misconfiguration", { status: 500 });
        }
        const authorizedChatId = authorizedChatIdNumber; // Use the parsed number

        // Perform the check
        if (chatId !== authorizedChatId) {
            console.warn(`Unauthorized message detected from chat ID: ${chatId}`);

            // --- Action for Unauthorized Access: Reply only to the unauthorized user ---

            const warningMessage = "⛔️ Sorry, you are not authorized to use this bot.";

            // Send the warning asynchronously using waitUntil and reply_to_message_id
            ctx.waitUntil(
                sendTelegramMessage(chatId, warningMessage, { reply_to_message_id: messageId }, env)
                    .catch(err => {
                        // Log specific errors like "chat not found" differently
                        if (err && err.message && err.message.toLowerCase().includes('chat not found')) {
                            console.warn(`Could not send warning to unauthorized chat ID ${chatId}: Chat not found (user may have blocked the bot).`);
                        } else {
                            // Log other errors encountered while sending the warning
                            console.error(`Failed to send unauthorized warning to chat ID ${chatId}:`, err);
                        }
                    })
            );

            // --- End of Action ---

            // Return OK to Telegram quickly, acknowledging the webhook. The notification happens in the background.
            return new Response('OK: Unauthorized access handled');
        }

        // --- 6. Handle Authorized User Messages ---

        // --- Handle /start command ---
        if (messageText.trim() === '/start') {
            console.info(`Processing /start command for authorized chat ID: ${chatId}`);
            // Attempt to load/auth session proactively on start, inform user if it fails
            const session = await getBlueskySession(env); // Wait for session check here
            if (!session) {
                // Use ctx.waitUntil for fire-and-forget error messages
                ctx.waitUntil(sendTelegramMessage(chatId, "⚠️ Couldn't connect to BlueSky. Please check the bot's credentials.", { reply_to_message_id: messageId }, env).catch(e => console.error("Error sending Bluesky connection warning:", e)));
                // Consider if you want to return early if Bluesky isn't available
                // return new Response('OK: Start processed, Bluesky unavailable');
            }

            const welcomeMessage =
                "👋 Welcome\\! I'm your personal BlueSky bookmark bot\\.\n\n" +
                "Send me a BlueSky post link \\(`https://bsky\\.app/\\.\\.\\.` or `at://\\.\\.\\.`\\) " +
                "and I'll ask for a category to save it under in your `personal\\.bookmark\\.feed`\\.\n\n" +
                "I only respond to you\\.";
            // Use ctx.waitUntil for the welcome message too, so response returns faster
            ctx.waitUntil(sendTelegramMessage(chatId, welcomeMessage, { parse_mode: 'MarkdownV2', disable_web_page_preview: true }, env).catch(e => console.error("Error sending welcome message:", e)));

            // Clear any pending state on /start
            await env.TELEGRAM_STATE_KV.delete(chatId.toString());
            return new Response('OK: Start command processed');
        }

        // --- State Check: Is user supposed to be providing a category? ---
        const pendingStateKey = chatId.toString();
        const pendingUri = await env.TELEGRAM_STATE_KV.get(pendingStateKey);

        if (pendingUri) {
            // --- State 2: Handle Category Response ---
            const categoryRaw = messageText.trim();
            console.info(`Received potential category '${categoryRaw}' for pending URI '${pendingUri}' from chat ${chatId}`);

            if (!categoryRaw) {
                // Warn user and wait for another message
                ctx.waitUntil(sendTelegramMessage(chatId, "⚠️ Category cannot be empty. Please provide a category name.", { reply_to_message_id: messageId }, env).catch(e => console.error("Error sending empty category warning:", e)));
                // Don't clear state here, keep waiting
                return new Response('OK: Empty category received');
            }

            // Clear the state *before* attempting to save, to prevent accidental reuse
            await env.TELEGRAM_STATE_KV.delete(pendingStateKey);

            const escapedCategory = escapeMarkdownV2(categoryRaw);
            const processingMsgText = `⏳ Saving post under category \`${escapedCategory}\`\\.\\.\\.`;
            // Send processing message and try to get its ID
            let processingMsgId = null;
            try {
                const processingMsg = await sendTelegramMessage(chatId, processingMsgText, { parse_mode: 'MarkdownV2', reply_to_message_id: messageId }, env);
                processingMsgId = processingMsg?.message_id;
            } catch (e) {
                console.error("Error sending processing message:", e);
                // Continue without editing capability if sending fails
            }


            // Perform the save operation
            const result = await savePostToLexicon(pendingUri, categoryRaw, env);

            let finalText;
            let finalParseMode = 'MarkdownV2';

            if (result.success) {
                const newRecordUri = result.data?.uri || 'Unknown URI';
                const escapedPostUri = escapeMarkdownV2(pendingUri);
                const escapedNewRecordUri = escapeMarkdownV2(newRecordUri);
                finalText =
                    `✅ Success\\!\n\n` +
                    `Saved Post: \`${escapedPostUri}\`\n` +
                    `Category: \`${escapedCategory}\`\n` +
                    `Bookmark Record URI: \`${escapedNewRecordUri}\``;
                console.info(`Successfully saved bookmark. Record URI: ${newRecordUri}, Post URI: ${pendingUri}, Category: ${categoryRaw}`);
            } else {
                const escapedErrorMessage = escapeMarkdownV2(result.message);
                finalText = `❌ Failed to save post: ${escapedErrorMessage}`;
                console.error(`Failed to save bookmark for ${pendingUri} with category '${categoryRaw}': ${result.message}`);
            }

            // Edit the "Processing..." message or send a new one in background
            if (processingMsgId) {
                // Use ctx.waitUntil to allow editing after response is sent
                ctx.waitUntil(editTelegramMessage(chatId, processingMsgId, finalText, { parse_mode: finalParseMode }, env).catch(e => {
                    console.error("Error editing final message, attempting send instead:", e);
                    // Fallback if editing fails AFTER sending processing msg
                    sendTelegramMessage(chatId, finalText, { parse_mode: finalParseMode, reply_to_message_id: messageId }, env).catch(e2 => console.error("Error sending final message as fallback:", e2));
                }));
            } else {
                console.warn("Could not get processing message ID, sending final result as new message.");
                // Send as new message if processing message failed initially
                ctx.waitUntil(sendTelegramMessage(chatId, finalText, { parse_mode: finalParseMode, reply_to_message_id: messageId }, env).catch(e => console.error("Error sending final message as new:", e)));
            }
            return new Response('OK: Category processed');

        } else {
            // --- State 1: Handle Potential BlueSky Link ---
            // Regex to find Bluesky links (bsky.app or at://)
            const bskyLinkRegex = /(https?:\/\/bsky\.app\/profile\/[^/ ]+\/post\/[a-zA-Z0-9]+|at:\/\/[a-zA-Z0-9:.-]+\/app\.bsky\.feed\.post\/[a-zA-Z0-9]+)/;
            const bskyLinkMatch = messageText.match(bskyLinkRegex);

            if (bskyLinkMatch) {
                const url = bskyLinkMatch[0]; // Get the first match
                console.info(`Detected potential BlueSky link: ${url} in message from chat ${chatId}`);

                // Check Bluesky connection first
                const session = await getBlueskySession(env); // Wait for session check
                if (!session) {
                    // Use ctx.waitUntil for fire-and-forget error message
                    ctx.waitUntil(sendTelegramMessage(chatId, "❌ Could not connect to BlueSky. Please check credentials or try `/start` again.", { reply_to_message_id: messageId }, env).catch(e => console.error("Error sending Bluesky connection failed message:", e)));
                    return new Response('OK: Bluesky connection failed');
                }

                // Send initial processing message and try get ID
                let processingMsgId = null;
                try {
                    const processingMsg = await sendTelegramMessage(chatId, "⏳ Processing link...", { reply_to_message_id: messageId }, env);
                    processingMsgId = processingMsg?.message_id;
                } catch (e) {
                    console.error("Failed to send 'Processing link...' message or get its ID. Proceeding without edit capability.", e);
                }

                // Convert link
                const atUri = await convertToAtUri(url, env); // Wait for conversion

                if (!atUri) {
                    const errorText = `❌ Could not convert the link to a valid BlueSky AT\\-URI\\. Please check the link format\\. Link received: ${escapeMarkdownV2(url)}`;
                    // Edit or send new error message in background
                    if (processingMsgId) {
                        ctx.waitUntil(editTelegramMessage(chatId, processingMsgId, errorText, { parse_mode: 'MarkdownV2' }, env).catch(e => console.error("Error editing invalid link format message:", e)));
                    } else {
                        ctx.waitUntil(sendTelegramMessage(chatId, errorText, { parse_mode: 'MarkdownV2', reply_to_message_id: messageId }, env).catch(e => console.error("Error sending invalid link format message:", e)));
                    }
                    return new Response('OK: Invalid link format');
                }

                // Edit message to show duplicate check status (fire and forget)
                if (processingMsgId) {
                    ctx.waitUntil(editTelegramMessage(chatId, processingMsgId, "⏳ Checking for duplicates...", {}, env).catch(e => console.warn("Failed to edit 'Checking duplicates' status:", e)));
                } else {
                    console.debug("Skipping 'Checking duplicates' edit, no message ID.");
                }


                // Check for duplicates (wait for this check)
                const duplicateDetails = await getExistingBookmarkDetails(atUri, env);
                if (duplicateDetails) {
                    const category = duplicateDetails.category || 'Unknown';
                    const createdAtStr = duplicateDetails.createdAt;
                    const formattedDate = formatReadableDate(createdAtStr); // Use the helper

                    const escapedCategory = escapeMarkdownV2(category);
                    const escapedDate = escapeMarkdownV2(formattedDate);

                    const duplicateMessage = `✅ This post was already saved under category \`${escapedCategory}\` on ${escapedDate}\\.`;

                    // Edit or send duplicate message in background
                    if (processingMsgId) {
                        ctx.waitUntil(editTelegramMessage(chatId, processingMsgId, duplicateMessage, { parse_mode: 'MarkdownV2' }, env).catch(e => console.error("Error editing duplicate message:", e)));
                    } else {
                        ctx.waitUntil(sendTelegramMessage(chatId, duplicateMessage, { parse_mode: 'MarkdownV2', reply_to_message_id: messageId }, env).catch(e => console.error("Error sending duplicate message:", e)));
                    }
                    return new Response('OK: Duplicate found');
                }

                // --- Not a duplicate: Ask for category ---
                // Store the AT-URI in KV, associated with the chat ID (wait for put)
                // Expire after 1 hour (3600 seconds) if no category is provided
                await env.TELEGRAM_STATE_KV.put(pendingStateKey, atUri, { expirationTtl: 3600 });
                console.info(`Stored AT-URI '${atUri}' in KV for chat ${chatId}, waiting for category.`);

                // Get categories (wait for list)
                const categories = await getAllCategories(env);
                const escapedAtUri = escapeMarkdownV2(atUri);

                let prompt = `✅ Link understood: \`${escapedAtUri}\`\n\n` +
                    `Please reply with a category name...`;

                if (categories.length > 0) {
                    const escapedCategoriesStr = escapeMarkdownV2(categories.join(', '));
                    prompt += `\n\nExisting categories: \`${escapedCategoriesStr}\``;
                }

                // Edit the message to show the prompt (in background)
                if (processingMsgId) {
                    ctx.waitUntil(editTelegramMessage(chatId, processingMsgId, prompt, { parse_mode: 'MarkdownV2' }, env).catch(e => console.error("Error editing category prompt:", e)));
                } else {
                    ctx.waitUntil(sendTelegramMessage(chatId, prompt, { parse_mode: 'MarkdownV2', reply_to_message_id: messageId }, env).catch(e => console.error("Error sending category prompt:", e)));
                }
                return new Response('OK: Awaiting category');

            } else {
                // --- State 3: Neither Link nor expected Category Response ---
                console.info(`Received message from ${chatId} that is not a recognized link or category response while no state was pending.`);
                const helpText = "Please send a valid BlueSky post link \\(starting with `https://bsky\\.app/...` or `at://...`\\) to save it.";
                // Send help message in background
                ctx.waitUntil(sendTelegramMessage(chatId, helpText, { parse_mode: 'MarkdownV2', reply_to_message_id: messageId }, env).catch(e => console.error("Error sending help text:", e)));
                return new Response('OK: Unrecognized input');
            }
        }
    }, // End of async fetch
}; // End of export default