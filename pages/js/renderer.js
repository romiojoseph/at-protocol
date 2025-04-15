// --- START OF FILE renderer.js ---

// js/renderer.js
import { formatISODateToCustomString, sanitize } from './utils.js';
// *** ADD isValidDID to import from utils ***
import { isValidDID } from './utils.js';
import {
    POST_LIST_ID, POST_ARTICLE_CLASS,
    LIST_CONTROLS_ID, LIST_SEARCH_INPUT_ID, SORT_SELECT_ID, CATEGORY_FILTER_ID,
    SEARCH_FORM_CONTAINER_ID, SEARCH_FORM_ID, SEARCH_INPUT_ID, SEARCH_BUTTON_ID
} from './config.js';

export function renderSearchForm() {
    const container = document.createElement('div');
    container.id = SEARCH_FORM_CONTAINER_ID;
    container.className = 'atproto-search-form-container';

    const logoImg = document.createElement('img');
    logoImg.src = 'assets/name.svg';
    logoImg.alt = 'AT Pages: Search and read long-form posts on ATProto';
    logoImg.className = 'search-page-logo';
    container.appendChild(logoImg);

    const form = document.createElement('form');
    form.id = SEARCH_FORM_ID;
    form.action = "#";
    form.onsubmit = (e) => e.preventDefault();

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.id = SEARCH_INPUT_ID;
    searchInput.placeholder = 'Enter Bluesky username or DID';
    searchInput.required = true;
    searchInput.setAttribute('aria-label', 'Bluesky Handle or DID');

    const searchButton = document.createElement('button');
    searchButton.type = 'submit';
    searchButton.id = SEARCH_BUTTON_ID;
    searchButton.textContent = 'Search Pages';

    form.appendChild(searchInput);
    form.appendChild(searchButton);
    container.appendChild(form);

    const suggestedDiv = document.createElement('div');
    suggestedDiv.className = 'suggested';
    suggestedDiv.innerHTML = `
        <span>Don't know what AT Pages is about?</span>
        <a href="https://skywrite.pages.dev/?DID=did%3Aplc%3Axglrcj6gmrpktysohindaqhj&view-post=learn-how-it-works" target="_blank" rel="noopener" title="A doc to help you learn how it works">Learn how it works</a>
        <button class="at-pages-write" onclick="window.open('/write/', '_blank', 'noopener,noreferrer')" title="Write and manage custom blog posts on ATProto">Start Writing Now</button>
    `;
    container.appendChild(suggestedDiv);

    return container;
}

// Update the renderListControls function to include recommended filter
export function renderListControls(categories = [], currentSearchTerm = '', currentSortValue = 'newest', currentCategoryFilter = '', displayIdentifier = '', didForLink = '') {
    const controlsContainer = document.createElement('div');
    controlsContainer.id = LIST_CONTROLS_ID;
    controlsContainer.className = 'atproto-list-controls';

    if (displayIdentifier && didForLink) {
        const userDisplay = document.createElement('p');
        userDisplay.className = 'atproto-list-user-identifier';
        userDisplay.innerHTML = `Showing posts for: <a href="https://bsky.app/profile/${sanitize(didForLink)}" target="_blank" rel="noopener">${sanitize(displayIdentifier)}</a>`;
        controlsContainer.appendChild(userDisplay);
    }

    const selectsWrapper = document.createElement('div');
    selectsWrapper.className = 'list-controls-selects-wrapper';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.id = LIST_SEARCH_INPUT_ID;
    searchInput.placeholder = 'Search posts...';
    searchInput.value = currentSearchTerm;
    searchInput.title = "Filter displayed posts by title, description, content, or category";

    const categorySelect = document.createElement('select');
    categorySelect.id = CATEGORY_FILTER_ID;
    categorySelect.title = "Filter posts by category";

    // Add All Categories option
    const allCatsOption = document.createElement('option');
    allCatsOption.value = '';
    allCatsOption.textContent = 'All Categories';
    allCatsOption.selected = currentCategoryFilter === '';
    categorySelect.appendChild(allCatsOption);

    // Add Recommended option
    const recommendedOption = document.createElement('option');
    recommendedOption.value = 'recommended';
    recommendedOption.textContent = 'Recommended Only';
    recommendedOption.selected = currentCategoryFilter === 'recommended';
    categorySelect.appendChild(recommendedOption);

    // Add regular categories
    categories.sort().forEach(cat => {
        const option = document.createElement('option');
        const safeCat = sanitize(cat);
        option.value = safeCat;
        option.textContent = safeCat;
        option.selected = currentCategoryFilter === safeCat;
        categorySelect.appendChild(option);
    });

    const sortSelect = document.createElement('select');
    sortSelect.id = SORT_SELECT_ID;
    sortSelect.title = "Sort posts by date";
    const newestOption = document.createElement('option');
    newestOption.value = 'newest'; newestOption.textContent = 'Newest';
    newestOption.selected = currentSortValue === 'newest';
    sortSelect.appendChild(newestOption);
    const oldestOption = document.createElement('option');
    oldestOption.value = 'oldest'; oldestOption.textContent = 'Oldest';
    oldestOption.selected = currentSortValue === 'oldest';
    sortSelect.appendChild(oldestOption);

    controlsContainer.appendChild(searchInput);
    selectsWrapper.appendChild(categorySelect);
    selectsWrapper.appendChild(sortSelect);
    controlsContainer.appendChild(selectsWrapper);

    return controlsContainer;
}

export function renderPostList(records, did) {
    const fragment = document.createDocumentFragment();
    records.forEach(record => {
        try {
            if (!record?.value || !record.uri) return;
            const postValue = record.value;
            const title = sanitize(postValue.title) || 'Untitled Post';
            const slug = postValue.slug;
            const safeSlug = slug ? encodeURIComponent(slug) : null;
            const shortDescription = sanitize(postValue.shortDescription) || sanitize(postValue.content || '').substring(0, 150) + '...';
            const category = postValue.category || '';
            const safeCategory = category ? sanitize(category) : '';
            const publishedAt = postValue.publishedAt;
            const authorDid = postValue.authorDid || did;
            const authorHandle = sanitize(postValue.authorHandle || 'unknown');
            const authorDisplayName = sanitize(postValue.authorDisplayName || authorHandle); // Prefer display name

            const postDate = formatISODateToCustomString(publishedAt);
            const postLink = safeSlug ? `?DID=${encodeURIComponent(authorDid)}&view-post=${safeSlug}` : '#';
            const categoryLink = safeCategory ? `?DID=${encodeURIComponent(authorDid)}&category=${encodeURIComponent(safeCategory)}` : null;


            const postElement = document.createElement('article');
            postElement.className = `${POST_ARTICLE_CLASS} atproto-post-summary search-result-item`;

            postElement.dataset.title = title.toLowerCase();
            postElement.dataset.shortDescription = shortDescription.toLowerCase();
            postElement.dataset.category = safeCategory.toLowerCase();
            postElement.dataset.content = (postValue.content || '').toLowerCase();
            postElement.dataset.publishedAt = publishedAt || '';

            let categoryHtml = '';
            if (safeCategory && categoryLink) {
                categoryHtml = ` | Posted in <a href="${categoryLink}" class="result-category-link" title="Filter ${authorHandle}'s posts by ${safeCategory}">${safeCategory}</a>`;
            } else if (safeCategory) {
                categoryHtml = ` | Posted in ${safeCategory}`;
            }

            postElement.innerHTML = `
                <div class="result-header">
                    <a href="${postLink}" class="result-title" title="View post: ${title}">${title}</a>
                 </div>
                <p class="result-snippet">${shortDescription}</p>
                <p class="result-meta">
                    By ${authorDisplayName} • ${postDate}${categoryHtml}
                 </p>
            `;
            fragment.appendChild(postElement);
        } catch (error) {
            console.error("Error rendering a post summary:", error, "Record:", record);
        }
    });
    return fragment;
}

export function renderSinglePostArticle(record) {
    if (!record?.value) { throw new Error("Post data is missing or invalid."); }
    if (typeof marked === 'undefined') { throw new Error("Markdown parser (marked.js) not available."); }

    try {
        const postValue = record.value;
        const title = sanitize(postValue.title) || 'Untitled Post';
        const shortDescription = sanitize(postValue.shortDescription) || '';
        const authorDid = postValue.authorDid;
        if (!authorDid) { console.warn("Author DID missing from record.", record); }
        const authorHandle = postValue.authorHandle || 'unknown.bsky.social';
        const authorDisplayName = sanitize(postValue.authorDisplayName || authorHandle); // Prefer display name
        const category = postValue.category || '';
        const safeCategory = category ? sanitize(category) : '';
        const content = postValue.content || '';
        const coverImage = postValue.coverImage;
        const tags = Array.isArray(postValue.tags) ? postValue.tags : [];
        const publishedAt = postValue.publishedAt;
        const updatedAt = postValue.updatedAt;

        const publishedDateStr = formatISODateToCustomString(publishedAt);
        const updatedDateStr = updatedAt ? formatISODateToCustomString(updatedAt) : null;
        const profileLink = `https://bsky.app/profile/${authorDid || authorHandle}`; // Link uses DID or falls back to handle
        const backLink = authorDid ? `?DID=${encodeURIComponent(authorDid)}` : 'index.html';
        const categoryLink = safeCategory && authorDid ? `?DID=${encodeURIComponent(authorDid)}&category=${encodeURIComponent(safeCategory)}` : null;

        let tagsHtml = '';
        if (tags.length > 0) {
            const tagBubbles = tags.map(tag => {
                const safeTag = sanitize(tag); if (!safeTag) return '';
                const encodedTag = encodeURIComponent(safeTag);
                const searchUrl = `https://bsky.app/search?q=${encodedTag}`;
                return `<a href="${searchUrl}" target="_blank" rel="noopener" class="atproto-tag-bubble" title="Search for ${safeTag} on Bluesky">${safeTag}</a>`;
            }).filter(Boolean).join('');
            if (tagBubbles) { tagsHtml = `<div class="atproto-tags-container"><div class="atproto-tags-label">${tagBubbles}</div></div>`; }
        }

        const parsedContent = marked.parse(content, { breaks: true });

        let categoryAndCopyLinkHtml = '';
        const categoryTextHtml = safeCategory ?
            (categoryLink ? `View more in: <a href="${categoryLink}" title="View ${authorHandle}'s posts in category: ${safeCategory}">${safeCategory}</a>` : `Category: ${safeCategory}`)
            : '';
        const copyButtonHtml = `<button class="copy-link-button" title="Copy link to this post">Copy Link</button>`;
        categoryAndCopyLinkHtml = `<div class="atproto-post-category"><span>${categoryTextHtml || ' '}</span>${copyButtonHtml}</div>`;

        const articleHtml = `
            <article class="atproto-post-full">
                 <a href="${backLink}" title="Back to ${authorHandle}'s posts" class="atproto-back-button">Back</a>
                <h1>${title}</h1>
                 ${shortDescription ? `<p class="atproto-short-description">${shortDescription}</p>` : ''}
                <p class="atproto-post-meta">
                    By <a href="${profileLink}" target="_blank" rel="noopener" title="View ${authorDisplayName}'s Bluesky profile">${authorDisplayName}</a>
                 </p>
                 <div class="atproto-post-timestamps">
                    Published on ${publishedDateStr}${updatedDateStr ? ` • Last updated ${updatedDateStr}` : ''}
                 </div>
                ${categoryAndCopyLinkHtml}
                ${coverImage ? `<img src="${sanitize(coverImage)}" alt="${title}" class="atproto-post-full-image" />` : ''}
                <div class="atproto-post-content">${parsedContent}</div>
                ${tagsHtml}
            </article>`;

        return articleHtml;

    } catch (error) {
        console.error("FATAL ERROR rendering single post article:", error, "Record:", record);
        const backLink = record?.value?.authorDid ? `?DID=${encodeURIComponent(record.value.authorDid)}` : 'index.html';
        return `<article class="atproto-post-full atproto-error-container"><a href="${backLink}" title="Back" class="atproto-back-button">Back</a><h1>Error Displaying Post</h1><p class="atproto-error">An error occurred displaying this post. Check console for details.</p></article>`;
    }
}

export function renderError(message, containerId, showHomeLink = false, didForBackLink = null) {
    const container = document.getElementById(containerId);
    if (container) {
        let backButtonHtml = '';
        if (didForBackLink) { backButtonHtml = `<p><a href="?DID=${encodeURIComponent(didForBackLink)}" class="atproto-back-button" title="Back to user's posts">Back to User's Posts</a></p>`; }
        else if (showHomeLink) { backButtonHtml = `<p><a href="index.html" class="atproto-back-button" title="Go back to search">Back to Search</a></p>`; }
        container.innerHTML = `<div class="atproto-error-container"><p class="atproto-error">${sanitize(message)}</p>${backButtonHtml}</div>`;
    } else { console.error(`Container #${containerId} not found for rendering error.`); }
}

function getSuggestedHtml() {
    return `<div class="suggested"><span>Don't know what AT Pages is about?</span> <a href="https://skywrite.pages.dev/?DID=did%3Aplc%3Axglrcj6gmrpktysohindaqhj&view-post=learn-how-it-works" target="_blank" rel="noopener" title="A doc to help you learn how it works">Learn how it works</a></div>`;
}

// Update the applyFiltersSortAndRenderList function
export function applyFiltersSortAndRenderList(postsToProcess, listContainerId, currentViewHandle, currentViewDID, currentListSearchTerm, currentCategoryFilter, currentSort) {
    const postListContainer = document.getElementById(listContainerId);
    if (!postListContainer) { console.error("Post list container not found for rendering."); return; }

    const lowerSearchTerm = currentListSearchTerm.toLowerCase();

    const filteredPosts = postsToProcess.filter(record => {
        const value = record?.value;
        if (!value) return false;

        // Handle recommended filter
        if (currentCategoryFilter === 'recommended' && !value.recommended) return false;

        // Handle regular category filter
        const category = (value.category || '').toLowerCase();
        if (currentCategoryFilter && currentCategoryFilter !== 'recommended' && category !== currentCategoryFilter.toLowerCase()) return false;

        // Handle search term
        if (lowerSearchTerm) {
            const title = (value.title || '').toLowerCase();
            const description = (value.shortDescription || '').toLowerCase();
            const content = (value.content || '').toLowerCase();
            if (!(title.includes(lowerSearchTerm) || description.includes(lowerSearchTerm) || category.includes(lowerSearchTerm) || content.includes(lowerSearchTerm))) return false;
        }

        return true;
    });

    const sortedPosts = [...filteredPosts].sort((a, b) => {
        const dateA = new Date(a?.value?.publishedAt || 0);
        const dateB = new Date(b?.value?.publishedAt || 0);
        if (isNaN(dateA) || isNaN(dateB)) return 0;
        return currentSort === 'oldest' ? dateA - dateB : dateB - dateA;
    });

    postListContainer.innerHTML = '';
    if (sortedPosts.length > 0) {
        const postsFragment = renderPostList(sortedPosts, currentViewDID);
        postListContainer.appendChild(postsFragment);
    } else {
        const noResultsContainer = document.createElement('div');
        noResultsContainer.className = 'atproto-no-filter-results-container';
        const noResultsMsg = document.createElement('p');
        noResultsMsg.className = 'atproto-no-filter-results';
        const displayId = sanitize(currentViewHandle || currentViewDID); // Use handle if known, else DID

        if (currentListSearchTerm && currentCategoryFilter) { noResultsMsg.textContent = `No posts found for "${displayId}" in category "${sanitize(currentCategoryFilter)}" matching your filter.`; }
        else if (currentListSearchTerm) { noResultsMsg.textContent = `No posts match your filter for "${displayId}".`; }
        else if (currentCategoryFilter) { noResultsMsg.textContent = `No posts found for "${displayId}" in category "${sanitize(currentCategoryFilter)}".`; }
        else if (postsToProcess.length === 0) {
            // Use imported isValidDID here
            const profileLink = isValidDID(currentViewDID) ? `<a href="https://bsky.app/profile/${currentViewDID}" target="_blank" rel="noopener">Go to their Bluesky profile</a>` : '';
            noResultsMsg.innerHTML = `No blog posts found for "${displayId}". ${profileLink}`;
            noResultsContainer.innerHTML += getSuggestedHtml();
        } else { noResultsMsg.textContent = `No posts match the current filters.`; }
        noResultsContainer.prepend(noResultsMsg);
        postListContainer.appendChild(noResultsContainer);
    }
}

// --- END OF FILE renderer.js ---