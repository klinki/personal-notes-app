import { exec } from 'node:child_process';
import { platform } from 'node:os';
import { getDbInfo } from '../store';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const TASK_NAME = 'mnote-background-sync';

/**
 * Installs the mnote background service for automatic syncing.
 * Currently supports Windows via schtasks.
 * @param interval - The sync interval in seconds
 */
export async function installService(interval: number) {
    const os = platform();
    const dbPath = getDbInfo().path;

    console.log(`Installing background service (Sync Interval: ${interval}s)...`);
    console.log(`Database: ${dbPath}`);

    const commandToRun = getCommandToRun(interval, dbPath);

    if (os === 'win32') {
        await installWindowsService(commandToRun);
    } else {
        console.log(`❌ Service installation not yet implemented for OS: ${os}`);
        console.log(`Manual command to run: ${commandToRun}`);
    }
}

/**
 * Uninstalls the mnote background service.
 * Currently supports Windows via schtasks.
 */
export async function uninstallService() {
    const os = platform();
    if (os === 'win32') {
        await uninstallWindowsService();
    } else {
        console.log('Not implemented for this OS.');
    }
}

/**
 * Generates the command to run the daemon with proper arguments.
 * @param interval - The sync interval in seconds
 * @param dbPath - The database path
 * @returns The command string to execute
 */
function getCommandToRun(interval: number, dbPath: string): string {
    // Check if running as script (ts/js) or compiled binary
    if (process.argv[1] && (process.argv[1].endsWith('.ts') || process.argv[1].endsWith('.js'))) {
        return `"${process.execPath}" "${process.argv[1]}" daemon --interval ${interval} --dbLocation "${dbPath}"`;
    } else {
        // Assume binary
        return `"${process.execPath}" daemon --interval ${interval} --dbLocation "${dbPath}"`;
    }
}

/**
 * Installs the Windows service task using schtasks.
 * @param commandToRun - The command to execute for the daemon
 */
async function installWindowsService(commandToRun: string) {
    try {
        // /SC ONLOGON: Runs when user logs in
        // /F: Force create
        // /TR: Task Run command. Needs careful quoting.
        const cleanCmd = commandToRun.replace(/"/g, '\\"');
        const fullCmd = `schtasks /Create /SC ONLOGON /TN "${TASK_NAME}" /TR "${cleanCmd}" /F`;

        console.log(`Running: ${fullCmd}`);
        await execAsync(fullCmd);

        console.log(`✅ Successfully registered Windows Task: ${TASK_NAME}`);
        console.log(`The sync daemon will start on next login.`);
        console.log(`To start immediately, run: schtasks /Run /TN "${TASK_NAME}"`);
    } catch (e: any) {
        console.error('❌ Failed to register task:', e.message);
        console.error('You might need to run this terminal as Administrator.');
    }
}

/**
 * Uninstalls the Windows service task using schtasks.
 */
async function uninstallWindowsService() {
    try {
        await execAsync(`schtasks /Delete /TN "${TASK_NAME}" /F`);
        console.log(`✅ Successfully removed Windows Task: ${TASK_NAME}`);
    } catch (e: any) {
        console.error('❌ Failed to remove task:', e.message);
    }
}
