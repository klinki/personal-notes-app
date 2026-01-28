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

### List Books

List all available books (directories).

```bash
mnote list
```

## Configuration

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

### Storage Location

By default, notes are stored in `~/.mnote`.
You can change this by setting the `MNOTE_HOME` environment variable.

```bash
export MNOTE_HOME=~/my-notes
mnote list
```

### Editor

`mnote` uses the `$EDITOR` environment variable to determine which editor to open. Default is `vi`.

```bash
export EDITOR=nano
mnote add mybook
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
