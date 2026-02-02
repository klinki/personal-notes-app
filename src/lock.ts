import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { getDbInfo } from './store';

export class LockManager {
    private lockFile: string;

    constructor() {
        this.lockFile = join(getDbInfo().path, '.mnote-sync.lock');
    }

    /**
     * Tries to acquire the lock.
     * @param options.wait - If true, waits/retries for a few seconds before failing.
     * @param options.timeoutMs - Total time to wait if wait is true.
     * @returns true if acquired, false otherwise.
     */
    async acquire(options: { wait?: boolean, timeoutMs?: number } = {}): Promise<boolean> {
        const start = Date.now();
        const timeout = options.timeoutMs ?? 5000;

        while (true) {
            if (await this.tryLock()) {
                return true;
            }

            if (!options.wait) {
                return false;
            }

            if (Date.now() - start > timeout) {
                return false;
            }

            // Wait 500ms before retry
            await new Promise(r => setTimeout(r, 500));
        }
    }

    private async tryLock(): Promise<boolean> {
        try {
            // Check if lock exists
            if (existsSync(this.lockFile)) {
                const content = await readFile(this.lockFile, 'utf-8');
                const parts = content.split('|');
                const pidStr = parts[0];
                const tsStr = parts[1];

                const pid = pidStr ? parseInt(pidStr, 10) : NaN;
                const timestamp = tsStr ? parseInt(tsStr, 10) : NaN;

                if (!isNaN(pid)) {
                    // Check if process is still running
                    if (!this.isProcessRunning(pid)) {
                        console.log(`[Lock] Found stale lock from PID ${pid}. Taking over.`);
                        await this.forceUnlock();
                    } else {
                        // Check for very old lock (e.g. > 10 mins) just in case PID reused or other issue?
                        // Actually, trusting PID check is safer for local machine. 
                        // But if OS rebooted, PID might mean nothing or refer to a new random process.
                        // Adding a max age as fallback is good.
                        const age = Date.now() - timestamp;
                        if (age > 10 * 60 * 1000) { // 10 minutes
                            console.warn(`[Lock] Found very old lock (${Math.round(age / 1000 / 60)} mins). Taking over.`);
                            await this.forceUnlock();
                        } else {
                            // Locked by running process
                            return false;
                        }
                    }
                }
            }

            // Create lock
            // We use 'wx' flag (fail if path exists) to avoid race conditions?
            // node:fs/promises writeFile doesn't support atomic "create only if not exists" easily without flags.
            // But we can check-then-write or use a temp file and rename.
            // For this app, race condition window is small.
            // Better: use 'wx' flag with raw fs write or Bun's write (if it supports flags).
            // Let's use standard try-write with flag 'wx'.
            // Bun runtime: `Bun.write` overwrites. `start writing via node:fs`
            await writeFile(this.lockFile, `${process.pid}|${Date.now()}`, { flag: 'wx' });
            return true;

        } catch (e: any) {
            if (e.code === 'EEXIST') {
                return false; // Race lost
            }
            // For stale lock takeover, we delete then write.
            // If we failed after delete, someone else might have grabbed it.
            return false;
        }
    }

    async release() {
        try {
            if (existsSync(this.lockFile)) {
                // Ideally check if WE own the lock (our PID) before deleting?
                // Yes.
                const content = await readFile(this.lockFile, 'utf-8');
                const parts = content.split('|');
                const pidStr = parts[0];
                if (pidStr && parseInt(pidStr, 10) === process.pid) {
                    await unlink(this.lockFile);
                }
            }
        } catch (e) {
            // Ignore unlock errors
        }
    }

    private async forceUnlock() {
        try {
            await unlink(this.lockFile);
        } catch (e) { }
    }

    private isProcessRunning(pid: number): boolean {
        try {
            // signal 0 checks for existence
            process.kill(pid, 0);
            return true;
        } catch (e: any) {
            return e.code === 'EPERM'; // EPERM means it exists but we can't kill it (still running)
        }
    }
}
