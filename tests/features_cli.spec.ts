import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

const TEST_DIR = join(tmpdir(), `mnote-cli-features-${Date.now()}`);
const CLI_PATH = join(process.cwd(), "src", "index.ts");
const BUN_BIN = process.execPath;

describe("CLI Features (Tags & Templates)", () => {
    beforeEach(async () => {
        await mkdir(TEST_DIR, { recursive: true });
    });

    afterEach(async () => {
        await rm(TEST_DIR, { recursive: true, force: true });
    });

    async function runCLI(args: string[]) {
        const proc = Bun.spawn([BUN_BIN, CLI_PATH, ...args], {
            env: {
                ...process.env,
                MNOTE_HOME: TEST_DIR
            },
            stdout: "pipe",
            stderr: "pipe",
        });

        const stdout = await new Response(proc.stdout).text();
        const stderr = await new Response(proc.stderr).text();
        const exitCode = await proc.exited;

        return { stdout, stderr, exitCode };
    }

    it("should list templates via CLI", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });
        await writeFile(join(templatesDir, 'cli-template.md'), 'content');

        const { stdout, exitCode } = await runCLI(["templates"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("cli-template.md");
    });

    it("should add note with tags via CLI", async () => {
        const { stdout, exitCode } = await runCLI(["add", "cli-tag-book", "content", "--tags", "one, two"]);
        expect(exitCode).toBe(0);

        const view = await runCLI(["view", "cli-tag-book"]);
        expect(view.stdout).toContain("tags:");
        expect(view.stdout).toContain("one");
        expect(view.stdout).toContain("two");
    });

    it("should find notes by tag via CLI", async () => {
        await runCLI(["add", "find-tag-book", "content", "--tags", "urgent"]);

        const { stdout, exitCode } = await runCLI(["find", "--tag", "urgent"]);
        expect(exitCode).toBe(0);
        expect(stdout).toContain("find-tag-book");
    });

    it("should add note with template via CLI", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });
        await writeFile(join(templatesDir, 'my-tpl.md'), 'TPL CONTENT');

        const { stdout, exitCode } = await runCLI(["add", "tpl-book", "extra", "--template", "my-tpl.md"]);
        expect(exitCode).toBe(0);

        const view = await runCLI(["view", "tpl-book"]);
        expect(view.stdout).toContain("TPL CONTENT");
        expect(view.stdout).toContain("extra");
    });
});
