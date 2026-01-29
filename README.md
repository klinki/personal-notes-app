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

### Check Database Location

To see where your notes are currently stored and which configuration source is being used:

```bash
mnote where
# Output:
# /Users/username/.mnote
# (Source: standard location)
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
