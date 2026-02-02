import { LockManager } from '../lock';
import { performSync } from './sync';

/**
 * Runs the sync daemon in the foreground.
 * Performs periodic sync operations at the specified interval.
 * @param intervalSeconds - The interval in seconds between sync operations
 */
export async function runDaemon(intervalSeconds: number) {
    console.log(`Starting mnote daemon (interval: ${intervalSeconds}s)...`);
    console.log(`Press Ctrl+C to stop.`);

    const intervalMs = intervalSeconds * 1000;

    // Handle signals
    let stopping = false;
    process.on('SIGINT', () => {
        console.log('\nStopping daemon...');
        stopping = true;
        process.exit(0);
    });
    process.on('SIGTERM', () => {
        console.log('\nStopping daemon...');
        stopping = true;
        process.exit(0);
    });

    while (!stopping) {
        try {
            // Attempt to sync
            const lock = new LockManager();
            const acquired = await lock.acquire({ wait: false });

            if (acquired) {
                try {
                    // console.log(`[Daemon] Syncing...`); // Verbose? Maybe just log on error or success?
                    // Let's rely on performSync logs but maybe quiet them down?
                    // User probably redirects output or it's a background service.
                    await performSync({ exitOnError: false });
                } catch (e) {
                    console.error('[Daemon] Sync error:', e);
                } finally {
                    await lock.release();
                }
            } else {
                // Locked (manual sync or something else running) - Skip
                // console.log('[Daemon] Locked, skipping...');
            }

        } catch (e) {
            console.error('[Daemon] Unexpected error:', e);
        }

        // Wait for next interval
        await new Promise(r => setTimeout(r, intervalMs));
    }
}
