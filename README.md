# mnote

A simple command-line note-taking application inspired by `dnote`, but storing data as Markdown files in a directory tree.

## Prerequisites

- [Bun](https://bun.sh) runtime.

## Installation

Clone the repository and install dependencies:

```bash
git clone <repository-url>
cd mnote
bun install
```

You can run the tool using `bun run src/index.ts`. For convenience, you might want to alias it or build a binary.

```bash
# Alias
alias mnote="bun run $(pwd)/src/index.ts"

# Or build binary
bun build ./src/index.ts --compile --outfile mnote
```

## Usage

### Add a Note

Add a note to a "book" (category). If the book doesn't exist, it will be created.

```bash
mnote add <book> "Your note content"
```

Example:

```bash
mnote add tech/linux "This is a note about Linux"
```

If you omit the content, `mnote` will open your default editor (specified by `$EDITOR` environment variable).

```bash
mnote add tech/linux
```

### View Notes

View all notes in a specific book.

```bash
mnote view <book>
```

Example:

```bash
mnote view tech/linux
```

### Edit Notes

Edit a note or a book.

#### Edit Content

Interactive edit (opens $EDITOR):
```bash
mnote edit <book> <index>
# Example: mnote edit tech/linux 1
```

Inline update:
```bash
mnote edit <book> <index> -c "New content"
```

#### Move Note

Move a note from one book to another:
```bash
mnote edit <book> <index> -b <target_book>
# Example: mnote edit tech/linux 1 -b archived/linux
```

#### Rename Book

Rename an entire book:
```bash
mnote edit <book> -n <new_name>
# Example: mnote edit javascript -n ts-migration
```

### List Books

List all available books (directories).

```bash
mnote list
```

### Find Notes

You can search for notes containing specific keywords:

```bash
mnote find "important meeting"
mnote find "project x" --book work
```

### Sync Notes

Synchronize your notes with a remote Git repository.

```bash
mnote sync
```

This command:
1.  Commits local changes with a timestamp.
2.  Pulls remote changes (using rebase).
3.  Pushes local changes.

**Note**: You must initialize the `mnote` directory as a Git repository and verify the remote origin is configured.

```bash
cd /path/to/mnote/db
git init
git remote add origin <url>
```

### Auto Sync

You can enable automatic synchronization after every change (`add`, `edit`, `delete`) by setting the `autosync` configuration:

```bash
mnote config set autosync true
```

When enabled, `mnote` will attempt to sync changes immediately. If the sync fails (e.g. network issue), it logs the error but does not stop the operation.

### Background Service

For a robust "set and forget" experience, you can install a background service that syncs your notes periodically (default: every 60 seconds).

**Install Service:**
```bash
mnote service install --interval 60
```
*(Currently supported on Windows via Task Scheduler)*

**Uninstall Service:**
```bash
mnote service uninstall
```

**Run Daemon Manually:**
If you prefer not to install a system service, you can run the daemon directly in your terminal:
```bash
mnote daemon --interval 30
```

**Concurrency Control:**
Both Auto Sync and the Background Service use a safe file-locking mechanism (`.mnote-sync.lock`) to prevent conflicts. If a sync is already in progress, other sync attempts will wait or skip.

### Check Database Location

To see where your notes are currently stored and which configuration source is being used:

```bash
mnote where
# Output:
# /Users/username/.mnote
# (Source: standard location)
```

### Browsing & Indexing

`mnote` automatically maintains a `README.md` and `INDEX.md` files in your note store to allow for easy browsing of your notes via a file explorer or GitHub/GitLab UI.

- **Root README.md**: A tree view of all your books.
- **Book INDEX.md**: A list of notes and sub-books within a folder.

These files are updated automatically whenever you add, delete, or move notes using the CLI.

**Manual Reindex:**

If you manually modify files or want to force a regeneration of all index files, use the `reindex` command:

```bash
mnote reindex
```

### Help

You can get help for any command using the `help` command or `--help` / `-h` flags.

```bash
mnote --help
mnote help delete
mnote delete --help
mnote delete -h
```

## Configuration

### Manage Configuration

You can configure `mnote` using the `config` command. The configuration is stored in `config.json` in the `mnote` home directory.

#### Set Configuration

```bash
mnote config set <key> <value>
```

Values are parsed as JSON if possible, otherwise stored as strings. Dot notation is supported for nested keys.

Example:
```bash
mnote config set editor "nano"
mnote config set ui.theme.dark true
```

#### Get Configuration

```bash
mnote config get <key>
```

Example:
```bash
mnote config get editor
```

### Configuration Precedence

For configuration options (like `editor`), the order of precedence is:

1.  Environment variable (e.g., `EDITOR`)
2.  Configuration file (`config.json`)
3.  Default value

### Storage Location

By default, notes are stored in `~/.mnote`.
You can change this by setting the `MNOTE_HOME` environment variable.

```bash
export MNOTE_HOME=~/my-notes
mnote list
```

### Editor

`mnote` determines which editor to use based on the following precedence:
1. `EDITOR` environment variable.
2. `editor` value in configuration.
3. Default: `vi`.

```bash
# Using env var
export EDITOR=nano
mnote add mybook

# Using config
mnote config set editor code
```

## File Structure

Notes are stored as Markdown files with timestamp-based filenames. Directories represent "books".

```
~/.mnote/
├── tech/
│   ├── linux/
│   │   ├── 2025-01-15-10-00-00.md
│   │   └── 2025-01-15-10-05-00.md
│   └── macos/
│       └── ...
└── personal/
    └── ...
```

This structure is compatible with other Markdown-based tools like [Foam](https://foamnotes.com/).
