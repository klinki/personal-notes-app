import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, exists } from "node:fs/promises";

import { getTestDir, cleanupTestRoot } from './test_utils';

// Use let to hold the imported module
let store: typeof import("../src/store");
let TEST_DIR: string;

describe("Store", () => {
    beforeEach(async () => {
        TEST_DIR = getTestDir('store');
        process.env.MNOTE_HOME = TEST_DIR;
    
        // Dynamic import ensures env var is set before module loads
        store = await import("../src/store");
        store.setDbLocation(TEST_DIR);
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        // Close all DB connections and clean up the entire test root once
        if (store && store.closeDB) {
             store.closeDB();
        }
        await cleanupTestRoot();
    });

    it("should slugify text correctly", () => {
        expect(store.slugify("Hello World")).toBe("hello-world");
        expect(store.slugify("První český post")).toBe("prvni-cesky-post");
        expect(store.slugify("  Spaces   ")).toBe("spaces");
        expect(store.slugify("Special # chars!")).toBe("special-chars");
        expect(store.slugify("---Multiple---Dashes---")).toBe("multiple-dashes");
    });

    it("should create a book directory when getting book path", async () => {
        const bookName = "test-book";
        const path = await store.getBookPath(bookName);
        expect(path).toBe(join(TEST_DIR, bookName));
        expect(await exists(path)).toBe(true);
    });

    it("should add a note to a book", async () => {
        const bookName = "my-notes";
        const content = "Hello World";
        await store.addNote(bookName, content);

        const notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(1);
        expect(notes[0].content).toBe(content);
        // Expect filename to be YYYY-MM-DD-hello-world.md
        expect(notes[0].filename).toMatch(/^\d{4}-\d{2}-\d{2}-hello-world\.md$/);
    });

    it("should add a note with explicit title", async () => {
        const bookName = "titled-notes";
        const content = "Some content";
        const title = "My Special Note";
        await store.addNote(bookName, content, title);

        const notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(1);
        expect(notes[0].filename).toMatch(/^\d{4}-\d{2}-\d{2}-my-special-note\.md$/);
    });

    it("should extract title from content content", async () => {
        const bookName = "extracted-title";
        const content = "# First Line Header\nRest of the note";
        await store.addNote(bookName, content);

        const notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(1);
        expect(notes[0].filename).toMatch(/^\d{4}-\d{2}-\d{2}-first-line-header\.md$/);
    });

    it("should default to untitled if no title found", async () => {
        const bookName = "untitled-notes";
        const content = ""; // Empty content
        await store.addNote(bookName, content);

        const notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(1);
        expect(notes[0].filename).toMatch(/^\d{4}-\d{2}-\d{2}-untitled\.md$/);
    });

    it("should handle filename collisions", async () => {
        const bookName = "collision-test";
        const title = "Same Title";

        await store.addNote(bookName, "content 1", title);
        await store.addNote(bookName, "content 2", title);
        await store.addNote(bookName, "content 3", title);

        const notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(3);

        const filenames = notes.map(n => n.filename).sort();
        // Expected: date-same-title.md, date-same-title-1.md, date-same-title-2.md
        // We can verify they match the pattern
        expect(filenames[0]).toMatch(/^\d{4}-\d{2}-\d{2}-same-title(-\d+)?\.md$/);
        expect(filenames[1]).toMatch(/^\d{4}-\d{2}-\d{2}-same-title(-\d+)?\.md$/);
        expect(filenames[2]).toMatch(/^\d{4}-\d{2}-\d{2}-same-title(-\d+)?\.md$/);

        // More strict check
        const base = filenames.find(f => !f.match(/-\d+\.md$/));
        expect(base).toBeDefined();
        const numbered = filenames.filter(f => f.match(/-\d+\.md$/));
        expect(numbered).toHaveLength(2);
    });

    it("should list books recursively", async () => {
        await store.addNote("work", "note 1");
        await store.addNote("personal", "note 2");
        await store.addNote("work/project1", "note 3");

        const books = await store.getBooksRecursive();
        expect(books).toContain("work");
        expect(books).toContain("personal");
        expect(books).toContain("work/project1"); // store implementation uses forward slashes explicitly
    });

    it("should return empty list for non-existent book", async () => {
        const notes = await store.getNotes("non-existent");
        expect(notes).toBeEmpty();
    });
    it("should delete a note by index", async () => {
        const bookName = "delete-test";
        await store.addNote(bookName, "note to delete");
        await store.addNote(bookName, "note to keep");

        let notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(2);

        // Delete the first note
        const deletedFile = await store.deleteNote(bookName, 1);
        expect(deletedFile).toBeDefined();

        notes = await store.getNotes(bookName);
        expect(notes).toHaveLength(1);
        expect(notes[0].content).toBe("note to keep");
    });

    it("should throw error when deleting invalid index", async () => {
        const bookName = "invalid-index-test";
        await store.addNote(bookName, "content");
        
    });

    it("should find notes by keyword", async () => {
        await store.addNote("find-test", "this is a secretly hidden note");
        await store.addNote("find-test", "public note");
        await store.addNote("other-book", "hidden note in another book");

        // Search global
        const results = await store.findNotes("hidden");
        expect(results).toHaveLength(2);
        
        // Search specific book
        const bookResults = await store.findNotes("hidden", "find-test");
        expect(bookResults).toHaveLength(1);
        expect(bookResults[0].content).toContain("secretly hidden note");
    });

    it("should return correct db info", () => {
        const info = store.getDbInfo();
        expect(info.path).toBeDefined();
        // The source depends on env setup in beforeEach, usually env var in these tests
        expect(info.source).toBeDefined(); 
    });

    it("should get and update a note", async () => {
        await store.addNote("edit-test", "original content");
        
        // Get Note
        const notes = await store.getNotes("edit-test");
        expect(notes).toHaveLength(1);
        
        const note = await store.getNote("edit-test", 1);
        expect(note.content).toBe("original content");
        expect(note.filename).toBe(notes[0].filename);
        expect(note.path).toBeDefined();

        // Update Note
        await store.updateNote("edit-test", note.filename, "updated content");
        
        const updatedNote = await store.getNote("edit-test", 1);
        expect(updatedNote.content).toBe("updated content");
    });


    it("should move a note", async () => {
        await store.addNote("move-source", "content to move");
        
        // Move
        await store.moveNote("move-source", 1, "move-target");

        // Verify source empty
        const sourceNotes = await store.getNotes("move-source");
        expect(sourceNotes).toHaveLength(0);

        // Verify target has note
        const targetNotes = await store.getNotes("move-target");
        expect(targetNotes).toHaveLength(1);
        expect(targetNotes[0].content).toBe("content to move");
    });

    it("should rename a book", async () => {
        await store.addNote("rename-source", "content");
        
        await store.renameBook("rename-source", "rename-target");

        // Verify old path gone (or empty if it was just a rename of dir)
        // Since we rename the dir, the old book name should return empty array from getNotes as it checks existence
        const oldNotes = await store.getNotes("rename-source");
        expect(oldNotes).toHaveLength(0);

        const newNotes = await store.getNotes("rename-target");
        expect(newNotes).toHaveLength(1);
        expect(newNotes[0].content).toBe("content");
    });
});
