// js/config.js
export const BLOG_POST_NSID = 'app.blog.post';
export const CUSTOM_DATE_FORMAT = 'dd MMM yyyy hh:mm a'; // For display/parsing user input hint
export const DATETIME_LOCAL_FORMAT = "yyyy-MM-dd'T'HH:mm"; // For setting <input type="datetime-local"> value
export const LOCALSTORAGE_SESSION_KEY = 'bskyBlogManagerSession';
export const POSTS_PER_PAGE = 25; // Number of posts to load per batch (configurable, must be <= 100)
export const SESSION_MAX_AGE_HOURS = 15 / 60; // Set for 15 Minute fixed duration timeout


// Added 'recommended' to this conceptual list
export const POST_FIELDS = [
    'title', 'shortDescription', 'authorHandle', 'authorDid', 'authorDisplayName',
    'slug', 'category', 'content',
    'coverImage', 'tags', 'publishedAt', 'updatedAt', 'bskyCommentsPostUri',
    'recommended' // Added field
];
export const REQUIRED_FIELDS_FORM_IDS = [
    'title', 'shortDescription', 'authorHandle',
    'slug', 'category', 'content', 'publishedAt'
];