# Bluesky AT Pages Manager (CLI)

A command-line interface (CLI) tool to create, manage (list, view, edit, delete), and export long form posts stored as custom records (`app.blog.post`) on the Bluesky AT Protocol network. You can also use the front-end of this tool using the below tool

<mark>**To view these posts, you need a frontend that supports them**</mark>. I have created one for public use. You can copy the link and share it anywhere.

*You can also use the frontend of this tool with the tool below. Click Write.*

<button class="btn-primary" onclick="window.open('https://skywrite.pages.dev/', '_blank', 'noopener');">
	Search and find your pages
</button>
## Prerequisites

*   **Node.js:** Version 18 or later recommended.
*   **npm**: Comes bundled with Node.js.

## Installation

1.  **Save the Script:** Place the `pages.mjs` file in a dedicated directory on your computer.
2.  **Install Dependencies:** Open your terminal, navigate (`cd`) into that directory, and run:
    ```bash
    npm install inquirer @atproto/api dotenv date-fns
    ```

## Configuration

This script requires Bluesky credentials to interact with the network.

1.  **Create an App Password:**
    *   Go to your Bluesky Settings -> App Passwords.
    *   Generate a new App Password specifically for this tool. **Do NOT use your main account password.** This is more secure.
    *   Copy the generated App Password (it will look something like `xxxx-xxxx-xxxx-xxxx`).

2.  **Create a `.env` file:**
    *   In the *same directory* where you saved `pages.mjs`, create a file named `.env`.
    *   Add your Bluesky handle and the App Password you just created to this file, using the following format:

    ```dotenv
    # .env file content
    BLUESKY_HANDLE=your-handle.bsky.social
    BLUESKY_APP_PASSWORD=xxxx-xxxx-xxxx-xxxx
    ```
    *   Replace `your-handle.bsky.social` with your actual Bluesky handle and `xxxx-xxxx-xxxx-xxxx` with your generated App Password.
    *   Save the `.env` file.

## Usage

Once installed and configured, run the script from your terminal within the directory containing the script and the `.env` file:

```bash
node pages.mjs
```

The script will log in and present you with a menu of options:

1.  **Create New Post:** Guides you through entering the details for a new post.
2.  **Manage Posts:** Lists existing posts with options to view details, edit, or delete them. Supports pagination for long lists.
3.  **Export All Posts to JSON:** Fetches all your `app.blog.post` records and saves them to a timestamped JSON file in the script's directory.
4.  **Exit:** Closes the script.

## Post Fields

When creating or editing posts, you will be prompted for various fields.

### Required Fields

These fields must have a value:

*   `title`: The main title of the post.
*   `shortDescription`: A brief summary (max 160 characters suggested).
*   `authorHandle`: The Bluesky handle of the author (validated). Defaults to your logged-in handle.
*   `slug`: The URL-friendly identifier (e.g., `my-first-post`). Must be lowercase letters, numbers, and single hyphens only.
*   `category`: A single category name (no commas).
*   `content`: The main body of the post (uses your system's default text editor or a basic internal one or copy paste the content from Obsidian like tools).
*   `publishedAt`: The date and time the post should be considered published.

### Optional Fields
These fields can be left empty or cleared using the special command `(clear)` during input:

*   `coverImage`: URL of a cover image for the post.
*   `tags`: Comma-separated list of tags (e.g., `tech, bluesky, atproto`).
*   `updatedAt`: The date and time the post was last updated. If left blank/cleared during an edit, it defaults to the current time.
*   `bskyCommentsPostUri`: The AT URI (`at://...`) or Bluesky Web URL (`https://bsky.app/profile/.../post/...`) of a Bluesky post to be used for comments.
*   `recommended`: A simple Yes/No flag to mark the post as recommended.

*(Note: `authorDid` and `authorDisplayName` are derived automatically from the validated `authorHandle` and are not directly inputted.)*

## Notes

*   **Date Format:** When entering dates (`publishedAt`, `updatedAt`), use the format `dd MMM yyyy hh:mm a` (e.g., `21 Mar 2025 03:30 PM`). ISO format (like `2025-03-21T15:30:00.000Z`) is also accepted.
*   **Clear Command:** For *optional* text fields, you can type exactly `(clear)` (including parentheses) to remove any existing value for that field.
*   **NSID:** The script uses the specific Namespace ID (NSID) `app.blog.post` for all records.