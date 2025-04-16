// --- START OF FILE blog-manager.mjs ---

import inquirer from 'inquirer';
import { BskyAgent, AtUri } from '@atproto/api';
import dotenv from 'dotenv';
import { format, parse, isValid, formatISO, parseISO } from 'date-fns';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

// --- Configuration ---
dotenv.config();

const BSKY_HANDLE = process.env.BLUESKY_HANDLE;
const BSKY_APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD;
const BLOG_POST_NSID = 'sky.write.on.pages'; // Your custom collection NSID
const POSTS_PER_PAGE_CLI = 15; // How many posts to show per page in CLI list

if (!BSKY_HANDLE || !BSKY_APP_PASSWORD) {
    console.error('Error: BLUESKY_HANDLE and BLUESKY_APP_PASSWORD must be set in .env');
    process.exit(1);
}

const agent = new BskyAgent({ service: 'https://bsky.social' });

// --- Constants ---
const CUSTOM_DATE_FORMAT = 'dd MMM yyyy hh:mm a'; // Format like: 20 Mar 2025 04:36 PM
const CLEAR_INPUT_COMMAND = '(clear)'; // Special command to clear optional fields
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// *** MATCHING FRONTEND FIELDS ***
const POST_FIELDS = [
    'title', 'shortDescription', 'authorHandle', 'authorDid', 'authorDisplayName',
    'slug', 'category', 'content',
    'coverImage', 'tags', 'publishedAt', 'updatedAt', 'bskyCommentsPostUri',
    'recommended'
];
const requiredFields = [
    'title', 'shortDescription', 'authorHandle',
    'slug', 'category', 'content', 'publishedAt'
];
// Derived fields are handled separately
const inputFields = POST_FIELDS.filter(f => !['authorDid', 'authorDisplayName'].includes(f));
const optionalFields = inputFields.filter(f => !requiredFields.includes(f));

// --- Date Helper Functions (Matching utils.js) ---
function parseCustomDateString(input) {
    if (!input) return null;
    try {
        const parsedDate = parse(input, CUSTOM_DATE_FORMAT, new Date());
        if (isValid(parsedDate)) return parsedDate;
    } catch (e) { /* ignore */ }
    try {
        const directParsed = parseISO(input); // Try ISO as fallback
        if (isValid(directParsed)) return directParsed;
    } catch (e) { /* ignore */ }
    try {
        const nativeParsed = new Date(input); // Try native constructor last
        if (isValid(nativeParsed)) return nativeParsed;
    } catch (e) { /* ignore */ }
    return null;
}

function formatDateToCustomString(dateInput) {
    if (!dateInput) return '';
    try {
        const dateObj = (typeof dateInput === 'string' || typeof dateInput === 'number') ? new Date(dateInput) : dateInput;
        return isValid(dateObj) ? format(dateObj, CUSTOM_DATE_FORMAT) : '';
    } catch (e) {
        console.warn("Date formatting to custom string failed:", dateInput, e); return '';
    }
}

function formatDateToISO(dateInput) {
    if (!dateInput) return null;
    try {
        const dateObj = (typeof dateInput === 'string' || typeof dateInput === 'number') ? new Date(dateInput) : dateInput;
        return isValid(dateObj) ? formatISO(dateObj) : null;
    } catch (e) {
        console.error("Error formatting date to ISO:", dateInput, e); return null;
    }
}

// --- AT URI Helper (Matching utils.js) ---
async function convertBskyUrlToAtUri(urlInput) {
    if (!urlInput || typeof urlInput !== 'string') return null;
    const trimmedUrl = urlInput.trim();
    if (!trimmedUrl) return null;

    if (trimmedUrl.startsWith('at://')) {
        try { new AtUri(trimmedUrl); return trimmedUrl; }
        catch (e) { console.warn(`[Convert URL] Invalid AT URI: ${trimmedUrl}. Error: ${e.message}`); return null; }
    }
    if (trimmedUrl.startsWith('https://bsky.app/profile/')) {
        try {
            const url = new URL(trimmedUrl);
            const pathParts = url.pathname.split('/').filter(Boolean);
            if (pathParts.length !== 4 || pathParts[0] !== 'profile' || pathParts[2] !== 'post') {
                throw new Error("URL path doesn't match expected /profile/{id}/post/{rkey} structure.");
            }
            let identifier = pathParts[1]; const rkey = pathParts[3]; let did = '';
            if (identifier.startsWith('did:')) { did = identifier; }
            else {
                await login();
                const resolveResult = await agent.resolveHandle({ handle: identifier });
                if (!resolveResult.data.did) { throw new Error(`Could not resolve handle "${identifier}"`); }
                did = resolveResult.data.did;
            }
            const collection = 'app.bsky.feed.post'; const atUri = `at://${did}/${collection}/${rkey}`;
            new AtUri(atUri); return atUri;
        } catch (error) {
            console.error(`❌ [Convert URL] Failed to convert URL "${trimmedUrl}" to AT URI: ${error.message}`);
            return null;
        }
    }
    console.warn(`[Convert URL] Invalid format: ${trimmedUrl}. Use https://bsky.app/... or at://...`);
    return null;
}

// --- Author Handle Validation (Matching utils.js) ---
async function validateHandleAndFetchProfile(handle) {
    if (!handle || !handle.trim()) { console.error("❌ Handle cannot be empty."); return null; }
    const trimmedHandle = handle.trim();
    console.log(`\n🔍 Validating handle: ${trimmedHandle}...`);
    try {
        await login();
        const response = await agent.api.app.bsky.actor.getProfile({ actor: trimmedHandle });
        if (response.data) {
            const profile = {
                did: response.data.did,
                handle: response.data.handle,
                displayName: response.data.displayName || response.data.handle
            };
            console.log(`   ✅ Valid: ${profile.displayName} (@${profile.handle}) [${profile.did}]`);
            return profile;
        } else {
            console.error(`   ❌ No profile data returned for handle: ${trimmedHandle}`);
            return null;
        }
    } catch (err) {
        console.error(`   ❌ Failed to validate handle "${trimmedHandle}". Error: ${err.message || err.error || 'Unknown error'}`);
        if (err.response?.data?.message) console.error('      Server message:', err.response.data.message);
        if (err.response?.status === 400 || err.message?.includes('Profile not found') || err.message?.includes('Unable to resolve handle')) {
            console.error(`      Hint: The handle "${trimmedHandle}" likely does not exist or could not be resolved.`);
        }
        return null;
    }
}

// --- Slug Validation Helper ---
function validateSlug(input) {
    if (!input) return 'Slug cannot be empty.';
    const pattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!pattern.test(input)) {
        return 'Slug must contain only lowercase letters, numbers, and single hyphens (not at start/end).';
    }
    return true;
}

// --- Core Functions ---

async function login() {
    if (agent.session) return; // Already logged in
    console.log('Attempting login...');
    try {
        await agent.login({ identifier: BSKY_HANDLE, password: BSKY_APP_PASSWORD });
        console.log(`✅ Login successful for ${agent.session?.handle}!`);
    } catch (err) {
        console.error('❌ Login failed:', err.message);
        if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
        process.exit(1);
    }
}

// --- Main Menu ---
async function mainMenu() {
    try {
        const { task } = await inquirer.prompt([{
            type: 'list', name: 'task', message: 'What would you like to do?',
            choices: [
                { name: '1) Create New Post', value: 'create' },
                { name: '2) Manage Posts (List/View/Edit/Delete)', value: 'manage' },
                { name: '3) Export All Posts to JSON', value: 'export' },
                new inquirer.Separator(),
                { name: '4) Exit', value: 'exit' }
            ], loop: false
        }]);
        switch (task) {
            case 'create': await createPost(); break;
            case 'manage': await managePosts(); break;
            case 'export': await exportPosts(); break;
            case 'exit': console.log('\n👋 Bye!'); process.exit(0);
        }
    } catch (error) {
        if (error.isTtyError) { console.error("\n❌ Prompt couldn't be rendered in this environment."); }
        else if (error.message?.includes('canceled')) { console.log('\nOperation cancelled. Exiting.'); process.exit(0); }
        else { console.error("\n❌ An unexpected error occurred:", error.message, error.stack); }
        process.exit(1);
    }
    await mainMenu(); // Loop back to main menu
}

// --- Character Limit Validation ---
function validateCharacterLimit(limit) {
    return (input) => (input && input.length > limit) ? `Input cannot exceed ${limit} characters.` : true;
}

// --- Function to handle field input with clear option and validation ---
async function promptForField(field, currentPostData = {}) {
    const isRequired = requiredFields.includes(field);
    const isOptional = optionalFields.includes(field);
    let currentValue = currentPostData[field];
    let currentCommentUrlInput = field === 'bskyCommentsPostUri' ? currentPostData.bskyCommentsPostUriInput || currentPostData.bskyCommentsPostUri : undefined;

    // Prepare prompt configuration
    let promptConfig = {
        type: 'input', // Default type
        name: 'value',
        message: `Enter ${field}${isOptional ? ` (or type '${CLEAR_INPUT_COMMAND}' to clear)` : ''}:`,
        default: undefined // Set default later based on type and current value
    };

    // Handle specific field types and defaults
    if (field === 'tags') {
        promptConfig.default = Array.isArray(currentValue) ? currentValue.join(', ') : (currentValue || '');
    } else if (field === 'publishedAt' || field === 'updatedAt') {
        promptConfig.default = formatDateToCustomString(currentValue) || (field === 'publishedAt' && !currentValue ? formatDateToCustomString(new Date()) : '');
    } else if (field === 'bskyCommentsPostUri') {
        promptConfig.default = currentCommentUrlInput || ''; // Show raw input URL if available for edit
    } else if (field === 'authorHandle') {
        promptConfig.default = currentValue || agent.session?.handle; // Default to logged-in user
    } else if (field === 'recommended') {
        promptConfig.type = 'confirm';
        promptConfig.message = 'Is this a Recommended Post?';
        promptConfig.default = currentValue === true; // Default based on current boolean value
    } else if (field === 'content') {
        promptConfig.type = 'editor';
        promptConfig.message = `Enter ${field}:`; // No clear command for editor
        promptConfig.default = currentValue || '';
    } else {
        // Default for standard text inputs
        promptConfig.default = currentValue !== undefined && currentValue !== null ? String(currentValue) : undefined;
    }

    // Add specific validations
    switch (field) {
        case 'shortDescription': promptConfig.validate = validateCharacterLimit(160); break; // Match frontend
        case 'category': promptConfig.validate = (input) => !input || !input.includes(',') || 'Category should be a single value (no commas).'; break;
        case 'slug': promptConfig.validate = validateSlug; break;
        case 'publishedAt': promptConfig.validate = (input) => !!parseCustomDateString(input) || `Invalid date format (Use: ${CUSTOM_DATE_FORMAT} or ISO)`; break;
        case 'updatedAt': promptConfig.validate = (input) => (input === CLEAR_INPUT_COMMAND || !input) || !!parseCustomDateString(input) || `Invalid date format (Use: ${CUSTOM_DATE_FORMAT} or ISO)`; break;
        case 'bskyCommentsPostUri': promptConfig.validate = (input) => (input === CLEAR_INPUT_COMMAND || !input) || input.startsWith('https://bsky.app/profile/') || input.startsWith('at://') || 'Enter a valid https://bsky.app/... URL, at:// URI, or leave blank/clear.'; break;
        case 'authorHandle': promptConfig.validate = (input) => (input?.trim() ? true : 'Author handle cannot be empty.'); break; // Basic check, real validation happens after
    }

    // Add required field validation (cannot be cleared)
    if (isRequired && field !== 'content' && field !== 'recommended') { // Editor/Confirm have implicit required handling
        const originalValidate = promptConfig.validate;
        promptConfig.validate = (input) => {
            if (!input?.trim()) return `❌ ${field} cannot be empty.`;
            return originalValidate ? originalValidate(input) : true;
        };
    } else if (isOptional && field !== 'content' && field !== 'recommended') { // Allow clear command for optional text fields
        const originalValidate = promptConfig.validate;
        promptConfig.validate = (input) => {
            if (input === CLEAR_INPUT_COMMAND) return true; // Allow clear command
            return originalValidate ? originalValidate(input) : true; // Otherwise, apply original validation
        };
    }

    // Prompt user
    let { value } = await inquirer.prompt([promptConfig]);

    // Handle clear command for optional fields
    if (isOptional && value === CLEAR_INPUT_COMMAND) {
        console.log(`   🧹 Clearing field: ${field}`);
        return Symbol.for('clear'); // Use Symbol to indicate clear action
    }

    // Sanitize slug immediately after input
    if (field === 'slug' && typeof value === 'string') {
        value = value.toLowerCase().trim().replace(/\s+/g, '-').replace(/[^\w-]+/g, '');
    }

    return value; // Return the entered value (or boolean for confirm)
}

// --- Create Post Function ---
async function createPost() {
    await login();
    let post = { $type: BLOG_POST_NSID };
    let authorProfile = null;
    let commentUrlInput = ''; // Track raw input for comment URL

    console.log("\n--- Create New Post ---");
    console.log(`(Default author: ${agent.session?.handle})`);

    // --- Initial data entry loop ---
    for (let field of inputFields) {
        if (field === 'updatedAt') continue; // Skip updatedAt during creation

        // Pass current post state for defaults (e.g., authorHandle)
        let value = await promptForField(field, post);

        // Handle 'clear' symbol for optional fields
        if (value === Symbol.for('clear')) {
            post[field] = null; // Set field to null if cleared
            if (field === 'bskyCommentsPostUri') commentUrlInput = '';
            if (field === 'tags') post.tags = []; // Special case for tags array
        } else {
            post[field] = value; // Store the actual value
            if (field === 'bskyCommentsPostUri') commentUrlInput = value; // Track raw input
        }

        // Handle author handle validation immediately
        if (field === 'authorHandle' && value !== null && value !== Symbol.for('clear')) {
            authorProfile = await validateHandleAndFetchProfile(value);
            while (!authorProfile) {
                console.log("   ❌ Invalid or non-existent handle. Please try again.");
                value = await promptForField(field, post); // Re-prompt
                if (value === Symbol.for('clear')) { // Should not happen for required field, but handle defensively
                    console.error("   ❌ Author Handle is required.");
                    continue; // Go back to re-prompt loop
                }
                post.authorHandle = value;
                authorProfile = await validateHandleAndFetchProfile(value);
            }
            // Store validated/canonical data
            post.authorDid = authorProfile.did;
            post.authorDisplayName = authorProfile.displayName;
            post.authorHandle = authorProfile.handle;
        }
    }

    // --- Post-Entry Review and Edit Loop ---
    let readyToSave = false;
    while (!readyToSave) {
        // Prepare review data
        const reviewData = {};
        for (const field of inputFields) {
            if (field === 'authorDid' || field === 'authorDisplayName') continue; // Don't show derived fields directly

            const value = post[field];
            if (field === 'tags') reviewData.tags = Array.isArray(value) ? value.join(', ') : '';
            else if (field === 'publishedAt' || field === 'updatedAt') reviewData[field] = formatDateToCustomString(value) || 'Not Set';
            else if (field === 'bskyCommentsPostUri') reviewData.bskyCommentsPostUri = commentUrlInput || 'None';
            else if (field === 'recommended') reviewData.recommended = value ? 'Yes' : 'No';
            else if (field === 'content') reviewData.content = value?.substring(0, 100) + (value?.length > 100 ? '...' : '');
            else reviewData[field] = (value === null || value === undefined) ? 'None' : value;
        }
        // Manually add derived author info for review
        reviewData.authorInfo = `${post.authorDisplayName || 'Unknown'} (@${post.authorHandle || 'unknown'})`;


        console.log('\n📄 Please review your post data:\n');
        console.log(JSON.stringify(reviewData, null, 2));
        console.log('---');

        const { action } = await inquirer.prompt([{
            type: 'list', name: 'action', message: 'Proceed?',
            choices: [
                { name: '💾 Save Post', value: 'save' },
                { name: '✏️ Edit a Field', value: 'edit' },
                { name: '❌ Cancel Creation', value: 'cancel' }
            ], loop: false
        }]);

        if (action === 'save') {
            // Final validation checks before allowing save
            const finalPublishedDate = parseCustomDateString(post.publishedAt);
            if (!isValid(finalPublishedDate)) {
                console.error("❌ Cannot save: Invalid Published Date. Please edit.");
            } else if (!post.authorDid || !post.authorHandle) {
                console.error("❌ Cannot save: Author information missing or invalid. Please edit author handle.");
            } else if (validateSlug(post.slug) !== true) {
                console.error(`❌ Cannot save: Invalid Slug: ${validateSlug(post.slug)}. Please edit.`);
            } else if (!post.title?.trim() || !post.shortDescription?.trim() || !post.category?.trim() || !post.content?.trim()) {
                console.error(`❌ Cannot save: One or more required text fields are empty (Title, Description, Category, Content). Please edit.`);
            } else {
                readyToSave = true; // All checks passed
            }
        } else if (action === 'edit') {
            const { fieldToEdit } = await inquirer.prompt([{
                type: 'list', name: 'fieldToEdit', message: 'Which field to edit?',
                choices: inputFields.filter(f => f !== '$type') // Allow editing all input fields
            }]);

            // Prepare context for prompt defaults
            let editContext = { ...post, bskyCommentsPostUriInput: commentUrlInput };
            const updatedValue = await promptForField(fieldToEdit, editContext);

            // Update post object based on prompt result
            if (updatedValue === Symbol.for('clear')) {
                post[fieldToEdit] = null; // Set field to null if cleared
                if (fieldToEdit === 'bskyCommentsPostUri') commentUrlInput = '';
                if (fieldToEdit === 'tags') post.tags = [];
            } else {
                post[fieldToEdit] = updatedValue; // Store the actual value
                if (fieldToEdit === 'bskyCommentsPostUri') commentUrlInput = updatedValue; // Track raw input
            }

            // Re-validate author handle if edited
            if (fieldToEdit === 'authorHandle' && updatedValue !== null && updatedValue !== Symbol.for('clear')) {
                const newProfile = await validateHandleAndFetchProfile(updatedValue);
                if (newProfile) {
                    post.authorDid = newProfile.did;
                    post.authorDisplayName = newProfile.displayName;
                    post.authorHandle = newProfile.handle;
                } else {
                    console.log("   ❌ Invalid handle. Author not updated. Please re-edit before saving.");
                    // Mark author as invalid implicitly by potentially clearing DID/DisplayName if needed
                    post.authorDid = null;
                    post.authorDisplayName = null;
                }
            }
        } else if (action === 'cancel') {
            console.log('\nPost creation cancelled.'); return;
        }
    }

    // --- Prepare final record for saving ---
    const finalPublishedDateISO = formatDateToISO(parseCustomDateString(post.publishedAt));
    // finalUpdatedAt is only relevant for edit, skipped here
    const finalCommentUri = await convertBskyUrlToAtUri(commentUrlInput); // Convert final raw input

    const recordToSave = {
        $type: BLOG_POST_NSID,
        createdAt: new Date().toISOString(), // Add createdAt for potential future use
        title: post.title.trim(),
        shortDescription: post.shortDescription.trim(),
        authorHandle: post.authorHandle, // Already validated/canonical
        authorDid: post.authorDid,
        authorDisplayName: post.authorDisplayName,
        slug: post.slug.trim(),
        category: post.category.trim(),
        content: post.content.trim(),
        publishedAt: finalPublishedDateISO,
        // Handle optional fields ensuring correct type or omission
        recommended: post.recommended === true, // Ensure boolean
        coverImage: (post.coverImage && post.coverImage.trim()) ? post.coverImage.trim() : undefined,
        tags: Array.isArray(post.tags) ? post.tags.map(t => t.trim()).filter(Boolean) : [],
        bskyCommentsPostUri: finalCommentUri || undefined, // Use converted URI or omit if null/invalid
        // 'updatedAt' is omitted for new posts
    };

    // Clean up undefined fields explicitly
    Object.keys(recordToSave).forEach(key => {
        if (recordToSave[key] === undefined) {
            delete recordToSave[key];
        }
    });

    // --- Attempt Save ---
    try {
        console.log('\n⏳ Creating post on Bluesky with final data...');
        // console.log(JSON.stringify(recordToSave, null, 2)); // Optional: Log full record before send
        const response = await agent.api.com.atproto.repo.createRecord({
            repo: agent.session.did,
            collection: BLOG_POST_NSID,
            record: recordToSave
        });
        console.log(`\n✅ Post created successfully!`);
        console.log(`   URI: ${response.data.uri}`);
        console.log(`   CID: ${response.data.cid}\n`);
    } catch (err) {
        console.error('\n❌ Failed to create post:', err.message);
        if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
        console.log("\nPost was not saved.");
    }
}

// --- Fetch Records with Pagination Info ---
async function fetchRecordPage(collection, limit = POSTS_PER_PAGE_CLI, cursor = undefined) {
    await login();
    console.log(`\n⏳ Fetching posts page... (Limit: ${limit}${cursor ? `, Cursor: ${cursor}` : ''})`);
    try {
        const res = await agent.api.com.atproto.repo.listRecords({
            repo: agent.session.did,
            collection: collection,
            limit: limit,
            cursor: cursor,
            reverse: true // Fetch newest first
        });
        console.log(`   Fetched ${res.data.records?.length || 0} posts for this page.`);
        return {
            records: res.data?.records || [],
            cursor: res.data.cursor // Pass cursor for next page
        };
    } catch (err) {
        console.error('\n❌ Failed to list records page:', err.message);
        if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
        return { records: [], cursor: undefined }; // Return empty on error
    }
}

// --- Display Post Details ---
async function displayPostDetails(record) {
    if (!record || !record.value) { console.error("❌ Error: Invalid post data provided."); return; }

    // Destructure with defaults
    const {
        title = 'N/A', shortDescription = 'N/A',
        authorDid = 'N/A', authorHandle = 'unknown', authorDisplayName = 'Unknown',
        slug = 'N/A', category = 'N/A', content = '(No content)',
        coverImage = null, tags = [],
        publishedAt = null, updatedAt = null,
        bskyCommentsPostUri = null, recommended = false
    } = record.value;

    const rkey = record.uri.split('/').pop();
    const profileUrl = `https://bsky.app/profile/${authorDid || authorHandle}`;

    console.log("\n--- Post Details ---");
    console.log(`Title:         ${title}`);
    console.log(`Slug:          ${slug}`);
    console.log(`Category:      ${category}`);
    console.log(`Author:        ${authorDisplayName} (@${authorHandle})`);
    console.log(`   DID:        ${authorDid}`);
    console.log(`   Profile:    ${profileUrl}`);
    console.log(`Published:     ${formatDateToCustomString(publishedAt) || 'N/A'}`);
    if (updatedAt) console.log(`Updated:       ${formatDateToCustomString(updatedAt)}`);
    console.log(`Recommended:   ${recommended ? 'Yes ⭐' : 'No'}`);
    console.log(`Description:   ${shortDescription}`);
    console.log(`Cover Image:   ${coverImage || 'None'}`);
    console.log(`Tags:          ${Array.isArray(tags) && tags.length > 0 ? tags.join(', ') : 'None'}`);
    console.log(`Comments URI:  ${bskyCommentsPostUri || 'None'}`);
    console.log(`Record Key:    ${rkey}`);
    console.log(`Record URI:    ${record.uri}`);
    console.log(`Record CID:    ${record.cid}`);
    console.log(`\n--- Content ---\n${content}\n--- End of Content ---\n`);

    await inquirer.prompt([{ type: 'input', name: 'continue', message: 'Press Enter to return...' }]);
}


// --- Edit Post Function ---
async function editPost(postRecord) {
    await login();
    if (!postRecord || !postRecord.value || !postRecord.uri) {
        console.error("❌ Cannot edit: Invalid post record provided."); return;
    }

    // Deep copy to avoid modifying the original record object directly
    let postToEdit = JSON.parse(JSON.stringify(postRecord.value));
    // Ensure $type is present if needed by API, though putRecord might not strictly require it if collection/rkey are set
    postToEdit.$type = BLOG_POST_NSID;

    const rkey = postRecord.uri.split('/').pop();
    if (!rkey) { console.error("❌ Error: Could not determine rkey from post URI."); return; }

    // Store raw comment URI input separately for editing prompt default
    let commentUrlInput = postToEdit.bskyCommentsPostUri || '';

    let editingFinished = false;
    while (!editingFinished) {
        // Prepare data for review display
        const reviewData = {};
        for (const field of inputFields) {
            if (field === 'authorDid' || field === 'authorDisplayName') continue;

            const value = postToEdit[field];
            if (field === 'tags') reviewData.tags = Array.isArray(value) ? value.join(', ') : '';
            else if (field === 'publishedAt' || field === 'updatedAt') reviewData[field] = formatDateToCustomString(value) || 'Not Set';
            else if (field === 'bskyCommentsPostUri') reviewData.bskyCommentsPostUri = commentUrlInput || 'None';
            else if (field === 'recommended') reviewData.recommended = value ? 'Yes' : 'No';
            else if (field === 'content') reviewData.content = value?.substring(0, 100) + (value?.length > 100 ? '...' : '');
            else reviewData[field] = (value === null || value === undefined) ? 'None' : value;
        }
        reviewData.authorInfo = `${postToEdit.authorDisplayName || 'Unknown'} (@${postToEdit.authorHandle || 'unknown'})`;

        console.log('\n✏️ Current post data to edit:\n');
        console.log(JSON.stringify(reviewData, null, 2));
        console.log('---');

        // Create choices for editing, plus Save/Cancel
        const editChoices = inputFields
            .filter(f => f !== '$type') // Don't allow editing $type
            .map(f => ({ name: `Edit ${f}`, value: f }));

        const { action } = await inquirer.prompt([{
            type: 'list', name: 'action', message: 'Choose action:',
            choices: [
                ...editChoices,
                new inquirer.Separator(),
                { name: '💾 Save Changes', value: 'save' },
                { name: '↩️ Discard Changes & Return', value: 'cancel' }
            ], loop: false
        }]);

        if (action === 'save') {
            // --- Final validation and processing before save ---
            let finalPublishedAtISO = null; let finalUpdatedAtISO = null; let finalCommentUri = null;

            // Validate PublishedAt
            const parsedPublishedDate = parseCustomDateString(postToEdit.publishedAt);
            if (isValid(parsedPublishedDate)) { finalPublishedAtISO = formatDateToISO(parsedPublishedDate); }
            else { console.error("❌ Cannot save: Invalid Published Date format. Please edit."); continue; } // Re-prompt action
            postToEdit.publishedAt = finalPublishedAtISO; // Store ISO

            // Process updatedAt: Use input if valid, otherwise set to now
            const parsedUpdateDate = parseCustomDateString(postToEdit.updatedAt); // Check if user provided a valid date
            if (postToEdit.updatedAt && isValid(parsedUpdateDate)) { // User provided a valid date
                finalUpdatedAtISO = formatDateToISO(parsedUpdateDate);
            } else { // Input was invalid, cleared, or null - set to current time
                finalUpdatedAtISO = formatDateToISO(new Date());
                console.log("   ℹ️ Setting 'updatedAt' to current time.");
            }
            postToEdit.updatedAt = finalUpdatedAtISO; // Store ISO

            // Process comment URI: Convert raw input or use null
            finalCommentUri = await convertBskyUrlToAtUri(commentUrlInput); // Convert final raw input
            postToEdit.bskyCommentsPostUri = finalCommentUri || undefined; // Use converted or omit if invalid/cleared

            // Ensure tags are array
            if (typeof postToEdit.tags === 'string') {
                postToEdit.tags = postToEdit.tags ? postToEdit.tags.split(',').map(t => t.trim()).filter(Boolean) : [];
            } else if (!Array.isArray(postToEdit.tags)) {
                postToEdit.tags = []; // Ensure it's an array (even if empty)
            } else {
                // Ensure tags in array are trimmed and non-empty
                postToEdit.tags = postToEdit.tags.map(t => t.trim()).filter(Boolean);
            }

            // Check required author fields were populated correctly
            if (!postToEdit.authorDid || !postToEdit.authorHandle) {
                console.error("❌ Cannot save: Author information missing or invalid. Edit 'authorHandle'."); continue; // Re-prompt action
            }
            // Validate slug
            if (validateSlug(postToEdit.slug) !== true) {
                console.error(`❌ Cannot save: Invalid Slug: ${validateSlug(postToEdit.slug)}. Please edit.`); continue; // Re-prompt action
            }
            // Validate other required text fields
            if (!postToEdit.title?.trim() || !postToEdit.shortDescription?.trim() || !postToEdit.category?.trim() || !postToEdit.content?.trim()) {
                console.error(`❌ Cannot save: One or more required text fields are empty (Title, Description, Category, Content). Please edit.`); continue; // Re-prompt action
            }


            // Final record prep for putRecord
            const recordToSave = { ...postToEdit };
            recordToSave.recommended = recordToSave.recommended === true; // Ensure boolean
            if (!recordToSave.coverImage || recordToSave.coverImage === '') delete recordToSave.coverImage;
            if (!recordToSave.bskyCommentsPostUri) delete recordToSave.bskyCommentsPostUri;

            // --- Attempt Save ---
            try {
                console.log('\n⏳ Saving changes to Bluesky...');
                // console.log(JSON.stringify(recordToSave, null, 2)); // Optional: Log full record
                const response = await agent.api.com.atproto.repo.putRecord({
                    repo: agent.session.did,
                    collection: BLOG_POST_NSID,
                    rkey: rkey,
                    record: recordToSave
                });
                console.log(`\n✅ Post updated successfully!`);
                console.log(`   URI: ${response.data.uri}`);
                console.log(`   CID: ${response.data.cid}\n`);
                editingFinished = true; // Exit edit loop
            } catch (err) {
                console.error('\n❌ Failed to update post:', err.message);
                if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
                const { retry } = await inquirer.prompt([{ type: 'confirm', name: 'retry', message: 'Try saving again?', default: false }]);
                if (!retry) {
                    console.log("\nChanges not saved.");
                    editingFinished = true; // Exit edit loop even on failed save if user doesn't retry
                }
                // If retry, loop continues
            }

        } else if (action === 'cancel') {
            console.log('\nEdit cancelled. Changes discarded.');
            editingFinished = true;
        } else {
            // Handle editing a specific field (action is the field name)
            const fieldToEdit = action;
            let editContext = { ...postToEdit, bskyCommentsPostUriInput: commentUrlInput };
            const updatedValue = await promptForField(fieldToEdit, editContext);

            // Update postToEdit state based on prompt result
            if (updatedValue === Symbol.for('clear')) {
                postToEdit[fieldToEdit] = null;
                if (fieldToEdit === 'bskyCommentsPostUri') commentUrlInput = '';
                if (fieldToEdit === 'tags') postToEdit.tags = [];
            } else {
                postToEdit[fieldToEdit] = updatedValue;
                if (fieldToEdit === 'bskyCommentsPostUri') commentUrlInput = updatedValue;
            }

            // Re-validate author handle if edited
            if (fieldToEdit === 'authorHandle' && updatedValue !== null && updatedValue !== Symbol.for('clear')) {
                const newProfile = await validateHandleAndFetchProfile(updatedValue);
                if (newProfile) {
                    postToEdit.authorDid = newProfile.did;
                    postToEdit.authorDisplayName = newProfile.displayName;
                    postToEdit.authorHandle = newProfile.handle;
                    console.log(`   ✅ Author updated to: ${postToEdit.authorDisplayName} (${postToEdit.authorHandle})`);
                } else {
                    console.log("   ❌ Invalid handle. Author not updated. Please re-edit before saving.");
                    // Clear derived fields if validation fails to force user correction
                    postToEdit.authorDid = null;
                    postToEdit.authorDisplayName = null;
                }
            }
        }
    }
}


// --- Manage Posts (List with Pagination) ---
async function managePosts() {
    await login();
    let currentCursor = undefined;
    let currentPageRecords = [];
    let pageNumber = 1;
    let history = []; // To store previous cursors for going back

    while (true) { // Loop for pagination
        const { records, cursor: nextCursor } = await fetchRecordPage(BLOG_POST_NSID, POSTS_PER_PAGE_CLI, currentCursor);
        currentPageRecords = records; // Store records for the current page

        if (currentPageRecords.length === 0 && pageNumber === 1) {
            console.log('\n-- No posts found. --\n');
            return; // Go back to main menu if no posts at all
        }

        console.log(`\n--- Manage Posts (Page ${pageNumber}, Newest First) ---`);
        currentPageRecords.forEach((record, i) => {
            const title = record.value?.title ?? 'Untitled';
            const date = formatDateToCustomString(record.value?.publishedAt) || 'No Date';
            const category = record.value?.category || 'Uncategorized';
            const rkey = record.uri.split('/').pop();
            console.log(`${i + 1}) ${title} [${category}] (${date}) (rkey: ${rkey})`);
        });
        console.log('---');

        // Build choices for this page
        const choices = currentPageRecords.map((record, i) => ({
            name: `${i + 1}) ${record.value?.title ?? 'Untitled'}`,
            value: i // Use index within the current page
        }));

        choices.push(new inquirer.Separator());

        // Pagination controls
        if (pageNumber > 1) {
            choices.push({ name: '< Previous Page', value: 'prev' });
        }
        if (nextCursor) {
            choices.push({ name: '> Next Page', value: 'next' });
        }
        choices.push({ name: '↩️ Back to Main Menu', value: 'back' });

        // Prompt user for action on the current page
        const { selection } = await inquirer.prompt([{
            type: 'list',
            name: 'selection',
            message: 'Select post to manage, navigate pages, or go back:',
            choices: choices,
            pageSize: POSTS_PER_PAGE_CLI + 5 // Show more choices in the list
        }]);

        // Handle navigation or exit
        if (selection === 'next') {
            if (nextCursor) {
                history.push(currentCursor); // Save current cursor before moving next
                currentCursor = nextCursor;
                pageNumber++;
                // Continue loop to fetch and display next page
            } else {
                console.log("Already on the last page.");
                // Loop continues, re-displaying current page
            }
        } else if (selection === 'prev') {
            if (history.length > 0) {
                currentCursor = history.pop(); // Get previous cursor
                pageNumber--;
                // Continue loop to fetch and display previous page
            } else {
                console.log("Already on the first page.");
                // Loop continues, re-displaying current page
            }
        } else if (selection === 'back') {
            console.log("Returning to main menu...");
            return; // Exit the managePosts loop
        } else {
            // User selected a post (selection is the index)
            const selectedRecord = currentPageRecords[selection];
            if (!selectedRecord) {
                console.error("❌ Invalid selection on page.");
                continue; // Re-display current page and prompt again
            }

            // --- Actions for the selected post ---
            const { action } = await inquirer.prompt([{
                type: 'list',
                name: 'action',
                message: `Selected: "${selectedRecord.value?.title ?? 'Untitled'}". Action?`,
                choices: [
                    { name: '👁️ View Details', value: 'view' },
                    { name: '✏️ Edit Post', value: 'edit' },
                    { name: '🗑️ Delete Post', value: 'delete' },
                    { name: '↩️ Cancel (Back to List)', value: 'cancel_action' }
                ], loop: false
            }]);

            switch (action) {
                case 'view':
                    await displayPostDetails(selectedRecord);
                    // Loop continues, re-displaying current page after viewing
                    break;
                case 'edit':
                    await editPost(selectedRecord);
                    // After editing, force refetch of the *current* page to show changes
                    // Reset cursor history relevant to this point? Maybe simpler to just refetch current.
                    console.log("Refreshing current page after edit...");
                    // Keep currentCursor, pageNumber, history as they are
                    continue; // Re-fetch and display the same page
                case 'delete':
                    const { confirmDelete } = await inquirer.prompt([{
                        type: 'confirm',
                        name: 'confirmDelete',
                        message: `Permanently delete "${selectedRecord.value?.title ?? 'Untitled'}"?`,
                        default: false
                    }]);
                    if (confirmDelete) {
                        const rkey = selectedRecord.uri.split('/').pop();
                        const title = selectedRecord.value?.title ?? 'Untitled';
                        if (!rkey) { console.error(`❌ Rkey error for "${title}". Cannot delete.`); }
                        else {
                            try {
                                console.log(`\n⏳ Deleting post: "${title}" (rkey: ${rkey})...`);
                                await agent.api.com.atproto.repo.deleteRecord({
                                    repo: agent.session.did,
                                    collection: BLOG_POST_NSID,
                                    rkey: rkey
                                });
                                console.log(`✅ Deleted successfully!`);
                            } catch (err) {
                                console.error(`❌ Failed to delete "${title}" (rkey: ${rkey}):`, err.message);
                                if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
                            }
                        }
                        // After deleting, force refetch of the *current* page
                        console.log("Refreshing current page after delete...");
                        continue; // Re-fetch and display the same page
                    } else {
                        console.log("Deletion cancelled.");
                        // Loop continues, re-displaying current page
                    }
                    break;
                case 'cancel_action':
                    // Just continue the loop to re-display the current page list
                    break;
            }
        }
    } // End while loop for pagination
}


// --- Fetch ALL Records (for export) ---
async function fetchAllRecords(collection) {
    await login();
    let allRecords = [];
    let cursor;
    console.log(`\n⏳ Fetching ALL records from collection '${collection}' for export...`);
    let page = 1;
    do {
        console.log(`   Fetching page ${page}...`);
        try {
            const res = await agent.api.com.atproto.repo.listRecords({
                repo: agent.session.did,
                collection: collection,
                limit: 100, // Use max limit for export efficiency
                cursor: cursor,
                reverse: true // Keep consistent order
            });
            if (res.data && res.data.records) {
                allRecords = allRecords.concat(res.data.records);
                cursor = res.data.cursor;
                console.log(`   Fetched ${res.data.records.length}. Total so far: ${allRecords.length}`);
            } else {
                console.log("   No more records found or unexpected response.");
                cursor = undefined;
            }
        } catch (err) {
            console.error('\n❌ Failed during record fetching:', err.message);
            if (err.response?.data?.message) console.error('   Server message:', err.response.data.message);
            cursor = undefined; // Stop fetching on error
            return []; // Return empty array indicating failure
        }
        page++;
    } while (cursor);
    console.log(`✅ Total records fetched for export: ${allRecords.length}`);
    return allRecords;
}


// --- Export All Posts ---
async function exportPosts() {
    await login();
    const records = await fetchAllRecords(BLOG_POST_NSID); // Fetch all

    if (!records || records.length === 0) {
        console.log('\n-- No posts found to export. --\n');
        return;
    }

    console.log(`\n📦 Preparing export data for ${records.length} posts...`);
    const exportData = records.map(record => ({
        uri: record.uri,
        cid: record.cid,
        value: record.value // Export the full value object
    }));

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = path.join(__dirname, `bluesky_blog_export_${timestamp}.json`);

    try {
        const jsonString = JSON.stringify(exportData, null, 2); // Pretty print
        await fs.writeFile(filename, jsonString, 'utf8');
        console.log(`\n✅ Successfully exported ${exportData.length} posts to:\n   ${filename}\n`);
    } catch (err) {
        console.error(`\n❌ Failed to write export file (${filename}):`, err.message);
    }
}


// --- Main Execution ---
(async () => {
    console.clear(); // Clear console on start
    console.log("--- Bluesky AT Pages Manager (CLI) ---");
    try {
        await login(); // Login initially
        await mainMenu(); // Start the main menu loop
    } catch (error) {
        // Catch potential errors during initial login or if mainMenu throws unexpectedly
        if (error.isTtyError) { console.log("\nPrompt couldn't be rendered in this environment."); }
        else if (error.message?.includes('canceled')) { console.log('\nOperation cancelled during startup. Exiting.'); process.exit(0); }
        else { console.error("🚨 A critical error occurred during startup:", error.message, error.stack); }
        process.exit(1);
    }
})();

// --- END OF FILE blog-manager.mjs ---