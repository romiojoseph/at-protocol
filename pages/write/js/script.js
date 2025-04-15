// js/script.js - Main entry point
import * as ui from './ui.js';
import * as state from './state.js';
import * as utils from './utils.js';
import { REQUIRED_FIELDS_FORM_IDS } from './config.js';


// --- DOM Element Access ---
function getEl(id) { return document.getElementById(id); }

// --- Button Disabling Helper ---
function disableButton(button) {
    if (button) button.disabled = true;
}
function enableButton(button) {
    if (button && button.id !== 'save-post-button') {
        // Don't automatically re-enable load-more button here, state handles it
        if (button.id !== 'load-more-button') {
            button.disabled = false;
        }
    } else if (button && button.id === 'save-post-button') {
        validateFormAndToggleButton();
    }
}
async function withButtonDisable(buttonOrId, asyncFunc) {
    const button = typeof buttonOrId === 'string' ? getEl(buttonOrId) : buttonOrId;
    if (!button) return;
    const wasInitiallyDisabled = button.disabled;
    disableButton(button);
    try { await asyncFunc(); }
    finally {
        // Special handling for load more button (state controls its enabled state)
        if (button.id !== 'load-more-button') {
            setTimeout(() => {
                if (!wasInitiallyDisabled || button.id !== 'save-post-button') {
                    enableButton(button);
                } else {
                    validateFormAndToggleButton();
                }
            }, 100);
        } else {
            // State logic will re-enable load-more if needed via ui.updateLoadMoreButton
        }
    }
}
function withButtonDisableSync(buttonOrId, func) {
    const button = typeof buttonOrId === 'string' ? getEl(buttonOrId) : buttonOrId;
    if (!button) return;
    const wasInitiallyDisabled = button.disabled;
    disableButton(button);
    try { func(); }
    finally {
        // Special handling for load more button
        if (button.id !== 'load-more-button') {
            setTimeout(() => {
                if (!wasInitiallyDisabled || button.id !== 'save-post-button') {
                    enableButton(button);
                } else {
                    validateFormAndToggleButton();
                }
            }, 100);
        }
    }
}


// --- Event Listeners ---
function setupEventListeners() {
    // Login/Logout
    getEl('login-form').addEventListener('submit', (e) => {
        e.preventDefault();
        withButtonDisable('login-button', () => state.handleLogin(e));
    });
    getEl('logout-button').addEventListener('click', (e) => {
        withButtonDisableSync(e.target, state.handleLogout);
    });

    // Main Actions
    getEl('show-create-form-button').addEventListener('click', (e) => {
        withButtonDisableSync(e.target, ui.showCreateForm);
    });
    getEl('export-button').addEventListener('click', (e) => {
        withButtonDisable(e.target, state.handleExport);
    });

    // ***** NEW: List Control Listeners *****
    let searchDebounceTimer;
    getEl('search-input').addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimer);
        const searchTerm = e.target.value;
        searchDebounceTimer = setTimeout(() => {
            state.handleSearchChange(searchTerm);
        }, 300); // Debounce search input
    });
    getEl('category-filter').addEventListener('change', (e) => {
        state.handleFilterChange(e.target.value);
    });
    getEl('sort-order').addEventListener('change', (e) => {
        state.handleSortChange(e.target.value);
    });
    getEl('load-more-button').addEventListener('click', (e) => {
        // Use withButtonDisable which handles disabling correctly
        withButtonDisable(e.target, state.handleLoadMore);
    });
    // ***** END OF List Control Listeners *****

    // Form Actions
    getEl('post-form').addEventListener('submit', (e) => {
        e.preventDefault();
        withButtonDisable('save-post-button', () => state.handleSavePost(e));
    });
    getEl('cancel-edit-button').addEventListener('click', ui.hidePostForm);

    // Slug Sanitization & Validation Trigger
    const slugField = getEl('slug');
    slugField.addEventListener('input', (e) => {
        e.target.value = utils.sanitizeSlug(e.target.value);
        validateFormAndToggleButton();
    });
    slugField.addEventListener('blur', (e) => {
        e.target.value = utils.sanitizeSlug(e.target.value, true);
        validateFormAndToggleButton();
    });

    // Form Validation for Save Button Enable/Disable
    const formFieldsToWatch = [
        ...REQUIRED_FIELDS_FORM_IDS.map(id => getEl(id)),
        getEl('authorDid'),
        getEl('publishedAt'),
        getEl('updatedAt')
    ].filter(el => el);

    formFieldsToWatch.forEach(field => {
        field.addEventListener('input', validateFormAndToggleButton);
        field.addEventListener('change', validateFormAndToggleButton);
        field.addEventListener('blur', validateFormAndToggleButton);
    });


    // Detail View Actions
    getEl('close-detail-button').addEventListener('click', ui.hidePostDetails);
    getEl('edit-from-detail-button').addEventListener('click', (e) => {
        const button = e.target;
        withButtonDisableSync(button, () => {
            const uriToEdit = button.dataset.uri;
            // Find in the *entire* cache now
            const postRecord = state.getFetchedPostsCache().find(p => p.uri === uriToEdit);
            if (postRecord) { ui.showEditForm(postRecord); }
            else { ui.showStatus("Could not find post data to edit.", 'error'); ui.hidePostDetails(); }
        });
    });

    // Field Validation Triggers (Author/Comment URI)
    let authorDebounceTimer;
    const authorHandleField = getEl('authorHandle');
    authorHandleField.addEventListener('blur', () => {
        clearTimeout(authorDebounceTimer);
        state.handleAuthorValidation().finally(validateFormAndToggleButton);
    });
    authorHandleField.addEventListener('keyup', () => {
        clearTimeout(authorDebounceTimer);
        validateFormAndToggleButton();
        authorDebounceTimer = setTimeout(() => {
            state.handleAuthorValidation().finally(validateFormAndToggleButton);
        }, 800);
    });
    getEl('bskyCommentsPostUri').addEventListener('blur', state.handleCommentUriValidation);

    // Clear Buttons
    document.querySelectorAll('.clear-btn').forEach(button => {
        button.addEventListener('click', (e) => {
            const targetInputId = e.target.dataset.target;
            const targetInput = getEl(targetInputId);
            if (targetInput) {
                targetInput.value = '';
                if (targetInputId === 'bskyCommentsPostUri') { state.handleCommentUriValidation(); }
                validateFormAndToggleButton();
                if (targetInputId === 'authorHandle') {
                    state.handleAuthorValidation().finally(validateFormAndToggleButton);
                }
            }
        });
    });

}

// --- Form Validation Logic ---
// validateFormAndToggleButton remains the same as previous correct version
// (It enables/disables save button based on required fields, author DID, slug pattern, dates)
function validateFormAndToggleButton() {
    let isFormValid = true;
    const form = getEl('post-form');
    if (!form) return;

    // 1. Basic required fields
    for (const id of REQUIRED_FIELDS_FORM_IDS) {
        const field = getEl(id);
        if (!field || !field.value?.trim()) {
            isFormValid = false; break;
        }
    }
    // 2. Author Handle -> DID
    if (isFormValid) {
        const authorHandleField = getEl('authorHandle');
        const authorDidField = getEl('authorDid');
        if (authorHandleField?.value.trim() && !authorDidField?.value.trim()) {
            isFormValid = false;
        }
    }
    // 3. Slug Pattern
    if (isFormValid) {
        const slugField = getEl('slug');
        if (slugField && !slugField.checkValidity()) {
            isFormValid = false;
        }
    }
    // 4. Dates
    if (isFormValid) {
        const publishedAtField = getEl('publishedAt');
        if (!publishedAtField || !utils.parseCustomDateString(publishedAtField.value.trim())) {
            isFormValid = false;
        }
    }
    if (isFormValid) {
        const updatedAtField = getEl('updatedAt');
        const updatedAtValue = updatedAtField?.value.trim();
        if (updatedAtValue && !utils.parseCustomDateString(updatedAtValue)) {
            isFormValid = false;
        }
    }

    // Enable/disable Save button
    const saveButton = getEl('save-post-button');
    if (saveButton) {
        saveButton.disabled = !isFormValid;
    }
}


// --- Initialization ---
// initializeApp remains the same
async function initializeApp() {
    ui.showLoading("Initializing...");
    setupEventListeners(); // Setup listeners early

    // Expose validation function globally for UI module (if not already done)
    // Ensure it's callable from setTimeout in populateForm
    window.validateFormAndToggleButton = validateFormAndToggleButton;


    const resumed = await state.attemptResumeSession();
    if (!resumed) {
        ui.hideLoading();
        ui.showLogin();
    }
}

// --- Start the app ---
document.addEventListener('DOMContentLoaded', initializeApp);