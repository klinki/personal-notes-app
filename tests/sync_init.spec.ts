import { describe, it, expect, beforeEach, afterEach, spyOn, mock } from "bun:test";
import { initSync } from "../src/commands/sync";
import * as store from "../src/store";
import * as config from "../src/config";

// Mock fs/promises
const mockFs = {
    writeFile: mock(async () => { }),
    readFile: mock(async () => ''),
    access: mock(async () => { })
};

mock.module("node:fs/promises", () => mockFs);

// Mock dependencies
const mockGit = {
    checkIsRepo: mock(async () => false),
    init: mock(async () => { }),
    getRemotes: mock(async () => []),
    addRemote: mock(async () => { }),
    remote: mock(async () => { }),
    listRemote: mock(async () => ''),
    status: mock(async () => ({ current: 'main' })),
    branchLocal: mock(async () => ({ all: ['main'] })),
    checkout: mock(async () => { }),
    checkoutLocalBranch: mock(async () => { }),
    add: mock(async () => { }),
    commit: mock(async () => { }),
    push: mock(async () => { }),
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
        mockGit.listRemote.mockResolvedValue(''); // Default missing
        mockGit.commit.mockClear();
        mockGit.push.mockClear();

        mockFs.writeFile.mockClear();
        mockFs.readFile.mockResolvedValue('');

        setConfigSpy = spyOn(config, 'setConfig').mockImplementation(async () => {
            return {} as any;
        });

        // Mock getDbInfo to return a safe path
        spyOn(store, 'getDbInfo').mockReturnValue({ path: '/tmp/test-notes', source: 'test' });
    });

    afterEach(() => {
        mock.restore();
    });

    it("should initialize git repo and create .gitignore", async () => {
        const options = { remote: 'git@example.com', branch: 'main' };

        await initSync(options);

        expect(mockGit.init).toHaveBeenCalled();
        expect(mockFs.writeFile).toHaveBeenCalled(); // .gitignore
        expect(setConfigSpy).toHaveBeenCalledWith('autoSync.enabled', 'true');
    });

    it("should create remote branch if missing and include .gitignore", async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        mockGit.getRemotes.mockResolvedValue([{ name: 'origin', refs: { push: 'git@example.com' } } as any]);
        mockGit.listRemote.mockResolvedValue(''); // Missing

        const options = { remote: 'git@example.com', branch: 'feature-branch' };
        await initSync(options);

        expect(mockGit.checkoutLocalBranch).toHaveBeenCalledWith('feature-branch');
        expect(mockGit.add).toHaveBeenCalledWith('.gitignore');
        expect(mockGit.commit).toHaveBeenCalledWith('Initializing mnote repository');
        expect(mockGit.push).toHaveBeenCalled();
    });

    it("should skip branch creation if exists", async () => {
        mockGit.checkIsRepo.mockResolvedValue(true);
        mockGit.getRemotes.mockResolvedValue([{ name: 'origin', refs: { push: 'git@example.com' } } as any]);
        mockGit.listRemote.mockResolvedValue('refs/heads/main'); // Exists

        const options = { remote: 'git@example.com', branch: 'main' };
        await initSync(options);

        expect(mockGit.commit).not.toHaveBeenCalled();
        expect(mockGit.push).not.toHaveBeenCalled();
    });
});
