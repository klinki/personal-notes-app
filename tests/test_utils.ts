import { rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Shared root for all tests - created once per test run
const TEST_ROOT = join(tmpdir(), `mnote-tests-${Date.now()}`);

/**
 * Get a unique test directory under the shared root
 */
export function getTestDir(testName: string): string {
    return join(TEST_ROOT, testName, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

/**
 * Clean up the entire test root directory (call this in afterAll)
 */
export async function cleanupTestRoot() {
    // Retry logic for Windows file locking
    for (let i = 0; i < 10; i++) {
        try {
            await rm(TEST_ROOT, { recursive: true, force: true });
            return;
        } catch (e: any) {
            if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'ENOTEMPTY') {
                 await new Promise(r => setTimeout(r, 100));
            } else if (e.code === 'ENOENT') {
                 // Already deleted, that's fine
                 return;
            } else {
                 throw e;
            }
        }
    }
    // Final attempt
    try {
        await rm(TEST_ROOT, { recursive: true, force: true });
    } catch (e: any) {
        if (e.code !== 'ENOENT') {
            console.warn(`Warning: Failed to clean up test root ${TEST_ROOT}:`, e.message);
        }
    }
}
