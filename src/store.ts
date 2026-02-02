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

export function setDbLocation(path: string) {
    MNOTE_HOME = resolve(path);
    LOCATION_SOURCE = '--dbLocation flag';
}

export function getDbInfo() {
    return {
        path: resolve(MNOTE_HOME),
        source: LOCATION_SOURCE
    };
}

export function getConfigPath() {
    return join(MNOTE_HOME, 'config.json');
}

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

export interface AddNoteOptions {
    template?: string;
    tags?: string[];
    title?: string;
}

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

export interface SearchResult {
    book: string;
    filename: string;
    content: string;
}

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

export interface DBCheckResult {
    status: 'consistent' | 'inconsistent';
    missingOnDisk: { book: string, filename: string }[];
    missingInDB: { book: string, filename: string }[];
}

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
