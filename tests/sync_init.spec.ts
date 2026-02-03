import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { initSync } from "../src/commands/sync";
import * as store from "../src/store";
import * as config from "../src/config";

// Mock dependencies
const mockGit = {
    checkIsRepo: mock(async () => false),
    init: mock(async () => { }),
    getRemotes: mock(async () => []),
    addRemote: mock(async () => { }),
    remote: mock(async () => { }),
};

mock.module("simple-git", () => {
    return {
        simpleGit: () => mockGit
    };
});

describe("Sync Init", () => {
    let setConfigSpy: any;

    beforeEach(() => {
        // Reset mocks
        mockGit.checkIsRepo.mockResolvedValue(false);
        mockGit.init.mockClear();
        mockGit.addRemote.mockClear();
        mockGit.getRemotes.mockResolvedValue([]);

        setConfigSpy = spyOn(config, 'setConfig').mockImplementation(async () => {
            return {} as any;
        });

        // Mock getDbInfo to return a safe path
        spyOn(store, 'getDbInfo').mockReturnValue({ path: '/tmp/test-notes', source: 'test' });
    });

    afterEach(() => {
        mock.restore();
    });

    it("should initialize git repo if not present", async () => {
        mockGit.checkIsRepo.mockResolvedValue(false);

        // Mock prompt avoidance by passing options or mocking config??
        // Since we are mocking simple-git, we can't easily test the prompt without mocking readline.
        // Let's pass options to skip propermpt.
        const options = { remote: 'git@example.com', branch: 'main' };

        await initSync(options);

        expect(mockGit.init).toHaveBeenCalled();
        expect(mockGit.addRemote).toHaveBeenCalledWith('origin', 'git@example.com');
        expect(setConfigSpy).toHaveBeenCalledWith('autoSync.enabled', 'true');
        expect(setConfigSpy).toHaveBeenCalledWith('autoSync.git.remote', 'git@example.com');
    });

    it("should use existing repo and update remote if provided", async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        // Mock existing remote
        mockGit.getRemotes.mockResolvedValue([{ name: 'origin', refs: { push: 'old-url' } }]);

        const options = { remote: 'new-url', branch: 'main' };
        await initSync(options);

        expect(mockGit.init).not.toHaveBeenCalled();
        expect(mockGit.remote).toHaveBeenCalledWith(['set-url', 'origin', 'new-url']);
        expect(setConfigSpy).toHaveBeenCalledWith('autoSync.enabled', 'true');
    });
});
