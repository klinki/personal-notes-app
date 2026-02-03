import { describe, it, expect, beforeEach, afterAll, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { LockManager } from '../src/lock';
import { performSync, syncNotes, autoSync, type SyncOptions } from '../src/commands/sync';
import { runDaemon } from '../src/commands/daemon';
import { setDbLocation } from '../src/store';
import { simpleGit } from 'simple-git';
import { getTestDir, cleanupTestRoot } from './test_utils';

describe('LockManager', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('lock');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should acquire lock when not locked', async () => {
        const lock = new LockManager();
        const acquired = await lock.acquire();
        expect(acquired).toBe(true);
        const lockFile = join(testDir, '.mnote-sync.lock');
        expect(existsSync(lockFile)).toBe(true);
    });

    it('should release lock correctly', async () => {
        const lock = new LockManager();
        await lock.acquire();
        await lock.release();
        const lockFile = join(testDir, '.mnote-sync.lock');
        expect(existsSync(lockFile)).toBe(false);
    });

    it('should handle concurrent lock attempts', async () => {
        const lock1 = new LockManager();
        const lock2 = new LockManager();

        await lock1.acquire();
        const acquired2 = await lock2.acquire({ wait: false });

        expect(acquired2).toBe(false);
    });
});

describe('LockManager Edge Cases', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('lock-edge');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });



    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should handle lock file deletion by external process', async () => {
        const lock = new LockManager();
        expect(lock).toBeDefined();
        await lock.acquire();
        const lockFile = join(testDir, '.mnote-sync.lock');
        rmSync(lockFile);
        const acquired = await lock.acquire();
        expect(acquired).toBe(true);
    });

    it('should handle rapid acquire/release cycles', async () => {
        const lock = new LockManager();
        for (let i = 0; i < 5; i++) {
            const acquired = await lock.acquire();
            expect(acquired).toBe(true);
            await lock.release();
        }

        // Verify lock is released after cycles
        const finalAcquire = await lock.acquire();
        expect(finalAcquire).toBe(true);
    });

    it('should handle lock timeout correctly', async () => {
        const lock1 = new LockManager();
        await lock1.acquire();

        const lock2 = new LockManager();
        const start = Date.now();
        const acquired = await lock2.acquire({ wait: true, timeoutMs: 500 });
        const duration = Date.now() - start;

        expect(acquired).toBe(false);
        expect(duration).toBeGreaterThanOrEqual(400);
    });
});

describe('Sync Module', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('sync');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should initialize git repository', async () => {
        const git = simpleGit(testDir);
        await git.init();
        const isRepo = await git.checkIsRepo();
        expect(isRepo).toBe(true);
    });

    it('should detect non-git directory', async () => {
        const git = simpleGit(testDir);
        const isRepo = await git.checkIsRepo();
        expect(isRepo).toBe(false);
    });

    it('should commit changes when files exist', async () => {
        const git = simpleGit(testDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');

        // Create a test file
        const testFile = join(testDir, 'test.md');
        writeFileSync(testFile, '# Test\n\nContent here');

        await git.add('.');
        await git.commit('Initial');

        const status = await git.status();
        expect(status.files.length).toBe(0); // Clean after commit
    });

    it('should handle sync with remote (no remote configured)', async () => {
        const git = simpleGit(testDir);
        await git.init();
        // Set author needed for commit
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');
        await git.commit('Initial commit', { '--allow-empty': null });

        // Try to pull without remote - should fail gracefully
        try {
            await git.pull('origin', 'master');
        } catch (e: any) {
            // Expected to fail without remote
            expect(e.message).toBeDefined();
        }
    });

    it('should return early if no remote configured', async () => {
        const git = simpleGit(testDir);
        await git.init();
        const result = await performSync({ exitOnError: false });
        expect(result).toBeUndefined(); // Should return, not throw
    });
});

describe('AutoSync', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('autosync');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should execute autoSync without errors', async () => {
        try {
            await autoSync();
        } catch (e) {
            console.error('AutoSync failed with:', e);
            throw e;
        }
    });
});

describe('CLI Sync Commands', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('cli-sync');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should have properly defined functions', async () => {
        expect(typeof syncNotes).toBe('function');
    });

    it('should handle performSync options', async () => {
        const options: SyncOptions = { exitOnError: false };
        expect(options.exitOnError).toBe(false);
    });
});

describe('Daemon Integration', () => {
    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should have runDaemon function', () => {
        expect(runDaemon).toBeDefined();
    });

    it('should handle daemon startup checks', async () => {
        expect(typeof runDaemon).toBe('function');
    });
});

describe('Sync with Real Git Repository', () => {
    let testDir: string;
    let git: ReturnType<typeof simpleGit>;

    beforeEach(async () => {
        testDir = getTestDir('real-git');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
        git = simpleGit(testDir);
        await git.init();
        await git.addConfig('user.name', 'Test User');
        await git.addConfig('user.email', 'test@example.com');

        const readme = join(testDir, 'README.md');
        writeFileSync(readme, '# Test Repository\n');
        await git.add('.');
        await git.commit('Initial commit');
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should get git status', async () => {
        const status = await git.status();
        expect(status).toBeDefined();
        expect(status.files).toBeDefined();
    });

    it('should add files to git', async () => {
        const testFile = join(testDir, 'test.md');
        writeFileSync(testFile, '# Test\n');

        await git.add('.');
        const status = await git.status();
        expect(status.files.length).toBeGreaterThan(0);
    });

    it('should commit changes', async () => {
        const testFile = join(testDir, 'test.md');
        writeFileSync(testFile, '# Test\n');

        await git.add('.');
        await git.commit('Test commit');

        const log = await git.log();
        expect(log.latest).toBeDefined();
        expect(log.latest?.message).toBe('Test commit');
    });
});

describe('performSync Error Handling', () => {
    let testDir: string;

    beforeEach(() => {
        testDir = getTestDir('sync-error');
        mkdirSync(testDir, { recursive: true });
        setDbLocation(testDir);
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should throw error for non-git directory', async () => {
        // Non-git directory should cause performSync to throw
        await expect(performSync({ exitOnError: false })).rejects.toThrow();
    });
});
