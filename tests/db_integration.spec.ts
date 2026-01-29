import { describe, it, expect, beforeEach, afterAll } from 'bun:test';
import { join } from 'node:path';
import { mkdir, rm } from 'node:fs/promises';
import { setDbLocation, addNote, findNotes, updateNote, deleteNote, rebuildDB, checkDB, renameBook, getDB, closeDB } from '../src/store';
import { getTestDir, cleanupTestRoot } from './test_utils';

describe('Database Integration', () => {
    let TEST_HOME: string;

    beforeEach(async () => {
        TEST_HOME = getTestDir('db_integration');
        await mkdir(TEST_HOME, { recursive: true });
        setDbLocation(TEST_HOME);
    });

    afterAll(async () => {
        closeDB();
        await cleanupTestRoot();
    });

    it('should index a note when added', async () => {
        await addNote('book1', 'Hello world');
        const results = await findNotes('world');
        expect(results.length).toBe(1);
        expect(results[0].content).toBe('Hello world');
        expect(results[0].book).toBe('book1');
    });

    it('should update index when note is updated', async () => {
        await addNote('book1', 'Initial content', 'My Title');
        const results = await findNotes('Initial');
        expect(results.length).toBe(1);
        const filename = results[0].filename;

        await updateNote('book1', filename, 'Updated content');

        const results2 = await findNotes('Updated');
        expect(results2.length).toBe(1);
        expect(results2[0].content).toBe('Updated content');

        const results3 = await findNotes('Initial');
        expect(results3.length).toBe(0);
    });

    it('should remove from index when note is deleted', async () => {
        await addNote('book1', 'ToBeDeleted');
        const results = await findNotes('ToBeDeleted');
        expect(results.length).toBe(1);

        // Find index (1-based)
        // Since we only have one note in book1
        await deleteNote('book1', 1);

        const results2 = await findNotes('ToBeDeleted');
        expect(results2.length).toBe(0);
    });

    it('should rebuild database', async () => {
        await addNote('book1', 'Note 1');
        await addNote('book2', 'Note 2');

        const db = getDB();
        db.run("DELETE FROM notes");
        db.run("DELETE FROM notes_fts");

        const results = await findNotes('Note');
        expect(results.length).toBe(0);

        await rebuildDB();

        const results2 = await findNotes('Note');
        expect(results2.length).toBe(2);
    });

    it('should check consistency', async () => {
        await addNote('book1', 'Consistent');
        const check1 = await checkDB();
        expect(check1.status).toBe('consistent');

        // Create inconsistency: delete file manually
        const notes = await findNotes('Consistent');
        const filename = notes[0].filename;
        await rm(join(TEST_HOME, 'book1', filename));

        const check2 = await checkDB();
        expect(check2.status).toBe('inconsistent');
        expect(check2.missingOnDisk.length).toBe(1);
    });

    it('should update index when book is renamed', async () => {
        await addNote('oldbook', 'content inside');
        await renameBook('oldbook', 'newbook');

        const results = await findNotes('content');
        expect(results.length).toBe(1);
        expect(results[0].book).toBe('newbook');

        const check = await checkDB();
        expect(check.status).toBe('consistent');
    });

    it('should update index when note is moved', async () => {
        await addNote('sourcebook', 'moving content');
        const notes = await findNotes('moving');
        expect(notes.length).toBe(1);
        expect(notes[0].book).toBe('sourcebook');

        // Find notes returns list, but we need index for moveNote?
        // We know it's the first note in sourcebook
        const sourceNotes = await import('../src/store').then(m => m.getNotes('sourcebook'));
        // Wait, I can just use getNotes from import
        // But moveNote takes index.

        await import('../src/store').then(m => m.moveNote('sourcebook', 1, 'destbook'));

        const results = await findNotes('moving');
        expect(results.length).toBe(1);
        expect(results[0].book).toBe('destbook');

        const check = await checkDB();
        expect(check.status).toBe('consistent');
    });

    it('should find partial matches if implemented (prefix)', async () => {
        await addNote('book1', 'database system');
        const results = await findNotes('data'); // Should match 'database'
        expect(results.length).toBe(1);
    });
});
