import { createInterface } from 'node:readline';
import { writeFile, readFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';
import { getDbInfo } from '../store';
import { getConfig, setConfig, type Config } from '../config';
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
        const enabled = await getConfig('autoSync.enabled');
        if (enabled === true) {
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
        branch = (await getConfig('autoSync.git.branch')) as string || 'master';
    } catch {
        // Config key doesn't exist, use default
    }

    console.log(`Syncing notes in ${noteDir}...`);

    if (!isGitInstalled()) {
        const msg = "❌ Git is not installed or not in the PATH. Please install Git to use sync features.";
        console.error(msg);
        if (options.exitOnError) {
            process.exit(1);
        }
        throw new Error(msg);
    }

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
    }
}

/**
 * Options for initializing the sync configuration.
 */
export interface InitSyncOptions {
    remote?: string;
    branch?: string;
}

/**
 * Initializes the git synchronization environment.
 * Sets up the git repo, remote, and enables auto-sync.
 */
export async function initSync(options: InitSyncOptions = {}) {
    const noteDir = getDbInfo().path;
    const git = simpleGit(noteDir);

    console.log(`Initializing sync in ${noteDir}...`);

    if (!isGitInstalled()) {
        console.error("❌ Git is not installed or not in the PATH. Please install Git first.");
        return;
    }

    try {
        // 1. Initialize Git Repo
        const isRepo = await git.checkIsRepo();
        if (!isRepo) {
            console.log("Initializing git repository...");
            await git.init();
        } else {
            console.log("Git repository already exists.");
        }

        // 2. Configure Remote
        let remoteUrl = options.remote;
        if (!remoteUrl) {
            try {
                remoteUrl = (await getConfig('autoSync.git.remote')) as string;
            } catch { }
        }

        if (!remoteUrl) {
            const readline = createInterface({
                input: process.stdin,
                output: process.stdout
            });

            remoteUrl = await new Promise<string>(resolve => {
                readline.question('Enter git remote URL (e.g., git@github.com:user/notes.git): ', (answer) => {
                    resolve(answer.trim());
                });
            });
            readline.close();
        }

        if (!remoteUrl) {
            console.error("❌ Remote URL is required for sync.");
            return;
        }

        const remotes = await git.getRemotes(true);
        const origin = remotes.find(r => r.name === 'origin');
        if (origin) {
            if (origin.refs.push !== remoteUrl) {
                console.log(`Updating 'origin' remote to ${remoteUrl}...`);
                await git.remote(['set-url', 'origin', remoteUrl]);
            }
        } else {
            console.log(`Adding 'origin' remote: ${remoteUrl}...`);
            await git.addRemote('origin', remoteUrl);
        }

        // 3. Configure Branch
        let branch = options.branch;
        if (!branch) {
            try {
                branch = (await getConfig('autoSync.git.branch')) as string;
            } catch { }
        }

        if (!branch) {
            const readline = createInterface({
                input: process.stdin,
                output: process.stdout
            });

            branch = await new Promise<string>(resolve => {
                readline.question('Enter branch name (default: main): ', (answer) => {
                    resolve(answer.trim() || 'main');
                });
            });
            readline.close();
        }

        // 4. Create .gitignore
        console.log("Creating .gitignore...");
        const gitignorePath = join(noteDir, '.gitignore');
        const ignoreContent = "mnote.db\nconfig.json\n.mnote-sync.lock\n";
        try {
            await writeFile(gitignorePath, ignoreContent, { flag: 'wx' }); // Fail if exists to avoid overwriting user config? 
            // The requirement says "create a .gitignore file".
            // Let's safe append or write. 
            // If I use 'w', it overwrites.
            // Let's just properly update it if it exists or write new.
            // Actually, simpler: just write it or append if missing.
        } catch (e: any) {
            if (e.code === 'EEXIST') {
                // Check if content matches or append?
                // For now, let's just append if not present or log.
                // Re-reading file and appending seems nicer.
                const current = await readFile(gitignorePath, 'utf8');
                const toAdd = [];
                if (!current.includes('mnote.db')) toAdd.push('mnote.db');
                if (!current.includes('config.json')) toAdd.push('config.json');
                if (!current.includes('.mnote-sync.lock')) toAdd.push('.mnote-sync.lock');

                if (toAdd.length > 0) {
                    await writeFile(gitignorePath, current + '\n' + toAdd.join('\n') + '\n');
                }
            } else {
                // Try writing without flag (creation failed for other reason?)
                await writeFile(gitignorePath, ignoreContent);
            }
        }
        // Force simple write for now as per "create a .gitignore" instruction usually implies ensuring it exists with content.
        // Let's stick to the robust append-if-exists approach I just drafted implicitly above but clearer:
        try {
            await access(gitignorePath);
            const current = await readFile(gitignorePath, 'utf8');
            let newContent = current;
            if (!newContent.endsWith('\n')) newContent += '\n';
            if (!newContent.includes('mnote.db')) newContent += 'mnote.db\n';
            if (!newContent.includes('config.json')) newContent += 'config.json\n';
            if (!newContent.includes('.mnote-sync.lock')) newContent += '.mnote-sync.lock\n';
            if (newContent !== current) await writeFile(gitignorePath, newContent);
        } catch {
            await writeFile(gitignorePath, ignoreContent);
        }


        // 5. Check and Create Remote Branch
        console.log(`Checking remote branch '${branch}'...`);
        try {
            // Fetch first to ensure we know about remotes?
            // git.listRemote is safer.
            const remoteInfo = await git.listRemote(['--heads', 'origin', branch!]);
            if (!remoteInfo) {
                console.log(`Branch '${branch}' does not exist on remote. Creating it...`);

                // Ensure we are on the branch locally
                const status = await git.status();
                if (status.current !== branch) {
                    // Check if local branch exists
                    const localBranches = await git.branchLocal();
                    if (localBranches.all.includes(branch!)) {
                        await git.checkout(branch!);
                    } else {
                        await git.checkoutLocalBranch(branch!);
                    }
                }

                // Create commit with .gitignore
                await git.add('.gitignore');
                await git.commit('Initializing mnote repository');

                // Push
                await git.push('origin', branch!, { '--set-upstream': null });
                console.log(`✅ Created branch '${branch}' on remote.`);
            } else {
                console.log(`Branch '${branch}' exists on remote.`);
            }
        } catch (e: any) {
            console.error("Warning: Could not verify/create remote branch. You may need to push manually first.", e.message);
        }


        // 6. Save Config
        console.log("Saving configuration...");
        await setConfig('autoSync.enabled', 'true');
        await setConfig('autoSync.git.remote', remoteUrl);
        await setConfig('autoSync.git.branch', branch!);

        console.log("✅ Sync initialized and enabled!");
        console.log("run 'mnote sync' to perform the first sync.");

    } catch (e: any) {
        console.error("Error initializing sync:", e.message);
    }
}

/**
 * Checks if git is installed and available in the PATH.
 */
export function isGitInstalled(): boolean {
    try {
        const { execSync } = require('node:child_process');
        execSync('git --version', { stdio: 'ignore' });
        return true;
    } catch (e) {
        return false;
    }
}
