import { simpleGit } from 'simple-git';
import { getDbInfo } from '../store';
import { getConfig } from '../config';
import { LockManager } from '../lock';

/**
 * Performs a full sync of notes with the remote git repository.
 * Acquires a lock and performs the sync operation.
 */
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

/**
 * Automatically syncs notes if autosync is enabled in the configuration.
 * Silently skips if the sync lock is busy.
 */
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

/**
 * Options for the performSync function.
 */
export interface SyncOptions {
    /** Whether to exit the process on error (default: true) */
    exitOnError?: boolean;
}

/**
 * Performs the actual synchronization operations.
 * Commits local changes, pulls from remote, and pushes to remote.
 * @param options - Sync options configuration
 */
export async function performSync(options: SyncOptions = { exitOnError: true }) {
    const noteDir = getDbInfo().path;
    const git = simpleGit(noteDir);

    // Get git branch from config, default to 'master'
    let branch = 'master';
    try {
        branch = (await getConfig('git.branch')) as string | 'master';
    } catch {
        // Config key doesn't exist, use default
    }

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

        const remotes = await git.getRemotes();
        const hasOrigin = remotes.some(r => r.name === 'origin');
        if (!hasOrigin) {
            console.warn("⚠️ No 'origin' remote configured. Skipping pull/push.");
            return;
        }

        console.log("Pulling changes from remote...");
        try {
            await git.pull('origin', branch, { '--rebase': 'true' });
        } catch (e: any) {
            if (e.message && e.message.includes('CONFLICT')) {
                console.error("❌ Sync conflict detected!");
                console.error(`Please go to ${noteDir} and resolve conflicts manually.`);
                throw new Error("Conflict detected! Please resolve conflicts manually.");
            }
            throw e;
        }

        console.log("Pushing changes to remote...");
        await git.push('origin', branch);

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

