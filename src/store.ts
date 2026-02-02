import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, readdir, readFile, unlink, rename } from 'node:fs/promises';
import { existsSync, mkdirSync } from 'node:fs';
import { Database } from 'bun:sqlite';
import matter from 'gray-matter';

let MNOTE_HOME = join(homedir(), '.mnote');
let LOCATION_SOURCE = 'standard location';

if (process.env.MNOTE_HOME) {
    MNOTE_HOME = process.env.MNOTE_HOME;
    LOCATION_SOURCE = 'MNOTE_HOME environment variable';
}

/**
 * Sets the database location path.
 * @param path - The new path for the database directory
 */
export function setDbLocation(path: string) {
    MNOTE_HOME = resolve(path);
    LOCATION_SOURCE = '--dbLocation flag';
}

/**
 * Gets information about the current database location.
 * @returns An object containing the resolved path and the source of the location setting
 */
export function getDbInfo() {
    return {
        path: resolve(MNOTE_HOME),
        source: LOCATION_SOURCE
    };
}

/**
 * Gets the path to the configuration file.
 * @returns The absolute path to config.json
 */
export function getConfigPath() {
    return join(MNOTE_HOME, 'config.json');
}

/**
 * Converts text to a URL-friendly slug.
 * @param text - The text to slugify
 * @returns A slugified version of the text
 */
export function slugify(text: string): string {
    return text
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, '') // remove non-alphanumeric chars
        .replace(/\s+/g, '-') // replace spaces with hyphens
        .replace(/-+/g, '-') // remove consecutive hyphens
        .replace(/^-+|-+$/g, ''); // remove leading/trailing hyphens
}

let dbInstance: Database | null = null;
let dbInstancePath: string | null = null;

/**
 * Gets the database instance, creating it if necessary.
 * @returns The SQLite database instance
 */
export function getDB() {
    const dbPath = join(MNOTE_HOME, 'mnote.db');

    if (dbInstance) {
        if (dbInstancePath === dbPath) {
            return dbInstance;
        }
        dbInstance.close();
    }

    if (!existsSync(MNOTE_HOME)) {
        mkdirSync(MNOTE_HOME, { recursive: true });
    }

    dbInstance = new Database(dbPath, { create: true });
    // Enable WAL mode for better concurrency and less file locking
    dbInstance.run("PRAGMA journal_mode = WAL;");
    // Enable busy timeout (5000ms) to handle concurrency/locking
    dbInstance.run("PRAGMA busy_timeout = 5000;");

    dbInstancePath = dbPath;
    initDB(dbInstance);
    return dbInstance;
}

/**
 * Closes the database connection.
 */
export function closeDB() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
        dbInstancePath = null;
    }
}

function initDB(db: Database) {
    db.run(`
        CREATE TABLE IF NOT EXISTS notes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book TEXT NOT NULL,
            filename TEXT NOT NULL,
            path TEXT NOT NULL UNIQUE,
            content TEXT,
            tags TEXT
        );
    `);

    try {
        db.run("ALTER TABLE notes ADD COLUMN tags TEXT");
    } catch (e) {
        // Ignore error if column already exists
    }

    const ftsExists = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='notes_fts';").get();
    if (!ftsExists) {
        // We use a separate FTS table and will keep it in sync manually for now or via triggers if we went with external content,
        // but explicit updates are easier to debug in application logic sometimes.
        // Let's stick to the plan: separate table.
        db.run(`CREATE VIRTUAL TABLE notes_fts USING fts5(book, filename, path, content);`);
    }
}

/**
 * Indexes a note in the database for full-text search.
 * @param book - The book (folder) name containing the note
 * @param filename - The filename of the note
 * @param content - The content of the note
 * @param path - The full filesystem path to the note
 */
export function indexNote(book: string, filename: string, content: string, path: string) {
    const db = getDB();
    const existing = db.query("SELECT id FROM notes WHERE book = $book AND filename = $filename").get({ $book: book, $filename: filename }) as { id: number } | null;

    // Extract tags
    let tagsStr: string | null = null;
    try {
        const parsed = matter(content);
        if (parsed.data.tags) {
            const tags = Array.isArray(parsed.data.tags) ? parsed.data.tags : [parsed.data.tags]; // Handle single tag string
            // Store as comma-separated with padding for easy LIKE search: ,tag1,tag2,
            tagsStr = ',' + tags.map((t: any) => String(t).trim()).join(',') + ',';
        }
    } catch (e) {
        // Ignore parsing errors
    }

    db.transaction(() => {
        if (existing) {
            db.query("UPDATE notes SET book = $book, filename = $filename, content = $content, tags = $tags WHERE id = $id")
                .run({ $book: book, $filename: filename, $content: content, $tags: tagsStr, $id: existing.id });

            db.query("DELETE FROM notes_fts WHERE rowid = $id").run({ $id: existing.id });
            db.query("INSERT INTO notes_fts (rowid, book, filename, path, content) VALUES ($id, $book, $filename, $path, $content)")
                .run({ $id: existing.id, $book: book, $filename: filename, $path: path, $content: content });
        } else {
            const result = db.query("INSERT INTO notes (book, filename, path, content, tags) VALUES ($book, $filename, $path, $content, $tags)")
                .run({ $book: book, $filename: filename, $path: path, $content: content, $tags: tagsStr });

            const lastId = result.lastInsertRowid;
            db.query("INSERT INTO notes_fts (rowid, book, filename, path, content) VALUES ($id, $book, $filename, $path, $content)")
                .run({ $id: lastId, $book: book, $filename: filename, $path: path, $content: content });
        }
    })();
}

/**
 * Removes a note from the search index.
 * @param book - The book (folder) name containing the note
 * @param filename - The filename of the note to unindex
 */
export function unindexNote(book: string, filename: string) {
    const db = getDB();
    const existing = db.query("SELECT id FROM notes WHERE book = $book AND filename = $filename").get({ $book: book, $filename: filename }) as { id: number } | null;

    if (existing) {
        db.transaction(() => {
            db.query("DELETE FROM notes WHERE id = $id").run({ $id: existing.id });
            db.query("DELETE FROM notes_fts WHERE rowid = $id").run({ $id: existing.id });
        })();
    }
}

/**
 * Gets the filesystem path for a book, creating the directory if it doesn't exist.
 * @param book - The name of the book (can be nested like "folder/subfolder")
 * @returns The absolute path to the book directory
 * @throws Error if the book name attempts to traverse outside the home directory
 */
export async function getBookPath(book: string) {
    const resolvedHome = resolve(MNOTE_HOME);
    const path = resolve(resolvedHome, book);

    const rel = relative(resolvedHome, path);

    if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Invalid book name: ${book} attempts to traverse outside home directory`);
    }

    await mkdir(path, { recursive: true });
    return path;
}

/**
 * Gets a list of available templates.
 * @returns An array of template filenames (without path)
 */
export async function getTemplates() {
    const templatesDir = join(MNOTE_HOME, '.foam', 'templates');
    if (!existsSync(templatesDir)) {
        return [];
    }
    const entries = await readdir(templatesDir, { withFileTypes: true });
    return entries
        .filter(e => e.isFile() && e.name.endsWith('.md'))
        .map(e => e.name);
}

/**
 * Applies a template by reading it and substituting variables.
 * @param templateName - The name of the template file (without path)
 * @returns The template content with variables substituted
 * @throws Error if the template is not found
 */
export async function applyTemplate(templateName: string) {
    const templatePath = join(MNOTE_HOME, '.foam', 'templates', templateName);
    if (!existsSync(templatePath)) {
        throw new Error(`Template "${templateName}" not found.`);
    }
    let content = await readFile(templatePath, 'utf-8');

    const now = new Date();
    const vars: Record<string, string> = {
        '$DATE_YEAR': String(now.getFullYear()),
        '$DATE_MONTH': String(now.getMonth() + 1).padStart(2, '0'),
        '$DATE_DAY': String(now.getDate()).padStart(2, '0'),
        '$DATE_HOUR': String(now.getHours()).padStart(2, '0'),
        '$DATE_MINUTE': String(now.getMinutes()).padStart(2, '0'),
        '$DATE_SECOND': String(now.getSeconds()).padStart(2, '0'),
        '$FOAM_TITLE': 'untitled' // Default, can be overridden if we had title logic
    };

    for (const [key, value] of Object.entries(vars)) {
        content = content.split(key).join(value);
    }

    return content;
}

/**
 * Options for adding a note.
 */
export interface AddNoteOptions {
    /** The template name to use */
    template?: string;
    /** Array of tags to add to the note */
    tags?: string[];
    /** The title of the note */
    title?: string;
}

/**
 * Adds a new note to a book.
 * @param book - The book (folder) name to add the note to
 * @param content - The content of the note
 * @param options - Optional settings for the note
 */
export async function addNote(book: string, content: string, options: AddNoteOptions = {}) {
    const bookPath = await getBookPath(book);

    let finalTitle = options.title;

    if (!finalTitle) {
        // Try to parse from first line of content
        const firstLine = content.split('\n')[0].trim();
        // Remove leading #, -, *, etc if it looks like a header or list item
        const cleanLine = firstLine.replace(/^[\s#\-\*]+/, '').trim();
        if (cleanLine.length > 0) {
            finalTitle = cleanLine;
        } else {
            finalTitle = 'untitled';
        }
    }

    const slug = slugify(finalTitle);

    const now = new Date();
    const datePrefix = now.getFullYear() +
        '-' + String(now.getMonth() + 1).padStart(2, '0') +
        '-' + String(now.getDate()).padStart(2, '0');

    let filename = `${datePrefix}-${slug}.md`;
    let filePath = join(bookPath, filename);

    // Collision check
    let counter = 1;
    while (existsSync(filePath)) {
        filename = `${datePrefix}-${slug}-${counter}.md`;
        filePath = join(bookPath, filename);
        counter++;
    }

    // Handle Templates
    let finalContent = content;
    if (options.template) {
        let templateContent = await applyTemplate(options.template);

        // Merge content: if user provided content, append it to template or vice versa?
        // Usually template is the base.
        // If content is provided (e.g. via editor), we might want to just append it
        // or if content is empty, just use template.
        if (finalContent) {
            templateContent += '\n' + finalContent;
        }
        finalContent = templateContent;
    }

    // Handle Tags via Frontmatter
    if (options.tags && options.tags.length > 0) {
        const parsed = matter(finalContent);
        const existingTags = parsed.data.tags || [];
        const newTags = Array.isArray(existingTags)
            ? [...new Set([...existingTags, ...options.tags])]
            : [...new Set([existingTags, ...options.tags])]; // Handle case where tags is string

        parsed.data.tags = newTags;
        finalContent = matter.stringify(parsed.content, parsed.data);
    } else if (options.template) {
        // Even if no extra tags, we should ensure template frontmatter is preserved/parsed correctly if needed
        // But simple string concat works for simple templates.
        // However, applyTemplate returns string.
    }

    await writeFile(filePath, finalContent);
    try {
        indexNote(book, filename, finalContent, filePath);
    } catch (e: any) {
        console.error('Warning: Failed to update search index:', e.message);
    }
    console.log(`Note saved to ${filePath}`);
}

/**
 * Recursively gets all books (subdirectories) under the notes directory.
 * @param dir - The directory to search in (defaults to MNOTE_HOME)
 * @param parent - The parent path prefix for nested books
 * @returns An array of book names (with nested paths like "parent/child")
 */
export async function getBooksRecursive(dir = MNOTE_HOME, parent = ''): Promise<string[]> {
    if (!existsSync(dir)) return [];

    let books: string[] = [];
    const entries = await readdir(dir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (entry.isDirectory()) {
            const bookName = parent ? `${parent}/${entry.name}` : entry.name;
            books.push(bookName);
            const subBooks = await getBooksRecursive(join(dir, entry.name), bookName);
            books = books.concat(subBooks);
        }
    }
    return books;
}

/**
 * Gets all notes in a book.
 * @param book - The book (folder) name
 * @returns An array of notes with filename and content
 */
export async function getNotes(book: string) {
    const bookPath = join(MNOTE_HOME, book);
    if (!existsSync(bookPath)) {
        return [];
    }
    const entries = await readdir(bookPath);
    const notes = [];
    for (const entry of entries) {
        if (entry.endsWith('.md')) {
            const content = await readFile(join(bookPath, entry), 'utf-8');
            notes.push({ filename: entry, content });
        }
    }
    return notes.sort((a, b) => a.filename.localeCompare(b.filename));
}

/**
 * Deletes a note from a book.
 * @param book - The book (folder) name
 * @param index - The 1-based index of the note to delete
 * @returns The filename of the deleted note
 * @throws Error if the index is invalid
 */
export async function deleteNote(book: string, index: number) {
    const notes = await getNotes(book);
    if (index < 1 || index > notes.length) {
        throw new Error(`Invalid note index: ${index}`);
    }
    const noteToDelete = notes[index - 1];
    const bookPath = await getBookPath(book);
    const filePath = join(bookPath, noteToDelete.filename);
    await unlink(filePath);
    try {
        unindexNote(book, noteToDelete.filename);
    } catch (e: any) {
        console.error('Warning: Failed to update search index:', e.message);
    }
    return noteToDelete.filename;
}

/**
 * Gets a specific note by index.
 * @param book - The book (folder) name
 * @param index - The 1-based index of the note
 * @returns The note object with filename, content, and path
 * @throws Error if the index is invalid
 */
export async function getNote(book: string, index: number) {
    const notes = await getNotes(book);
    if (index < 1 || index > notes.length) {
        throw new Error(`Invalid note index: ${index}`);
    }
    const note = notes[index - 1];
    const bookPath = await getBookPath(book);
    const filePath = join(bookPath, note.filename);

    return {
        ...note,
        path: filePath
    };
}

/**
 * Updates the content of an existing note.
 * @param book - The book (folder) name
 * @param filename - The filename of the note to update
 * @param content - The new content
 */
export async function updateNote(book: string, filename: string, content: string) {
    const bookPath = await getBookPath(book);
    const filePath = join(bookPath, filename);
    await writeFile(filePath, content);
    try {
        indexNote(book, filename, content, filePath);
    } catch (e: any) {
        console.error('Warning: Failed to update search index:', e.message);
    }
}

/**
 * Moves a note from one book to another.
 * @param book - The source book (folder) name
 * @param index - The 1-based index of the note to move
 * @param targetBook - The destination book (folder) name
 */
export async function moveNote(book: string, index: number, targetBook: string) {
    const note = await getNote(book, index);
    // Add to new book (this handles timestamp collision automatically in addNote logic, 
    // BUT addNote creates a new timestamp. To preserve timestamp or content? 
    // dnote usually moves. Let's read content and add as new note to target, then delete old.
    // This assigns a NEW timestamp which is good practice for "created at", 
    // but maybe we want to keep the old filename?
    // Let's stick to "addNote" logic for safety and consistency.
    await addNote(targetBook, note.content);
    await deleteNote(book, index);
}

/**
 * Renames a book (folder).
 * @param oldName - The current name of the book
 * @param newName - The new name for the book
 * @throws Error if the book doesn't exist or new name already exists
 */
export async function renameBook(oldName: string, newName: string) {
    const oldPath = await getBookPath(oldName);
    // getBookPath creates it if missing, but we want to know if it exists to rename
    if (!existsSync(oldPath)) {
        throw new Error(`Book "${oldName}" does not exist`);
    }

    // We need to calculate new path manually to avoid 'mkdir' side effect of getBookPath on destination check?
    // Actually getBookPath is fine, it ensures parent exists.
    // But we need to construct the new path.
    const root = resolve(MNOTE_HOME); // MNOTE_HOME is module scope var
    const newPath = join(root, newName);

    if (existsSync(newPath)) {
        throw new Error(`Book "${newName}" already exists`);
    }

    await rename(oldPath, newPath);
    try {
        updateBookInDb(oldName, newName);
    } catch (e: any) {
        console.error('Warning: Failed to update search index:', e.message);
    }
}



/**
 * Updates book names in the database after a rename operation.
 * @param oldName - The old book name
 * @param newName - The new book name
 */
export function updateBookInDb(oldName: string, newName: string) {
    const db = getDB();
    const notes = db.query("SELECT * FROM notes WHERE book = $oldName OR book LIKE $oldNameLike")
        .all({ $oldName: oldName, $oldNameLike: `${oldName}/%` }) as any[];

    const root = resolve(MNOTE_HOME);

    db.transaction(() => {
        for (const note of notes) {
            let newBook = note.book === oldName ? newName : note.book.replace(oldName + '/', newName + '/');
            // Reconstruct path reliably
            const newPath = resolve(root, newBook, note.filename);

            // Update notes table
            db.query("UPDATE notes SET book = $newBook, path = $newPath WHERE id = $id")
                .run({ $newBook: newBook, $newPath: newPath, $id: note.id });

            // Update FTS table - delete and re-insert is easiest
            db.query("DELETE FROM notes_fts WHERE rowid = $id").run({ $id: note.id });
            db.query("INSERT INTO notes_fts (rowid, book, filename, path, content) VALUES ($id, $book, $filename, $path, $content)")
                .run({ $id: note.id, $book: newBook, $filename: note.filename, $path: newPath, $content: note.content });
        }
    })();
}

/**
 * Represents a search result containing note metadata and content.
 */
export interface SearchResult {
    /** The book (folder) name */
    book: string;
    /** The filename of the note */
    filename: string;
    /** The content of the note */
    content: string;
}

/**
 * Finds notes matching keywords and optional filters.
 * @param keyword - The search keyword(s)
 * @param book - Optional book name to search within
 * @param tag - Optional tag to filter by
 * @returns An array of matching search results
 */
export async function findNotes(keyword: string, book?: string, tag?: string): Promise<SearchResult[]> {
    const dbPath = join(MNOTE_HOME, 'mnote.db');
    if (!existsSync(dbPath)) {
        console.error('Database not found. Rebuilding from notes...');
        try {
            await rebuildDB();
        } catch (e: any) {
            console.error('Failed to rebuild database:', e.message);
            return [];
        }
    }

    const db = getDB();
    let query = "";
    let params: any = {};

    if (tag) {
        const tagPattern = `%,${tag},%`;

        if (keyword) {
            let matchQuery = keyword;
            if (!keyword.includes('"')) {
                matchQuery = `${keyword}*`;
            }
            query = `
                SELECT fts.book, fts.filename, fts.content 
                FROM notes_fts fts
                JOIN notes n ON fts.rowid = n.id
                WHERE notes_fts MATCH $keyword 
                AND n.tags LIKE $tagPattern
             `;
            params = { $keyword: matchQuery, $tagPattern: tagPattern };
            if (book) {
                query += " AND fts.book = $book";
                params.$book = book;
            }
            query += " ORDER BY rank";
        } else {
            query = `
                SELECT book, filename, content 
                FROM notes 
                WHERE tags LIKE $tagPattern
             `;
            params = { $tagPattern: tagPattern };
            if (book) {
                query += " AND book = $book";
                params.$book = book;
            }
            query += " ORDER BY filename";
        }
    } else {
        let matchQuery = keyword;
        if (!keyword.includes('"')) {
            matchQuery = `${keyword}*`;
        }
        query = "SELECT book, filename, content FROM notes_fts WHERE notes_fts MATCH $keyword";
        params = { $keyword: matchQuery };
        if (book) {
            query += " AND book = $book";
            params.$book = book;
        }
        query += " ORDER BY rank";
    }

    try {
        const results = db.query(query).all(params) as SearchResult[];
        return results;
    } catch (e: any) {
        console.error("Search error:", e.message);
        return [];
    }
}

/**
 * Rebuilds the search index from all markdown files.
 */
export async function rebuildDB() {
    const db = getDB();
    // Clear tables
    db.run("DELETE FROM notes");
    db.run("DELETE FROM notes_fts");

    // Reset sequence
    db.run("DELETE FROM sqlite_sequence WHERE name='notes'");

    // Re-index
    const books = await getBooksRecursive();
    let count = 0;
    for (const book of books) {
        const notes = await getNotes(book);
        for (const note of notes) {
            // Reconstruct path
            const bookPath = await getBookPath(book);
            const filePath = join(bookPath, note.filename);
            try {
                indexNote(book, note.filename, note.content, filePath);
                count++;
            } catch (e: any) {
                console.error(`Failed to index ${filePath}: ${e.message}`);
            }
        }
    }
    console.log(`Rebuild complete. Indexed ${count} notes.`);
}

/**
 * Result of a database consistency check.
 */
export interface DBCheckResult {
    /** Whether the database is consistent with the filesystem */
    status: 'consistent' | 'inconsistent';
    /** Files present on disk but missing from the database */
    missingOnDisk: { book: string, filename: string }[];
    /** Files present in the database but missing from disk */
    missingInDB: { book: string, filename: string }[];
}

/**
 * Checks database consistency against the filesystem.
 * @returns A DBCheckResult with status and any inconsistencies found
 */
export async function checkDB(): Promise<DBCheckResult> {
    const db = getDB();
    const dbNotes = db.query("SELECT book, filename, path FROM notes").all() as { book: string, filename: string, path: string }[];

    // Build set of DB keys (book/filename)
    const dbSet = new Set(dbNotes.map(n => `${n.book}/${n.filename}`));

    const missingInDB: { book: string, filename: string }[] = [];
    const missingOnDisk: { book: string, filename: string }[] = [];

    // Check disk vs DB
    const books = await getBooksRecursive();
    const diskSet = new Set<string>();

    for (const book of books) {
        const notes = await getNotes(book);
        for (const note of notes) {
            const key = `${book}/${note.filename}`;
            diskSet.add(key);
            if (!dbSet.has(key)) {
                missingInDB.push({ book, filename: note.filename });
            }
        }
    }

    // Check DB vs disk
    for (const dbNote of dbNotes) {
        const key = `${dbNote.book}/${dbNote.filename}`;
        if (!diskSet.has(key)) {
            missingOnDisk.push({ book: dbNote.book, filename: dbNote.filename });
        }
    }

    const status = (missingInDB.length === 0 && missingOnDisk.length === 0) ? 'consistent' : 'inconsistent';

    return {
        status,
        missingOnDisk,
        missingInDB
    };
}
