// --- START OF FILE config.js ---

// js/config.js

// --- Configuration ---
export const BLOG_POST_NSID = 'app.blog.post';
export const MAX_LIST_LIMIT = 100; // Max records per API request
export const MAX_PAGES_FOR_INITIAL_LOAD = 30; // Limit pages when fetching all posts for a user

// --- API ---
export const LIST_RECORDS_BASE_URL = 'https://bsky.social/xrpc/com.atproto.repo.listRecords';
export const RESOLVE_HANDLE_URL = 'https://bsky.social/xrpc/com.atproto.identity.resolveHandle';

// --- DOM IDs and Classes ---
export const APP_CONTAINER_ID = 'atproto-app-container';
export const LOADING_OVERLAY_ID = 'atproto-loading-overlay';
export const LOADING_TEXT_ID = 'atproto-loading-text';
export const POST_LIST_ID = 'atproto-post-list'; // For the results list
export const POST_ARTICLE_CLASS = 'atproto-post-article'; // Class for individual post articles in the list

// --- IDs for Search Form ---
export const SEARCH_FORM_ID = 'atproto-user-search-form';
export const SEARCH_INPUT_ID = 'atproto-user-search-input';
export const SEARCH_BUTTON_ID = 'atproto-user-search-button';
export const SEARCH_FORM_CONTAINER_ID = 'atproto-search-form-container';

// --- IDs for List Controls (on results page) ---
export const LIST_CONTROLS_ID = 'atproto-list-controls';
export const LIST_SEARCH_INPUT_ID = 'atproto-list-search-input';
export const SORT_SELECT_ID = 'atproto-sort-select';
export const CATEGORY_FILTER_ID = 'atproto-category-filter';

// --- Standalone Widget Integration ---
export const COMMENTS_WRAPPER_TARGET_ID = 'atproto-comments-wrapper-target';
export const BSKY_WIDGET_TARGET_ID = 'bluesky-comment-widget';

// --- Other ---
export const DEFAULT_BLOG_TITLE = 'AT Pages: Search and read long-form posts on ATProto';
export const DEFAULT_BLOG_DESCRIPTION = 'Create, search, and view long-form Bluesky posts with ATProto. No character limits. Posts stay in your repo and load via a simple frontend.';
export const SEARCH_DEBOUNCE_DELAY = 300;

// --- END OF FILE config.js ---