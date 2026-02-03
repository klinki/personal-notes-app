import { describe, it, expect, afterAll, spyOn, beforeAll, afterEach } from "bun:test";
import { installService, uninstallService } from '../src/commands/service';
import { cleanupTestRoot } from './test_utils';
import * as cp from 'node:child_process';

const execSpy = spyOn(cp, 'exec').mockImplementation((cmd: any, cb: any) => {
    if (typeof cb === 'function') {
        cb(null, 'ok', '');
    } else if (typeof cmd === 'function') { // Handle overload if any
        cmd(null, 'ok', '');
    }
    return {
        stdout: { on: () => { } },
        stderr: { on: () => { } }
    } as any;
});

// We generally don't want to spyOn spawn globally if we can avoid it, 
// as simple-git uses it.
// installService uses exec.
// So we only spy exec.
// If installService used spawn, we'd need to be careful.


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

    it.skip('should handle service installation (mocked)', async () => {
        await installService(300);
    });

    it.skip('should handle service uninstallation (mocked)', async () => {
        await uninstallService();
    });
});
