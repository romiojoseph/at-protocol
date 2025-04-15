// --- START OF FILE main.js ---

// js/main.js
import {
    BLOG_POST_NSID, APP_CONTAINER_ID,
    LOADING_OVERLAY_ID, LOADING_TEXT_ID, POST_LIST_ID, DEFAULT_BLOG_TITLE,
    DEFAULT_BLOG_DESCRIPTION, COMMENTS_WRAPPER_TARGET_ID,
    BSKY_WIDGET_TARGET_ID, MAX_PAGES_FOR_INITIAL_LOAD,
    LIST_CONTROLS_ID, LIST_SEARCH_INPUT_ID, SORT_SELECT_ID, CATEGORY_FILTER_ID,
    SEARCH_DEBOUNCE_DELAY, SEARCH_FORM_ID, SEARCH_INPUT_ID
} from './config.js';
import { findRecordBySlug, resolveHandleToDid, fetchAllRecordsForUser } from './api.js';
import { updateMeta, updateOgMeta, showLoaderOverlay, sanitize, triggerBlueskyEmbeds, isValidDID, isValidHandle } from './utils.js';
import {
    renderSearchForm, renderPostList, renderSinglePostArticle,
    renderError, renderListControls, applyFiltersSortAndRenderList
} from './renderer.js';

// --- State ---
let isLoading = false;
let currentViewDID = null;
let currentViewHandle = null; // Store the original handle used for searching, if any
let currentDisplayName = null; // Store the display name once known
let allFetchedPosts = [];
let uniqueCategories = new Set();
let currentListSearchTerm = '';
let currentSort = 'newest';
let currentCategoryFilter = '';
let listSearchDebounceTimer = null;
let currentRecommendedFilter = false;

// --- Helper: Update Header/Meta based on view ---
function updatePageContext(state, identifier = null, postTitle = null) {
    let title = DEFAULT_BLOG_TITLE;
    let description = DEFAULT_BLOG_DESCRIPTION;
    let ogType = 'website';
    let ogImage = null;

    switch (state) {
        case 'search': break;
        case 'list':
            if (identifier) { title = `Blog Posts by ${sanitize(identifier)}`; description = `Listing blog posts published by ${sanitize(identifier)} on Bluesky.`; }
            else { title = `Blog Posts`; description = `Listing blog posts.`; }
            break;
        case 'post':
            if (postTitle && identifier) { title = `${sanitize(postTitle)} | by ${sanitize(identifier)}`; }
            else if (postTitle) { title = `${sanitize(postTitle)} | ${DEFAULT_BLOG_TITLE}`; }
            ogType = 'article';
            break;
        case 'error':
            title = `Error | ${DEFAULT_BLOG_TITLE}`; description = "An error occurred loading content.";
            break;
        default: break;
    }
    updateMeta(title, description);
    updateOgMeta(title, ogType, description, ogImage);
}

// --- Data Fetching and Display Logic ---

async function displayPostList(did, handle = null, urlToPush = null) {
    currentViewDID = did;
    currentViewHandle = handle; // Store original handle if provided
    currentDisplayName = handle || did; // Initial display name (handle or DID)
    updatePageContext('list', currentDisplayName); // Initial update

    const appContainer = document.getElementById(APP_CONTAINER_ID);
    const commentsWrapperTarget = document.getElementById(COMMENTS_WRAPPER_TARGET_ID);
    if (commentsWrapperTarget) commentsWrapperTarget.innerHTML = '';
    appContainer.innerHTML = '';

    // Render container placeholders first
    const controlsContainer = document.createElement('div');
    controlsContainer.id = LIST_CONTROLS_ID;
    controlsContainer.className = 'atproto-list-controls';
    appContainer.appendChild(controlsContainer);

    const postListContainer = document.createElement('div');
    postListContainer.id = POST_LIST_ID;
    postListContainer.className = 'atproto-post-list';
    appContainer.appendChild(postListContainer);

    // Render initial controls with placeholder/initial identifier
    let initialControls = renderListControls([], '', 'newest', '', currentDisplayName, currentViewDID); // Pass DID for link
    controlsContainer.innerHTML = initialControls.innerHTML;

    if (urlToPush && window.location.search !== new URL(urlToPush, window.location.origin).search) {
        history.pushState({ did: did, handle: handle }, '', urlToPush);
    }

    try {
        allFetchedPosts = await fetchAllRecordsForUser(did, BLOG_POST_NSID, uniqueCategories, MAX_PAGES_FOR_INITIAL_LOAD);

        // --- Update Display Name if needed ---
        if (allFetchedPosts.length > 0) {
            const firstPost = allFetchedPosts[0].value;
            const fetchedDisplayName = firstPost?.authorDisplayName;
            const fetchedHandle = firstPost?.authorHandle;
            // Prioritize Display Name > Handle > Original Handle > DID
            currentDisplayName = sanitize(fetchedDisplayName || fetchedHandle || currentViewHandle || currentViewDID);
            // Update page context title again with potentially better name
            updatePageContext('list', currentDisplayName);
        }
        // --- End Display Name Update ---


        currentSort = 'newest';
        currentListSearchTerm = '';
        const urlParamsForFilter = new URLSearchParams(window.location.search);
        currentCategoryFilter = urlParamsForFilter.get('category') ? sanitize(decodeURIComponent(urlParamsForFilter.get('category'))) : '';

        // Re-render controls with actual categories and updated display name
        const finalControls = renderListControls(
            Array.from(uniqueCategories),
            currentListSearchTerm,
            currentSort,
            currentCategoryFilter,
            currentDisplayName,
            currentViewDID,
            currentRecommendedFilter
        );
        controlsContainer.innerHTML = finalControls.innerHTML; // Replace placeholder controls

        // Pass current state to the rendering/filtering function
        applyFiltersSortAndRenderList(allFetchedPosts, POST_LIST_ID, currentDisplayName, currentViewDID, currentListSearchTerm, currentCategoryFilter, currentSort, currentRecommendedFilter);

        // Add Event Listeners (find elements within the *final* controls)
        const listSearchInput = controlsContainer.querySelector(`#${LIST_SEARCH_INPUT_ID}`);
        const sortSelect = controlsContainer.querySelector(`#${SORT_SELECT_ID}`);
        const categorySelect = controlsContainer.querySelector(`#${CATEGORY_FILTER_ID}`);

        if (listSearchInput) {
            listSearchInput.addEventListener('input', (e) => {
                clearTimeout(listSearchDebounceTimer);
                const searchTerm = e.target.value;
                listSearchDebounceTimer = setTimeout(() => {
                    currentListSearchTerm = searchTerm;
                    applyFiltersSortAndRenderList(allFetchedPosts, POST_LIST_ID, currentDisplayName, currentViewDID, currentListSearchTerm, currentCategoryFilter, currentSort, currentRecommendedFilter);
                }, SEARCH_DEBOUNCE_DELAY);
            });
        }
        if (sortSelect) {
            sortSelect.addEventListener('change', (e) => {
                currentSort = e.target.value;
                applyFiltersSortAndRenderList(allFetchedPosts, POST_LIST_ID, currentDisplayName, currentViewDID, currentListSearchTerm, currentCategoryFilter, currentSort, currentRecommendedFilter);
            });
        }
        if (categorySelect) {
            categorySelect.addEventListener('change', (e) => {
                currentCategoryFilter = e.target.value;
                const url = new URL(window.location);
                if (currentCategoryFilter) { url.searchParams.set('category', currentCategoryFilter); }
                else { url.searchParams.delete('category'); }
                history.replaceState(null, '', url.toString());
                applyFiltersSortAndRenderList(allFetchedPosts, POST_LIST_ID, currentDisplayName, currentViewDID, currentListSearchTerm, currentCategoryFilter, currentSort, currentRecommendedFilter);
            });
            if (currentCategoryFilter && Array.from(uniqueCategories).includes(currentCategoryFilter)) {
                categorySelect.value = currentCategoryFilter;
            }
        }

    } catch (error) {
        console.error(`Error fetching or displaying posts for DID ${did}:`, error);
        // Use the initially determined name for the error message
        renderError(`Failed to load posts for ${sanitize(handle || did)}. ${error.message}`, APP_CONTAINER_ID, true);
        updatePageContext('error');
        throw error;
    } finally {
        showLoaderOverlay(false);
    }
}

function fallbackCopyTextToClipboard(text, button) {
    const tempTextArea = document.createElement("textarea");
    tempTextArea.value = text;
    tempTextArea.style.position = "fixed"; tempTextArea.style.top = "0"; tempTextArea.style.left = "0"; tempTextArea.style.opacity = "0";
    document.body.appendChild(tempTextArea);
    tempTextArea.focus(); tempTextArea.select();
    let successful = false;
    try {
        successful = document.execCommand('copy');
        if (successful) {
            button.textContent = 'Copied!'; button.disabled = true;
            setTimeout(() => { button.textContent = 'Copy Link'; button.disabled = false; }, 1500);
        } else { throw new Error('Fallback copy command failed'); }
    } catch (err) {
        console.error('Fallback Copy Error:', err);
        button.textContent = 'Error'; button.disabled = true;
        setTimeout(() => { button.textContent = 'Copy Link'; button.disabled = false; }, 1500);
    }
    document.body.removeChild(tempTextArea);
}

async function displaySinglePost(did, slug) {
    currentViewDID = did;
    currentViewHandle = null; // Will get from post
    currentDisplayName = null; // Will get from post

    showLoaderOverlay(true, `Loading post "${slug}"...`);

    const appContainer = document.getElementById(APP_CONTAINER_ID);
    const commentsWrapperTarget = document.getElementById(COMMENTS_WRAPPER_TARGET_ID);
    if (appContainer) appContainer.innerHTML = '';
    if (commentsWrapperTarget) commentsWrapperTarget.innerHTML = '';

    if (!appContainer || !commentsWrapperTarget) {
        console.error("displaySinglePost: Required containers not found.");
        isLoading = false; showLoaderOverlay(false); return;
    }

    try {
        const record = await findRecordBySlug(did, BLOG_POST_NSID, slug);

        if (record && record.value) {
            const postValue = record.value;
            // Update identifiers based on the fetched post
            currentViewHandle = postValue.authorHandle || did;
            currentDisplayName = sanitize(postValue.authorDisplayName || currentViewHandle);
            const title = sanitize(postValue.title) || 'Untitled Post';

            updatePageContext('post', currentDisplayName, title); // Use display name
            const articleHTML = renderSinglePostArticle(record);
            appContainer.innerHTML = articleHTML;

            const copyButton = appContainer.querySelector('.copy-link-button');
            if (copyButton) {
                copyButton.addEventListener('click', () => {
                    const url = window.location.href;
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        navigator.clipboard.writeText(url).then(() => {
                            copyButton.textContent = 'Copied!'; copyButton.disabled = true;
                            setTimeout(() => { copyButton.textContent = 'Copy Link'; copyButton.disabled = false; }, 1500);
                        }).catch(err => {
                            console.error('Clipboard API failed, trying fallback: ', err);
                            fallbackCopyTextToClipboard(url, copyButton);
                        });
                    } else {
                        fallbackCopyTextToClipboard(url, copyButton);
                    }
                });
            }

            triggerBlueskyEmbeds();

            const shortDesc = sanitize(postValue.shortDescription) || sanitize(postValue.content || '').substring(0, 160) + '...';
            const coverImage = postValue.coverImage;
            updateMeta(`${title} | by ${currentDisplayName}`, shortDesc); // Use display name
            updateOgMeta(title, 'article', shortDesc, coverImage);

            const commentUriFromRecord = record.value?.bskyCommentsPostUri;
            const commentsSectionHTML = `<div class="widget-wrapper"><hr><div id="${BSKY_WIDGET_TARGET_ID}">${!commentUriFromRecord ? '<p class="atproto-comment-alert">Comments are not available for this post.</p>' : '<p class="atproto-comment-alert">Loading comments...</p>'}</div></div>`;
            commentsWrapperTarget.innerHTML = commentsSectionHTML;
            const widgetTargetElement = document.getElementById(BSKY_WIDGET_TARGET_ID);
            if (commentUriFromRecord && widgetTargetElement && typeof loadAndRenderComments === 'function') {
                loadAndRenderComments(BSKY_WIDGET_TARGET_ID, commentUriFromRecord);
            } else if (commentUriFromRecord) {
                console.error("Comments widget target or load function (loadAndRenderComments) not found.");
                if (widgetTargetElement) widgetTargetElement.innerHTML = '<p class="atproto-error">Error initializing comments.</p>';
            }

        } else {
            console.warn(`displaySinglePost: Record NOT found for slug "${slug}".`);
            updatePageContext('error');
            renderError(`Post with slug "${sanitize(slug)}" not found for this user.`, APP_CONTAINER_ID, false, currentViewDID);
        }

    } catch (error) {
        console.error(`displaySinglePost: CATCH block. Error loading post "${slug}":`, error);
        updatePageContext('error');
        renderError(`Failed to load post "${sanitize(slug)}". ${error.message}`, APP_CONTAINER_ID, false, currentViewDID);
    } finally {
        isLoading = false;
        showLoaderOverlay(false);
    }
}

async function handleSearchSubmit() {
    const searchInput = document.getElementById(SEARCH_INPUT_ID);
    const query = searchInput.value.trim();
    if (!query || isLoading) return;

    isLoading = true;
    showLoaderOverlay(true, `Looking up "${sanitize(query)}"...`);
    const appContainer = document.getElementById(APP_CONTAINER_ID);
    appContainer.innerHTML = '';

    let targetDID = null;
    let targetHandle = null;

    if (isValidDID(query)) {
        targetDID = query;
        targetHandle = null; // Don't assume handle is DID when searching by DID
    } else if (isValidHandle(query)) {
        targetHandle = query; // Store the handle used for searching
        targetDID = await resolveHandleToDid(query);
        if (!targetDID) {
            renderError(`Could not find Bluesky user with handle "${sanitize(query)}".`, APP_CONTAINER_ID, true);
            updatePageContext('error');
            showLoaderOverlay(false); isLoading = false; return;
        }
    } else {
        renderError(`Invalid input: "${sanitize(query)}". Enter a valid handle or DID.`, APP_CONTAINER_ID, true);
        updatePageContext('error');
        showLoaderOverlay(false); isLoading = false; return;
    }

    const newUrl = `?DID=${encodeURIComponent(targetDID)}`;

    try {
        // Pass the original handle (if used) to displayPostList
        await displayPostList(targetDID, targetHandle, newUrl);
    } catch (error) {
        console.error("Error occurred during displayPostList execution:", error);
        isLoading = false;
        showLoaderOverlay(false);
    }
}


// --- Routing ---
function handleRouteChange() {
    const params = new URLSearchParams(window.location.search);
    const didParam = params.get('DID');
    const viewPostSlug = params.get('view-post');
    const categoryParam = params.get('category');

    const appContainer = document.getElementById(APP_CONTAINER_ID);
    const commentsWrapperTarget = document.getElementById(COMMENTS_WRAPPER_TARGET_ID);
    const bodyElement = document.body;

    isLoading = false;
    allFetchedPosts = [];
    uniqueCategories.clear();
    currentListSearchTerm = '';
    currentCategoryFilter = categoryParam ? sanitize(decodeURIComponent(categoryParam)) : '';

    if (viewPostSlug && didParam && isValidDID(didParam)) {
        // Single Post View
        bodyElement.classList.remove('search-view-active'); // Ensure header is visible
        currentViewDID = didParam;
        isLoading = true;
        displaySinglePost(didParam, decodeURIComponent(viewPostSlug));

    } else if (didParam && isValidDID(didParam)) {
        // List View
        bodyElement.classList.remove('search-view-active'); // Ensure header is visible
        currentViewDID = didParam;
        isLoading = true;
        showLoaderOverlay(true, `Loading posts for ${didParam}...`);
        // Don't know handle/display name yet when loading directly via DID
        displayPostList(didParam, null, null);

    } else {
        // Search View (Default)
        bodyElement.classList.add('search-view-active'); // Hide header
        currentViewDID = null;
        currentViewHandle = null;
        currentDisplayName = null; // Clear display name
        appContainer.innerHTML = '';
        if (commentsWrapperTarget) commentsWrapperTarget.innerHTML = '';
        const searchForm = renderSearchForm();
        appContainer.appendChild(searchForm);
        const formElement = document.getElementById(SEARCH_FORM_ID);
        if (formElement) {
            formElement.removeEventListener('submit', handleSearchSubmit);
            formElement.addEventListener('submit', handleSearchSubmit);
        } else { console.error("Could not attach submit listener, search form not found."); }
        updatePageContext('search');
        showLoaderOverlay(false);
    }
}

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    handleRouteChange();
    window.addEventListener('popstate', handleRouteChange);
});

// --- END OF FILE main.js ---