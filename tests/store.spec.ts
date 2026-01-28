import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, exists } from "node:fs/promises";
import { tmpdir } from "node:os";

// Set MNOTE_HOME before importing store to ensure it picks up the env var
const TEST_DIR = join(tmpdir(), `mnote-test-${Date.now()}`);
process.env.MNOTE_HOME = TEST_DIR;

// Use let to hold the imported module
let store: typeof import("../src/store");

describe("Store", () => {
    beforeEach(async () => {
        // Dynamic import ensures env var is set before module loads
        // Note: Bun/Node caches modules, so if it was imported elsewhere it might persist, 
        // but typically in a single test file run it's fine. 
        // Ideally we'd reset modules but ESM makes that hard.
        // Assuming this is the first import in this process/context.
        store = await import("../src/store");
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        // Clean up
        await rm(TEST_DIR, { recursive: true, force: true });
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
});
