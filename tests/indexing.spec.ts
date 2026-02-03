import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { getTestDir, cleanupTestRoot, cleanupDir } from './test_utils';
import { setDbLocation, addNote } from '../src/store';
import { generateRootReadme, generateBookIndex } from '../src/indexing';
import { setConfig } from '../src/config';

describe('Indexing', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('indexing');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should generate root README.md with tree', async () => {
        // Setup structure
        const book1 = join(testDir, 'Book1');
        const book2 = join(testDir, 'Book2', 'SubBook');
        mkdirSync(book1, { recursive: true });
        mkdirSync(book2, { recursive: true });

        await generateRootReadme(testDir);

        const readmePath = join(testDir, 'README.md');
        expect(existsSync(readmePath)).toBe(true);
        const content = readFileSync(readmePath, 'utf-8');

        expect(content).toContain('Book1');
        expect(content).toContain('Book2');
        expect(content).toContain('SubBook');
        // Check links
        expect(content).toContain('(Book1/INDEX.md)');
        expect(content).toContain('(Book2/INDEX.md)');
    });

    it('should generate book INDEX.md', async () => {
        const bookPath = join(testDir, 'MyBook');
        mkdirSync(bookPath, { recursive: true });

        writeFileSync(join(bookPath, 'Note1.md'), '# Note 1');
        mkdirSync(join(bookPath, 'SubLevel'));

        await generateBookIndex(bookPath);

        const indexPath = join(bookPath, 'INDEX.md');
        expect(existsSync(indexPath)).toBe(true);
        const content = readFileSync(indexPath, 'utf-8');

        expect(content).toContain('Note1');
        expect(content).toContain('SubLevel');
        expect(content).toContain('(Note1.md)');
        expect(content).toContain('(SubLevel/INDEX.md)');
    });

    it('should preserve custom content outside markers', async () => {
        const bookPath = join(testDir, 'CustomBook');
        mkdirSync(bookPath, { recursive: true });

        const customContent = '# My Custom Header\nSome intro text.\n\n';
        const markerStart = '<!-- MNOTE_INDEX_START -->';
        const markerEnd = '<!-- MNOTE_INDEX_END -->';

        const existingFile = `${customContent}${markerStart}\nOld Content\n${markerEnd}\nFooter`;
        const indexPath = join(bookPath, 'INDEX.md');
        writeFileSync(indexPath, existingFile);

        writeFileSync(join(bookPath, 'NewNote.md'), '# New Note');

        await generateBookIndex(bookPath);

        const content = readFileSync(indexPath, 'utf-8');
        expect(content).toContain('# My Custom Header');
        expect(content).toContain('Some intro text.');
        expect(content).toContain('Footer');
        expect(content).toContain('NewNote'); // Generated content
        expect(content).not.toContain('Old Content');
    });

    it('should auto-update index on addNote', async () => {
        const book = 'AutoBook';
        const bookPath = join(testDir, book);
        // addNote creates dir

        await addNote(book, '# Auto Note', { title: 'Auto Note' });

        const indexPath = join(bookPath, 'INDEX.md');
        expect(existsSync(indexPath)).toBe(true);
        const content = readFileSync(indexPath, 'utf-8');
        expect(content).toContain('auto-note');
    });

    it('should NOT auto-update index when config is disabled', async () => {
        const book = 'NoIndexBook';
        const bookPath = join(testDir, book);

        await setConfig('generateIndexFiles', 'false');

        await addNote(book, '# No Index Note', { title: 'No Index Note' });

        const indexPath = join(bookPath, 'INDEX.md');
        expect(existsSync(indexPath)).toBe(false);
    });
});
