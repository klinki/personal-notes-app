import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { getTestDir, cleanupTestRoot } from './test_utils';

const CLI_PATH = join(process.cwd(), "src", "index.ts");
const BUN_BIN = process.execPath; 

// We need to pass MNOTE_HOME env var to the child process

describe("CLI Commands", () => {
    let TEST_DIR: string;

    beforeEach(async () => {
        TEST_DIR = getTestDir('commands');
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    async function runCLI(args: string[], input = "") {
        const proc = Bun.spawn([BUN_BIN, CLI_PATH, ...args], {
            env: {
                ...process.env,
                MNOTE_HOME: TEST_DIR 
            },
            stdin: input ? "pipe" : undefined,
            stdout: "pipe",
            stderr: "pipe",
        });

        if (input && proc.stdin) {
            const writer = proc.stdin.getWriter();
            writer.write(input);
            writer.close();
        }

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        return { stdout, stderr, exitCode };
    }

    it("should list empty books initially", async () => {
        const { stdout, stderr, exitCode } = await runCLI(["list"]);
        if (exitCode !== 0) console.log("List failed:", stdout, stderr);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("No books found.");
    });

    it("should add a note (inline argument)", async () => {
        const { stdout, stderr, exitCode } = await runCLI(["add", "testbook", "first note"]);
        if (exitCode !== 0) console.log("Add failed:", stdout, stderr);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Note saved");
        
        // Verify it appears in list
        const listResult = await runCLI(["list"]);
        expect(listResult.stdout).toContain("testbook");
    });

    it("should view notes", async () => {
        await runCLI(["add", "mybook", "content in note"]);
        
        const { stdout, exitCode } = await runCLI(["view", "mybook"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("content in note");
    });

    it("should handle view for non-existent book", async () => {
        const { stdout } = await runCLI(["view", "nosuchbook"]);
        expect(stdout).toContain("No notes found");
    });
    it("should delete a note with --force", async () => {
        await runCLI(["add", "deletebook", "note to delete"]);
        
        const { stdout, exitCode } = await runCLI(["delete", "deletebook", "1", "--force"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Deleted note");

        const viewResult = await runCLI(["view", "deletebook"]);
        expect(viewResult.stdout).toContain("No notes found");
    });
    it("should show help with --help", async () => {
        const { stdout, exitCode } = await runCLI(["--help"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Usage: mnote");
        expect(stdout).toContain("Commands:");
    });

    it("should show command help with help <command>", async () => {
        const { stdout, exitCode } = await runCLI(["help", "delete"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Delete a note from a book");
        expect(stdout).toContain("Usage: mnote delete");
    });

    it("should show command help with <command> --help", async () => {
        const { stdout, exitCode } = await runCLI(["delete", "--help"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Delete a note from a book");
    });

    it("should show command help with <command> -h", async () => {
        const { stdout, exitCode } = await runCLI(["delete", "-h"]);
        expect(exitCode).toBe(0);
    });

    it("should find notes", async () => {
        await runCLI(["add", "searchbook", "special keyword note"]);
        
        const { stdout, exitCode } = await runCLI(["find", "special keyword"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("searchbook");
        expect(stdout).toContain("special keyword note");
    });

    it("should find notes in specific book", async () => {
        await runCLI(["add", "b1", "target"]);
        await runCLI(["add", "b2", "target"]);

        const { stdout } = await runCLI(["find", "target", "-b", "b1"]);
        expect(stdout).toContain("b1");
        expect(stdout).not.toContain("b2");
    });

    it("should show where info", async () => {
        const { stdout, exitCode } = await runCLI(["where"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain(TEST_DIR);
        // In our test setup, MNOTE_HOME is set in runCLI env, so it should say "MNOTE_HOME environment variable"
        // Wait, looking at store.ts, I set MNOTE_HOME = process.env.MNOTE_HOME.
        // And runCLI sets MNOTE_HOME. So it should report as env var.
        expect(stdout).toContain("MNOTE_HOME environment variable");
    });

    it("should report --dbLocation flag source", async () => {
        const customDir = "custom-db-loc";
        const { stdout, exitCode } = await runCLI(["where", "--dbLocation", customDir]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain(customDir);
        expect(stdout).toContain("--dbLocation flag");
    });

    it("should edit note content inline", async () => {
        await runCLI(["add", "inline-edit", "old content"]);
        
        const { stdout, exitCode } = await runCLI(["edit", "inline-edit", "1", "-c", "new content"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Updated note");
        
        const view = await runCLI(["view", "inline-edit"]);
        expect(view.stdout).toContain("new content");
    });

    it("should move a note via cli", async () => {
        await runCLI(["add", "move-cli-source", "move me"]);
        
        const { stdout, exitCode } = await runCLI(["edit", "move-cli-source", "1", "-b", "move-cli-target"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Moved note");
        
        const viewTarget = await runCLI(["view", "move-cli-target"]);
        expect(viewTarget.stdout).toContain("move me");
    });

    it("should rename a book via cli", async () => {
        await runCLI(["add", "rename-cli-source", "stay here"]);
        
        const { stdout, exitCode } = await runCLI(["edit", "rename-cli-source", "-n", "rename-cli-target"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("Renamed book");
        
        const viewTarget = await runCLI(["view", "rename-cli-target"]);
        expect(viewTarget.stdout).toContain("stay here");
    });
});
