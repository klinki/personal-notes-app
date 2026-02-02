import { simpleGit } from 'simple-git';
import { getDbInfo } from '../store';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function syncNotes() {
    const noteDir = getDbInfo().path;
    const git = simpleGit(noteDir);

    console.log(`Syncing notes in ${noteDir}...`);

    try {
        // Check if it's a git repo
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            console.error(`Error: ${noteDir} is not a git repository.`);
            console.error("Please initialize it with 'git init' and configure a remote.");
            process.exit(1);
        }

        // 1. Check status
        const status = await git.status();

        // 2. Commit local changes if any
        if (status.files.length > 0) {
            console.log("Committing local changes...");
            await git.add('.');
            await git.commit(`Sync: ${new Date().toISOString()}`);
        } else {
            console.log("No local changes to commit.");
        }

        // 3. Pull (Rebase)
        console.log("Pulling changes from remote...");
        try {
            await git.pull('origin', 'master', { '--rebase': 'true' });
        } catch (e: any) {
            if (e.message && e.message.includes('CONFLICT')) {
                console.error("❌ Sync conflict detected!");
                console.error(`Please go to ${noteDir} and resolve conflicts manually.`);
                process.exit(1);
            }
            throw e;
        }

        // 4. Push
        console.log("Pushing changes to remote...");
        await git.push('origin', 'master');

        console.log("✅ Sync complete!");

    } catch (e: any) {
        console.error("❌ Sync failed:", e.message);
        process.exit(1);
    }
}
