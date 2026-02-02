import { simpleGit } from 'simple-git';
import { getDbInfo } from '../store';
import { getConfig } from '../config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { LockManager } from '../lock';

export async function syncNotes() {
    const lock = new LockManager();
    const acquired = await lock.acquire({ wait: true, timeoutMs: 5000 });
    if (!acquired) {
        console.error("❌ Could not acquire sync lock. Another sync is in progress.");
        process.exit(1);
    }
    try {
        await performSync({ exitOnError: true });
    } finally {
        await lock.release();
    }
}

export async function autoSync() {
    try {
        const enabled = await getConfig('autosync');
        if (enabled === true || enabled === 'true') {
            console.log("🔄 Auto-syncing...");

            const lock = new LockManager();
            // Auto-sync should wait briefly, but fail silently/log if busy
            const acquired = await lock.acquire({ wait: true, timeoutMs: 3000 });

            if (!acquired) {
                console.log("⚠️ Sync lock busy, skipping auto-sync.");
                return;
            }

            try {
                await performSync({ exitOnError: false });
            } catch (e: any) {
                // Already logged in performSync
            } finally {
                await lock.release();
            }
        }
    } catch (e) {
        // Config key might not exist warning ignored
    }
}

export interface SyncOptions {
    exitOnError?: boolean;
}

export async function performSync(options: SyncOptions = { exitOnError: true }) {
    const noteDir = getDbInfo().path;
    const git = simpleGit(noteDir);

    console.log(`Syncing notes in ${noteDir}...`);

    try {
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            console.error(`Error: ${noteDir} is not a git repository.`);
            console.error("Please initialize it with 'git init' and configure a remote.");
            throw new Error(`${noteDir} is not a git repository.`);
        }

        const status = await git.status();
        if (status.files.length > 0) {
            console.log("Committing local changes...");
            await git.add('.');
            await git.commit(`Sync: ${new Date().toISOString()}`);
        } else {
            // Only log this if manual sync, maybe? Or just keep it.
            console.log("No local changes to commit.");
        }

        console.log("Pulling changes from remote...");
        try {
            await git.pull('origin', 'master', { '--rebase': 'true' });
        } catch (e: any) {
            if (e.message && e.message.includes('CONFLICT')) {
                console.error("❌ Sync conflict detected!");
                console.error(`Please go to ${noteDir} and resolve conflicts manually.`);
                throw new Error("Conflict detected! Please resolve conflicts manually.");
            }
            throw e;
        }

        console.log("Pushing changes to remote...");
        await git.push('origin', 'master');

        console.log("✅ Sync complete!");

    } catch (e: any) {
        // If we threw a specific error with a message we already logged (like conflict),
        // we might not want to log it again with the generic prefix,
        // but for now let's keep it simple as the user asked for icons back.
        // Actually, if we want to avoid double logging for the ones we just explicitly logged:
        if (!e.message.includes('not a git repository') && !e.message.includes('Conflict detected')) {
            console.error("❌ Sync failed:", e.message);
        }

        if (options.exitOnError) {
            process.exit(1);
        }
        throw e;
    }
}
