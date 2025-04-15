// js/api.js
import { BskyAgent, AtUri } from '@atproto/api';
import { BLOG_POST_NSID, POSTS_PER_PAGE } from './config.js'; // Added POSTS_PER_PAGE
import { formatDateToISO } from './utils.js';
import { getAgent, getSession } from './state.js';

// --- Authentication ---
export async function performLogin(service, identifier, password) {
    const agent = new BskyAgent({ service });
    await agent.login({ identifier, password });
    const sessionData = { ...agent.session, service: agent.service.toString() };
    // console.debug("Login successful, session data:", sessionData); // Removed
    return { agent, session: sessionData };
}
export async function resumeSession(storedSession) {
    const serviceUrl = storedSession.service || 'https://bsky.social';
    const agent = new BskyAgent({ service: serviceUrl });
    // console.debug(`Attempting to resume session on ${serviceUrl} with DID: ${storedSession.did}`); // Removed
    await agent.resumeSession(storedSession);
    if (!agent.session?.did) {
        throw new Error("Resume session did not result in an active session.");
    }
    const refreshedSessionData = { ...agent.session, service: agent.service.toString() };
    // console.debug("Session resumed successfully, session data:", refreshedSessionData); // Removed
    return { agent, session: refreshedSessionData };
}


// --- Blog Post CRUD ---

export async function fetchBlogPostsBatch(limit = POSTS_PER_PAGE, cursor = undefined) {
    const agent = getAgent();
    const session = getSession();
    if (!agent || !session?.did) throw new Error("Not logged in");

    // console.debug(`Fetching post batch... Repo: ${session.did}, Collection: ${BLOG_POST_NSID}, Limit: ${limit}, Cursor: ${cursor || 'start'}`); // Removed

    try {
        const res = await agent.api.com.atproto.repo.listRecords({
            repo: session.did,
            collection: BLOG_POST_NSID,
            limit: limit,
            cursor: cursor,
            reverse: true // Fetch newest first consistently from API
        });

        // console.debug(`API listRecords Batch Response (Cursor: ${res.data.cursor || 'none'}):`, res.data.records.length, "records"); // Removed

        // Return both records and the new cursor for the next request
        return {
            records: res.data?.records || [],
            cursor: res.data.cursor // Will be undefined if it's the last page
        };

    } catch (error) {
        console.error("Error fetching posts batch:", error); // Keep error log
        throw new Error(`Failed to fetch posts batch: ${error.message || 'Unknown error'}`);
    }
}

export async function saveBlogPostRecord(recordData, rkey = null) {
    const agent = getAgent();
    const session = getSession();
    if (!agent || !session?.did) throw new Error("Not logged in");

    recordData.$type = BLOG_POST_NSID;
    recordData.recommended = recordData.recommended === true;
    // Dates are expected to be ISO strings already from state.js/utils.js

    if (!rkey) { delete recordData.updatedAt; }
    else if (!recordData.updatedAt) { recordData.updatedAt = formatDateToISO(new Date()); }

    Object.keys(recordData).forEach(key => { if (recordData[key] === undefined) delete recordData[key]; });
    if (recordData.tags && !Array.isArray(recordData.tags)) {
        recordData.tags = typeof recordData.tags === 'string' ? recordData.tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    } else if (!recordData.tags) { recordData.tags = []; }

    // console.debug(`Saving record (Rkey: ${rkey || 'NEW'}):`, JSON.stringify(recordData, null, 2)); // Removed
    try {
        if (rkey) { // Update
            const response = await agent.api.com.atproto.repo.putRecord({ repo: session.did, collection: BLOG_POST_NSID, rkey: rkey, record: recordData });
            return response.data;
        } else { // Create
            const response = await agent.api.com.atproto.repo.createRecord({ repo: session.did, collection: BLOG_POST_NSID, record: recordData });
            return response.data;
        }
    } catch (error) {
        console.error(`Failed to ${rkey ? 'update' : 'create'} record:`, error); // Keep error log
        let errMsg = `Failed to ${rkey ? 'update' : 'create'} post: ${error.response?.data?.message || error.message || 'Unknown error'}`;
        if (error.status) errMsg += ` (Status: ${error.status})`;
        throw new Error(errMsg);
    }
}
export async function deleteBlogPostRecord(uri) {
    const agent = getAgent();
    const session = getSession();
    if (!agent || !session?.did) throw new Error("Not logged in");
    if (!uri) throw new Error("No URI provided for deletion");
    const uriObject = new AtUri(uri);
    if (uriObject.hostname !== session.did) throw new Error(`Record repo mismatch`);
    // console.debug(`Deleting post record: ${uri}...`); // Removed
    try {
        await agent.api.com.atproto.repo.deleteRecord({ repo: session.did, collection: uriObject.collection, rkey: uriObject.rkey });
        // console.debug(`Deletion successful: ${uri}`); // Removed
    } catch (error) {
        console.error(`Failed to delete record ${uri}:`, error); // Keep error log
        let errMsg = `Failed to delete post: ${error.response?.data?.message || error.message || 'Unknown error'}`;
        if (error.status) errMsg += ` (Status: ${error.status})`;
        throw new Error(errMsg);
    }
}