import { simpleGit } from 'simple-git';
import { getDbInfo } from '../store';
import { getConfig } from '../config';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export async function syncNotes() {
    await syncNotesInternal({ exitOnError: true });
}

export async function autoSync() {
    try {
        const enabled = await getConfig('autosync');
        if (enabled === true || enabled === 'true') {
            console.log("🔄 Auto-syncing...");
            try {
                await syncNotesInternal({ exitOnError: false });
            } catch (e: any) {
                // Already logged in syncNotesInternal
            }
        }
    } catch (e) {
        // Config key might not exist, strictly speaking getConfig throws if not found
        // which means disabled by default if not set.
        // We should handle 'key not found' as 'disabled', effectively ignoring error.
    }
}

interface SyncOptions {
    exitOnError?: boolean;
}

async function syncNotesInternal(options: SyncOptions = { exitOnError: true }) {
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
