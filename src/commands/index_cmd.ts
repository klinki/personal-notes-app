import { reindexAll } from '../indexing';
import { getDbInfo } from '../store';

/**
 * Manually regenerates all README.md and INDEX.md files.
 */
export async function reindexNotes() {
    console.log('Regenerating all README/INDEX files...');
    try {
        await reindexAll(getDbInfo().path);
        console.log('✅ Index generation complete.');
    } catch (e: any) {
        console.error('❌ Index generation failed:', e.message);
        process.exit(1);
    }
}
