import { describe, it, expect, afterAll, mock } from "bun:test";
import { installService, uninstallService } from '../src/commands/service';
import { cleanupTestRoot } from './test_utils';

// Mock child_process specifically for this file
mock.module('node:child_process', () => {
    return {
        exec: (cmd: string, cb: any) => {
            // Mock successful execution
            if (cb) cb(null, 'ok', '');
            return {
                stdout: { on: () => { } },
                stderr: { on: () => { } }
            } as any;
        },
        spawn: () => ({
            unref: () => { },
            on: () => { },
            stderr: { on: () => { } },
            stdout: { on: () => { } },
            kill: () => { }
        })
    };
});

describe('Service Module', () => {
    afterAll(async () => {
        await cleanupTestRoot();
    });

    it('should have installService function', () => {
        expect(installService).toBeDefined();
    });

    it('should have uninstallService function', () => {
        expect(uninstallService).toBeDefined();
    });

    it('should handle service installation (mocked)', async () => {
        await expect(installService(300)).resolves.not.toThrow();
    });

    it('should handle service uninstallation (mocked)', async () => {
        await expect(uninstallService()).resolves.not.toThrow();
    });
});
