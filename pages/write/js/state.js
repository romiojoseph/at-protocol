// js/state.js
import * as api from './api.js';
import * as ui from './ui.js';
import * as utils from './utils.js';
import * as config from './config.js'; // Keep config import

// --- Private State Variables ---
let _agent = null;
let _session = null;
let _fetchedPostsCache = []; // Holds ALL posts fetched so far
let _cursor = undefined; // For pagination
let _isLoadingMore = false; // Prevent concurrent loads
let _allPostsLoaded = false; // Track if all posts are loaded

// Filtering/Sorting State
let _searchTerm = '';
let _filterCategory = '';
let _sortOrder = 'newest'; // Default sort order
let _uniqueCategories = new Set(); // Store unique actual categories from posts

// --- State Getters ---
export function getAgent() { return _agent; }
export function getSession() { return _session; }
export function getFetchedPostsCache() { return _fetchedPostsCache; }
export function getCurrentCursor() { return _cursor; }
export function getIsLoadingMore() { return _isLoadingMore; }
export function getAllPostsLoaded() { return _allPostsLoaded; }
export function getSearchTerm() { return _searchTerm; }
export function getFilterCategory() { return _filterCategory; }
export function getSortOrder() { return _sortOrder; }

export function getUniqueCategories() {
    const actualCategories = Array.from(_uniqueCategories).sort();
    const hasRecommended = _fetchedPostsCache.some(post => post?.value?.recommended === true);
    if (hasRecommended) {
        if (!actualCategories.includes("Recommended")) {
            return ["Recommended", ...actualCategories];
        }
    }
    return actualCategories;
}

// --- State Setters/Modifiers ---
function setAgent(newAgent) { _agent = newAgent; }
function setSession(newSession) { _session = newSession; }

function appendPostsToCache(newPosts) {
    if (!Array.isArray(newPosts)) return;
    const existingUris = new Set(_fetchedPostsCache.map(p => p.uri));
    const postsToAdd = newPosts.filter(p => !existingUris.has(p.uri));
    _fetchedPostsCache = _fetchedPostsCache.concat(postsToAdd);
}

function resetPostsCacheAndPagination() {
    _fetchedPostsCache = [];
    _cursor = undefined;
    _allPostsLoaded = false;
    _isLoadingMore = false;
    _uniqueCategories.clear();
}

function setCursor(newCursor) { _cursor = newCursor; }
function setIsLoadingMore(loading) { _isLoadingMore = loading; }
function setAllPostsLoaded(loaded) { _allPostsLoaded = loaded; }
function setSearchTerm(term) { _searchTerm = term.trim(); }
function setFilterCategory(category) { _filterCategory = category; }
function setSortOrder(order) { _sortOrder = order; }

function updateUniqueCategories(posts) {
    if (!Array.isArray(posts)) return;
    let updated = false;
    posts.forEach(post => {
        const category = post?.value?.category?.trim();
        if (category && category !== "Recommended" && !_uniqueCategories.has(category)) {
            _uniqueCategories.add(category);
            updated = true;
        }
    });
    if (updated) {
        ui.populateCategoryFilter(getUniqueCategories());
    } else if (_fetchedPostsCache.length > 0 && getEl('category-filter')?.options.length <= 1) {
        ui.populateCategoryFilter(getUniqueCategories());
    }
}

// --- Core Application Logic ---

export async function handleLogin(event) {
    ui.clearStatus();
    const handle = document.getElementById('handle').value;
    const password = document.getElementById('appPassword').value;
    if (!handle || !password) {
        ui.showStatus("Handle and App Password are required.", 'error');
        return;
    }
    ui.showLoading("Logging in...");
    try {
        const { agent: loggedInAgent, session: loggedInSession } = await api.performLogin('https://bsky.social', handle, password);
        setAgent(loggedInAgent);
        setSession(loggedInSession);
        saveSessionToLocal(loggedInSession, true); // Pass flag to mark as initial login
        ui.showApp();
        await loadInitialData(); // Load first page
    } catch (err) {
        console.error("Login error:", err);
        const errorMsg = err.response?.data?.message || err.message || "An unknown error occurred.";
        ui.showStatus(`Login Failed: ${errorMsg}`, 'error');
        clearLocalSessionData();
        setAgent(null); setSession(null);
        ui.showLogin();
    } finally {
        // ui.hideLoading(); // Moved to loadInitialData finally block
        document.getElementById('appPassword').value = '';
    }
}

export function handleLogout() {
    ui.showLoading("Logging out...");
    clearLocalSessionData();
    setAgent(null); setSession(null);
    resetPostsCacheAndPagination();
    setSearchTerm('');
    setFilterCategory('');
    setSortOrder('newest');
    ui.clearStatus();
    ui.hidePostForm(); ui.hidePostDetails();
    ui.showLogin();
    ui.renderPostList();
    ui.updateListControls('');
    ui.populateCategoryFilter([]);
    ui.updateLoadMoreButton();
    ui.hideLoading();
}

export async function attemptResumeSession() {
    let storedSessionData = loadSessionFromLocal();
    if (!storedSessionData || !storedSessionData.session) return false;

    if (storedSessionData.initialLoginAt) {
        const sessionAgeMillis = Date.now() - storedSessionData.initialLoginAt;
        const maxAgeMillis = config.SESSION_MAX_AGE_HOURS * 60 * 60 * 1000;
        if (sessionAgeMillis > maxAgeMillis) {
            console.warn(`Strict session timeout reached (logged in at ${new Date(storedSessionData.initialLoginAt).toISOString()}). Max age: ${config.SESSION_MAX_AGE_HOURS} hours. Clearing stored data.`);
            clearLocalSessionData();
            ui.showStatus("Session expired. Please log in again.", 'warning');
            return false;
        }
    } else {
        console.warn("Session data found without initial login timestamp. Forcing logout.");
        clearLocalSessionData();
        ui.showStatus("Session data format updated. Please log in again.", 'warning');
        return false;
    }

    ui.showLoading("Resuming session...");
    try {
        const { agent: resumedAgent, session: resumedSession } = await api.resumeSession(storedSessionData.session);
        setAgent(resumedAgent);
        setSession(resumedSession);
        saveSessionToLocal(resumedSession, false, storedSessionData.initialLoginAt);
        ui.showApp();
        await loadInitialData(); // Load data after resume
        return true;
    } catch (err) {
        // ui.hideLoading(); // Moved to loadInitialData finally block
        console.warn("Failed to resume session with API:", err.message);
        clearLocalSessionData();
        ui.showStatus("Session invalid or expired. Please log in again.", 'error');
        setAgent(null); setSession(null);
        // Make sure to hide loading overlay even on resume failure
        ui.hideLoading();
        return false;
    }
}

// --- Local Storage Helpers ---
function saveSessionToLocal(sessionData, isInitialLogin = false, existingInitialLoginAt = null) {
    try {
        const now = Date.now();
        const dataToStore = {
            session: sessionData,
            savedAt: now,
            initialLoginAt: isInitialLogin ? now : existingInitialLoginAt
        };
        if (!isInitialLogin && !dataToStore.initialLoginAt) {
            console.warn("Attempted to preserve null initialLoginAt during session save. Setting to current time.");
            dataToStore.initialLoginAt = now;
        }
        localStorage.setItem(config.LOCALSTORAGE_SESSION_KEY, JSON.stringify(dataToStore));
    } catch (e) {
        console.error("Failed save session:", e);
        ui.showStatus("Warning: Couldn't save session.", 'warning');
    }
}

function loadSessionFromLocal() {
    try {
        const s = localStorage.getItem(config.LOCALSTORAGE_SESSION_KEY);
        return s ? JSON.parse(s) : null;
    } catch (e) {
        console.error("Failed load session:", e);
        clearLocalSessionData();
        return null;
    }
}

function clearLocalSessionData() {
    localStorage.removeItem(config.LOCALSTORAGE_SESSION_KEY);
}


// *** MODIFIED loadInitialData ***
export async function loadInitialData() {
    // Don't show overlay here, let login/resume handle it initially
    // ui.showLoading("Loading initial posts...");
    resetPostsCacheAndPagination();
    ui.renderPostList(); // Render empty list initially
    ui.updateLoadMoreButton(); // Update button state

    try {
        await fetchAndAppendPosts(); // Fetch the first batch
        ui.populateCategoryFilter(getUniqueCategories()); // Populate filters based on fetched data (if any)
    } catch (error) {
        console.error("Failed to load initial posts:", error);
        ui.showStatus(`Error loading posts: ${error.message}`, 'error');
        // Ensure state is clean even on error during initial load
        resetPostsCacheAndPagination();
        // ui.renderPostList(); // Called below in finally
        ui.updateLoadMoreButton();
    } finally {
        // *** Crucial Change: Render list *after* fetch attempt completes and before hiding overlay ***
        ui.renderPostList();
        ui.hideLoading(); // Hide loading overlay *after* everything is done
    }
}
// *** END MODIFIED loadInitialData ***

async function fetchAndAppendPosts(cursor = undefined) {
    if (_isLoadingMore) {
        console.warn("Already loading more posts, request ignored.");
        return;
    }
    setIsLoadingMore(true);
    ui.updateLoadMoreButton(); // Show button as loading (if visible)

    try {
        const { records: batchPosts, cursor: newCursor } = await api.fetchBlogPostsBatch(config.POSTS_PER_PAGE, cursor);

        appendPostsToCache(batchPosts);
        setCursor(newCursor);
        updateUniqueCategories(batchPosts);

        if (!newCursor || batchPosts.length < config.POSTS_PER_PAGE) {
            setAllPostsLoaded(true);
        } else {
            setAllPostsLoaded(false);
        }

        // Don't render here - let loadInitialData handle final render
        // ui.renderPostList();

    } catch (error) {
        console.error("Failed to fetch and append posts:", error);
        ui.showStatus(`Error fetching posts: ${error.message}`, 'error');
    } finally {
        setIsLoadingMore(false);
        // Update button state *after* loading flag is false
        ui.updateLoadMoreButton();
    }
}

// --- Action Handlers ---
// (handleDeletePost, handleSavePost, handleAuthorValidation, handleCommentUriValidation, handleExport, handleLoadMore, handleSearchChange, handleFilterChange, handleSortChange remain unchanged)

export async function handleDeletePost(uri) {
    const postToDelete = _fetchedPostsCache.find(p => p.uri === uri);
    const postTitle = postToDelete?.value?.title ?? uri;
    if (!confirm(`Are you sure you want to delete the post: "${postTitle}"? This cannot be undone.`)) {
        return;
    }
    ui.showLoading(`Deleting post: ${postTitle}...`);
    try {
        await api.deleteBlogPostRecord(uri);
        ui.showStatus(`Post "${postTitle}" deleted successfully.`, 'success');
        // Instead of full loadInitialData, just remove from cache and re-render
        _fetchedPostsCache = _fetchedPostsCache.filter(p => p.uri !== uri);
        _allPostsLoaded = false; // Assume we might need to load more later if applicable
        ui.renderPostList();
        ui.populateCategoryFilter(getUniqueCategories()); // Repopulate categories
        ui.updateLoadMoreButton(); // Update button
    } catch (err) {
        console.error(`Failed to delete post ${uri}:`, err);
        ui.showStatus(`Error deleting post: ${err.message}`, 'error');
    } finally {
        ui.hideLoading();
    }
}

export async function handleSavePost(event) {
    ui.clearStatus();
    const form = event.target;
    form.querySelectorAll('.invalid-input').forEach(el => el.classList.remove('invalid-input'));

    const slugInput = document.getElementById('slug');
    const finalSlug = utils.sanitizeSlug(slugInput.value, true);
    if (slugInput.value !== finalSlug) { slugInput.value = finalSlug; }

    const publishedAtValue = document.getElementById('publishedAt').value;
    const publishedAtDate = utils.parseDateTimeLocalString(publishedAtValue);
    const publishedAtISO = publishedAtDate ? utils.formatDateToISO(publishedAtDate) : null;
    if (!publishedAtISO) { ui.showStatus("Invalid 'Published At' date format.", 'error'); return; }

    const updatedAtValue = document.getElementById('updatedAt').value || null;
    let updatedAtISO = null;
    if (updatedAtValue) {
        const updatedAtDate = utils.parseDateTimeLocalString(updatedAtValue);
        updatedAtISO = updatedAtDate ? utils.formatDateToISO(updatedAtDate) : null;
        if (!updatedAtISO) { ui.showStatus("Invalid 'Updated At' date format.", 'error'); return; }
    }

    const commentUriValue = document.getElementById('bskyCommentsPostUri').value.trim() || null;
    let commentAtUri = null;
    if (commentUriValue) {
        commentAtUri = await utils.convertBskyUrlToAtUri(commentUriValue, document.getElementById('comment-uri-status'));
        if (commentAtUri === null && document.getElementById('comment-uri-status').classList.contains('error')) {
            ui.showStatus("Error processing comment URI.", 'error'); return;
        }
    }

    const rkey = document.getElementById('post-rkey').value || null;
    const recordData = {
        title: document.getElementById('title').value.trim(),
        shortDescription: document.getElementById('shortDescription').value.trim(),
        authorHandle: document.getElementById('authorHandle').value.trim(),
        authorDid: document.getElementById('authorDid').value,
        authorDisplayName: document.getElementById('authorDisplayName').value,
        slug: finalSlug,
        category: document.getElementById('category').value.trim(),
        content: document.getElementById('content').value.trim(),
        coverImage: document.getElementById('coverImage').value.trim() || undefined,
        tags: document.getElementById('tags').value.trim().split(',').map(t => t.trim().toLowerCase()).filter(Boolean),
        publishedAt: publishedAtISO,
        updatedAt: rkey ? (updatedAtISO || utils.formatDateToISO(new Date())) : undefined,
        bskyCommentsPostUri: commentAtUri,
        recommended: document.getElementById('recommended').checked
    };

    ui.showLoading(rkey ? "Updating post..." : "Creating post...");
    try {
        const savedPostData = await api.saveBlogPostRecord(recordData, rkey);
        ui.showStatus(`Post "${recordData.title}" ${rkey ? 'updated' : 'created'} successfully!`, 'success');
        ui.hidePostForm();

        // Smart cache update instead of full reload
        const newRecord = {
            uri: savedPostData.uri,
            cid: savedPostData.cid,
            value: { ...recordData, $type: config.BLOG_POST_NSID, createdAt: new Date().toISOString() } // Mimic structure
        };
        if (rkey) { // Replace existing
            _fetchedPostsCache = _fetchedPostsCache.map(p => p.uri === newRecord.uri ? newRecord : p);
        } else { // Add new (assuming newest first locally until next full load)
            _fetchedPostsCache.unshift(newRecord);
        }
        _allPostsLoaded = false; // Need to re-check if loading more later
        ui.renderPostList();
        ui.populateCategoryFilter(getUniqueCategories());
        ui.updateLoadMoreButton();

    } catch (err) {
        console.error('Failed to save post:', err);
        ui.showStatus(`Error saving post: ${err.message || 'Unknown error'}`, 'error');
    } finally {
        ui.hideLoading();
    }
}

export async function handleAuthorValidation() { const h = document.getElementById('authorHandle'), d = document.getElementById('authorDid'), n = document.getElementById('authorDisplayName'), s = document.getElementById('author-validation-status'); await utils.validateHandleAndFetchProfile(h.value, h, d, n, s); }
export async function handleCommentUriValidation() { const i = document.getElementById('bskyCommentsPostUri'), s = document.getElementById('comment-uri-status'); if (i.value.trim()) { await utils.convertBskyUrlToAtUri(i.value, s); } else { s.textContent = ''; s.className = ''; i.classList.remove('invalid-input'); } }

export async function handleExport() {
    const postsToExport = getFetchedPostsCache();
    if (!postsToExport || postsToExport.length === 0) {
        ui.showStatus("No posts available to export.", 'warning'); return;
    }
    ui.showLoading("Preparing export...");
    const sortedPosts = utils.getFilteredAndSortedPosts(postsToExport, '', '', getSortOrder());
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const success = ui.triggerJsonExport(sortedPosts, `bluesky_blog_export_${timestamp}.json`);
    ui.hideLoading();
    if (success) ui.showStatus(`Exported ${sortedPosts.length} posts (${getSortOrder()} first).`, 'success');
    else ui.showStatus("Failed to trigger export.", 'error');
}

export async function handleLoadMore() {
    if (_allPostsLoaded || _isLoadingMore) {
        return;
    }
    ui.showLoading("Loading more posts..."); // Show overlay for subsequent loads
    try {
        await fetchAndAppendPosts(_cursor); // Fetch next batch
        ui.renderPostList(); // Re-render after fetching more
        ui.populateCategoryFilter(getUniqueCategories());
    } finally {
        ui.hideLoading(); // Hide overlay
    }
}

export function handleSearchChange(searchTerm) {
    setSearchTerm(searchTerm);
    ui.renderPostList();
}

export function handleFilterChange(category) {
    setFilterCategory(category);
    ui.renderPostList();
}

export function handleSortChange(sortOrder) {
    setSortOrder(sortOrder);
    ui.renderPostList();
}


function getEl(id) { return document.getElementById(id); }