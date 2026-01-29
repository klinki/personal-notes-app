
import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, unlink } from "node:fs/promises";
import { getTestDir, cleanupTestRoot } from './test_utils';

describe("Reproduction", () => {
    let store: typeof import("../src/store");
    let TEST_DIR: string;

    beforeEach(async () => {
        TEST_DIR = getTestDir('repro');
        process.env.MNOTE_HOME = TEST_DIR;
        
        store = await import("../src/store");
        store.setDbLocation(TEST_DIR);
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        if (store && store.closeDB) {
             store.closeDB();
        }
        await cleanupTestRoot();
    });

    it("should fail to find notes if db is deleted (current behavior)", async () => {
        await store.addNote("repro-book", "searchable content");
        
        // Ensure it's indexed and searchable initially
        let results = await store.findNotes("searchable");
        expect(results).toHaveLength(1);

        // Close and delete DB
        store.closeDB();
        const dbPath = join(TEST_DIR, "mnote.db");
        
        // Retry unlink for Windows EBUSY
        for (let i = 0; i < 10; i++) {
            try {
                await unlink(dbPath);
                break;
            } catch (e: any) {
                if (e.code === 'EBUSY' || e.code === 'EPERM') {
                    await new Promise(resolve => setTimeout(resolve, 100));
                } else {
                    throw e;
                }
            }
        }

        // Search again - should fail (return 0 results) currently
        // After fix, this should return 1 result (auto-rebuild)
        results = await store.findNotes("searchable");
        
        // CURRENT EXPECTATION: validation of bug (search returns empty)
        expect(results).toHaveLength(1); 
    });
});
