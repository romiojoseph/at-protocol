// js/ui.js
import { formatDateToCustomString, getFilteredAndSortedPosts, formatDateToDateTimeLocalString } from './utils.js'; // Import helpers
import * as state from './state.js';

// --- DOM Element Access ---
function getEl(id) { return document.getElementById(id); }

// --- Loading Overlay & Status Messages ---
export function showLoading(message = 'Loading...') { const o = getEl('loading-overlay'), m = getEl('loading-message'); if (m) m.textContent = message; if (o) o.classList.remove('hidden'); }
export function hideLoading() { const o = getEl('loading-overlay'); if (o) o.classList.add('hidden'); }
let statusTimeout;
export function showStatus(message, type = 'info') {
    const s = getEl('status-message');
    if (!s) return;
    s.textContent = message;
    s.className = `status ${type}`;
    s.classList.remove('hidden');
    clearTimeout(statusTimeout);
    if (type !== 'error') {
        // Increased success message display time from 3000 to 4000
        statusTimeout = setTimeout(() => {
            s.classList.add('hidden');
        }, type === 'success' ? 4000 : 4000);
    } else {
        statusTimeout = setTimeout(() => {
            s.classList.add('hidden');
        }, 7000);
    }
}
export function clearStatus() { const s = getEl('status-message'); if (s) { s.textContent = ''; s.classList.add('hidden'); s.className = 'status hidden'; clearTimeout(statusTimeout); } }

// --- View Switching ---
export function showLogin() { getEl('login-section').classList.remove('hidden'); getEl('app-section').classList.add('hidden'); getEl('user-info').classList.add('hidden'); getEl('app-section').classList.remove('form-active'); clearStatus(); }
export function showApp() { getEl('login-section').classList.add('hidden'); getEl('app-section').classList.remove('hidden'); getEl('user-info').classList.remove('hidden'); getEl('user-handle').textContent = state.getSession()?.handle ?? 'Unknown'; getEl('app-section').classList.remove('form-active'); clearStatus(); getEl('post-form-section').classList.add('hidden'); getEl('post-detail-section').classList.add('hidden'); getEl('post-list-section').classList.remove('hidden'); }

// --- Post List Rendering (Revised for clarity) ---
export function renderPostList() {
    const postListUl = getEl('post-list');
    if (!postListUl) return;

    const allCachedPosts = state.getFetchedPostsCache();
    const searchTerm = state.getSearchTerm();
    const filterCategory = state.getFilterCategory();
    const sortOrder = state.getSortOrder();
    const isLoading = state.getIsLoadingMore();
    const allPostsLoaded = state.getAllPostsLoaded(); // Get state if *all* posts from API are loaded

    const postsToDisplay = getFilteredAndSortedPosts(allCachedPosts, searchTerm, filterCategory, sortOrder);

    // Determine what message or list to show
    if (allCachedPosts.length === 0) {
        // Cache is completely empty
        if (isLoading) {
            // Still loading the very first batch
            postListUl.innerHTML = '<li>Loading posts...</li>';
        } else if (allPostsLoaded) {
            // Finished loading *everything* and confirmed zero posts exist for this user
            postListUl.innerHTML = '<li>You have no posts yet. Create one!</li>';
        } else {
            // Not loading, cache empty, but haven't confirmed *all* posts are loaded
            // This could happen if the initial load failed before setting allPostsLoaded.
            // Show a generic message or the 'no posts yet' message. Let's use the latter.
            postListUl.innerHTML = '<li>No posts found. Create one!</li>';
        }
    } else if (postsToDisplay.length === 0) {
        // Cache has posts, but current filters/search yield no results
        postListUl.innerHTML = '<li>No posts match your current search/filter criteria.</li>';
    } else {
        // Cache has posts and the filtered list has items to display
        postListUl.innerHTML = ''; // Clear any previous message
        postsToDisplay.forEach(record => {
            postListUl.appendChild(createPostListItem(record));
        });
    }
}


function createPostListItem(record) { const u = record.uri, l = document.createElement('li'); l.dataset.uri = u; const p = record.value || {}, t = p.title || 'Untitled', s = p.slug || 'no-slug', c = p.category || 'Uncategorized', r = u.split('/').pop(), pd = formatDateToCustomString(p.publishedAt) || 'N/A', ud = p.updatedAt ? formatDateToCustomString(p.updatedAt) : null, rc = p.recommended === true; const ca = document.createElement('div'); ca.className = 'post-content-area'; ca.innerHTML = `<span class="post-title">${t} ${rc ? '⭐' : ''}</span><span class="post-category">${c}</span><div class="post-meta"><span>Slug: <code>${s}</code></span><span>Rkey: <code>${r}</code></span></div><div class="post-dates"><span>Published: ${pd}</span>${ud ? `<span>Updated: ${ud}</span>` : ''}</div>`; l.appendChild(ca); const ad = document.createElement('div'); ad.className = 'post-actions'; const vb = document.createElement('button'); vb.textContent = 'View'; vb.className = 'view-btn'; vb.onclick = (e) => { withButtonDisableSync(e.target, () => showPostDetails(record)); }; ad.appendChild(vb); const eb = document.createElement('button'); eb.textContent = 'Edit'; eb.className = 'edit-btn'; eb.onclick = (e) => { withButtonDisableSync(e.target, () => showEditForm(record)); }; ad.appendChild(eb); const db = document.createElement('button'); db.textContent = 'Delete'; db.className = 'delete-btn'; db.onclick = (e) => { withButtonDisableSync(e.target, () => state.handleDeletePost(u)); }; ad.appendChild(db); l.appendChild(ad); return l; }

export function updateLoadMoreButton() {
    const button = getEl('load-more-button');
    if (!button) return;

    const allLoaded = state.getAllPostsLoaded();
    const isLoading = state.getIsLoadingMore();

    const shouldBeVisible = !allLoaded;
    button.classList.toggle('hidden', !shouldBeVisible);

    const shouldBeEnabled = !isLoading && shouldBeVisible;
    button.disabled = !shouldBeEnabled;

    if (shouldBeVisible) {
        button.textContent = isLoading ? 'Loading...' : 'Load More Posts';
    }
}

function withButtonDisableSync(button, func) { if (!button) return; const w = button.disabled; button.disabled = true; try { func(); } finally { setTimeout(() => { if (!w) button.disabled = false; }, 100); } }

// --- Form Handling & Details View ---
// (populateForm, showCreateForm, showEditForm, hidePostForm, showPostDetails, hidePostDetails, triggerJsonExport, populateCategoryFilter, updateListControls remain unchanged)
export function populateForm(postRecord = null) {
    const f = getEl('post-form'), tEl = getEl('form-title'), aS = getEl('app-section');
    clearStatus();
    f.reset();
    f.querySelectorAll('.invalid-input').forEach(e => e.classList.remove('invalid-input'));
    getEl('post-rkey').value = ''; getEl('post-uri').value = ''; getEl('authorDid').value = ''; getEl('authorDisplayName').value = '';
    getEl('author-validation-status').textContent = ''; getEl('author-validation-status').className = '';
    getEl('comment-uri-status').textContent = ''; getEl('comment-uri-status').className = '';
    getEl('save-post-button').disabled = true;

    if (postRecord?.value) { // Editing existing post
        tEl.textContent = `Edit Post: ${postRecord.value.title || 'Untitled'}`;
        aS.classList.add('form-active');
        getEl('post-rkey').value = postRecord.uri.split('/').pop();
        getEl('post-uri').value = postRecord.uri;
        const d = postRecord.value;
        getEl('title').value = d.title || '';
        getEl('shortDescription').value = d.shortDescription || '';
        getEl('authorHandle').value = d.authorHandle || '';
        getEl('authorDid').value = d.authorDid || '';
        getEl('authorDisplayName').value = d.authorDisplayName || '';
        getEl('slug').value = d.slug || '';
        getEl('category').value = d.category || '';
        getEl('content').value = d.content || '';
        getEl('coverImage').value = d.coverImage || '';
        getEl('tags').value = Array.isArray(d.tags) ? d.tags.join(', ') : '';
        getEl('publishedAt').value = formatDateToDateTimeLocalString(d.publishedAt) || '';
        getEl('updatedAt').value = formatDateToDateTimeLocalString(d.updatedAt) || '';
        getEl('bskyCommentsPostUri').value = d.bskyCommentsPostUri || '';
        getEl('recommended').checked = d.recommended === true;

        if (d.authorHandle && d.authorDid) {
            getEl('author-validation-status').textContent = `Current: ${d.authorDisplayName || d.authorHandle}`;
            getEl('author-validation-status').className = 'valid';
        } else if (d.authorHandle) {
            getEl('author-validation-status').textContent = `Needs re-validation`;
            getEl('author-validation-status').className = 'invalid';
        }
        if (d.bskyCommentsPostUri) { state.handleCommentUriValidation(); }

        setTimeout(() => window.validateFormAndToggleButton?.(), 0);

    } else { // Creating new post
        tEl.textContent = 'Create New Post';
        aS.classList.add('form-active');
        const s = state.getSession();
        if (s?.handle) {
            getEl('authorHandle').value = s.handle;
            state.handleAuthorValidation().finally(() => window.validateFormAndToggleButton?.());
        }
        getEl('publishedAt').value = formatDateToDateTimeLocalString(new Date());
        getEl('updatedAt').value = '';

        setTimeout(() => window.validateFormAndToggleButton?.(), 0);
    }
}
export function showCreateForm() { populateForm(null); getEl('post-form-section').classList.remove('hidden'); getEl('post-list-section').classList.add('hidden'); getEl('post-detail-section').classList.add('hidden'); getEl('app-section').classList.add('form-active'); getEl('title').focus(); }
export function showEditForm(postRecord) { populateForm(postRecord); getEl('post-form-section').classList.remove('hidden'); getEl('post-list-section').classList.add('hidden'); getEl('post-detail-section').classList.add('hidden'); getEl('app-section').classList.add('form-active'); getEl('title').focus(); }
export function hidePostForm() { getEl('post-form-section').classList.add('hidden'); getEl('post-list-section').classList.remove('hidden'); getEl('post-detail-section').classList.add('hidden'); getEl('app-section').classList.remove('form-active'); getEl('post-form').reset(); clearStatus(); getEl('post-form').querySelectorAll('.invalid-input').forEach(e => e.classList.remove('invalid-input')); getEl('author-validation-status').textContent = ''; getEl('author-validation-status').className = ''; getEl('comment-uri-status').textContent = ''; getEl('comment-uri-status').className = ''; getEl('save-post-button').disabled = true; }
export function showPostDetails(record) { if (!record?.value) return; const d = record.value; getEl('detail-title').textContent = `Details: ${d.title || 'Untitled'}`; const dd = { URI: record.uri, CID: record.cid, Title: d.title || 'N/A', Slug: d.slug || 'N/A', Category: d.category || 'N/A', Author: `${d.authorDisplayName || 'Unknown'} (@${d.authorHandle || 'unknown'})`, AuthorDID: d.authorDid || 'N/A', Published: formatDateToCustomString(d.publishedAt) || 'N/A', Updated: d.updatedAt ? formatDateToCustomString(d.updatedAt) : 'N/A', Recommended: d.recommended === true ? 'Yes ⭐' : 'No', ShortDescription: d.shortDescription || 'N/A', CoverImage: d.coverImage || 'None', Tags: Array.isArray(d.tags) && d.tags.length > 0 ? d.tags.join(', ') : 'N/A', CommentsURI: d.bskyCommentsPostUri || 'None', Content: d.content || '(No Content)' }; getEl('detail-content').textContent = JSON.stringify(dd, null, 2); getEl('edit-from-detail-button').dataset.uri = record.uri; getEl('post-detail-section').classList.remove('hidden'); getEl('post-list-section').classList.add('hidden'); getEl('post-form-section').classList.add('hidden'); getEl('app-section').classList.add('form-active'); }
export function hidePostDetails() { getEl('post-detail-section').classList.add('hidden'); getEl('post-list-section').classList.remove('hidden'); getEl('app-section').classList.remove('form-active'); }
export function triggerJsonExport(data, filename) { try { const j = JSON.stringify(data, null, 2), b = new Blob([j], { type: 'application/json' }), u = URL.createObjectURL(b), a = document.createElement('a'); a.href = u; a.download = filename; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(u); return true; } catch (e) { console.error("Export failed:", e); return false; } }

export function populateCategoryFilter(categories) {
    const select = getEl('category-filter');
    if (!select) return;
    const currentValue = select.value;
    select.innerHTML = '<option value="">All Categories</option>';
    categories.forEach(cat => {
        const option = document.createElement('option');
        option.value = cat;
        option.textContent = cat;
        select.appendChild(option);
    });
    if (categories.includes(currentValue)) {
        select.value = currentValue;
    }
}

export function updateListControls(searchTerm = '', category = '', sortOrder = 'newest') {
    const searchInput = getEl('search-input');
    const categorySelect = getEl('category-filter');
    const sortSelect = getEl('sort-order');
    if (searchInput) searchInput.value = searchTerm;
    if (categorySelect) categorySelect.value = category;
    if (sortSelect) sortSelect.value = sortOrder;
}