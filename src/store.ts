import { join, resolve, relative, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { mkdir, writeFile, readdir, readFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';

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

export async function addNote(book: string, content: string) {
  const bookPath = await getBookPath(book);

  // Create a timestamp-based filename with milliseconds
  const now = new Date();
  const timestamp = now.getFullYear() +
    '-' + String(now.getMonth() + 1).padStart(2, '0') +
    '-' + String(now.getDate()).padStart(2, '0') +
    '-' + String(now.getHours()).padStart(2, '0') +
    '-' + String(now.getMinutes()).padStart(2, '0') +
    '-' + String(now.getSeconds()).padStart(2, '0') +
    '-' + String(now.getMilliseconds()).padStart(3, '0');

  let filename = `${timestamp}.md`;
  let filePath = join(bookPath, filename);

  // Collision check
  let counter = 1;
  while (existsSync(filePath)) {
      filename = `${timestamp}-${counter}.md`;
      filePath = join(bookPath, filename);
      counter++;
  }

  await writeFile(filePath, content);
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
    return noteToDelete.filename;
}

export interface SearchResult {
    book: string;
    filename: string;
    content: string;
}

export async function findNotes(keyword: string, book?: string): Promise<SearchResult[]> {
    let results: SearchResult[] = [];
    let booksToSearch: string[] = [];

    if (book) {
        booksToSearch = [book];
    } else {
        booksToSearch = await getBooksRecursive();
    }

    const lowerKeyword = keyword.toLowerCase();

    for (const b of booksToSearch) {
        try {
            const notes = await getNotes(b);
            for (const note of notes) {
                if (note.content.toLowerCase().includes(lowerKeyword)) {
                    results.push({
                        book: b,
                        filename: note.filename,
                        content: note.content
                    });
                }
            }
        } catch (error) {
            // Ignore errors if book doesn't exist or can't be read during search
            continue;
        }
    }

    return results;
}
