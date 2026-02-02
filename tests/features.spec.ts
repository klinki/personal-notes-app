import { describe, it, expect, beforeEach, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { getTestDir, cleanupTestRoot } from './test_utils';
import matter from "gray-matter";

describe("Features (Tags & Templates)", () => {
    let TEST_DIR: string;
    let store: typeof import("../src/store");

    beforeEach(async () => {
        TEST_DIR = getTestDir('features');
        process.env.MNOTE_HOME = TEST_DIR;
        await mkdir(TEST_DIR, { recursive: true });
        store = await import("../src/store");
        store.setDbLocation(TEST_DIR);
    });

    afterAll(async () => {
        if (store && store.closeDB) {
            store.closeDB();
        }
        await cleanupTestRoot();
    });

    it("should list templates", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });
        await writeFile(join(templatesDir, 'daily.md'), 'daily content');
        await writeFile(join(templatesDir, 'meeting.md'), 'meeting content');

        const templates = await store.getTemplates();
        expect(templates).toHaveLength(2);
        expect(templates).toContain('daily.md');
        expect(templates).toContain('meeting.md');
    });

    it("should add a note with tags (frontmatter)", async () => {
        const book = "tag-test";
        const content = "my note content";
        const tags = ["work", "important"];

        await store.addNote(book, content, { tags });

        const notes = await store.getNotes(book);
        expect(notes).toHaveLength(1);

        const parsed = matter(notes[0].content);
        expect(parsed.data.tags).toEqual(expect.arrayContaining(tags));
        expect(parsed.content.trim()).toBe(content);
    });

    it("should apply template variables", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });

        const templateContent = `Date: $DATE_YEAR-$DATE_MONTH-$DATE_DAY
Title: $FOAM_TITLE
---
Template content`;
        await writeFile(join(templatesDir, 'variable-test.md'), templateContent);

        const book = "template-test";
        await store.addNote(book, "", { template: 'variable-test.md' });

        const notes = await store.getNotes(book);
        expect(notes).toHaveLength(1);

        const content = notes[0].content;
        const now = new Date();
        const year = String(now.getFullYear());
        const month = String(now.getMonth() + 1).padStart(2, '0');

        expect(content).toContain(`Date: ${year}-${month}`);
        expect(content).toContain("Title: untitled");
        expect(content).toContain("Template content");
    });

    it("should combine template and extra content", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });
        await writeFile(join(templatesDir, 'simple.md'), 'Template Header');

        await store.addNote("combine-test", "User Content", { template: 'simple.md' });

        const notes = await store.getNotes("combine-test");
        expect(notes[0].content).toContain("Template Header");
        expect(notes[0].content).toContain("User Content");
    });

    it("should merge template tags and cli tags", async () => {
        const templatesDir = join(TEST_DIR, '.foam', 'templates');
        await mkdir(templatesDir, { recursive: true });

        const templateContent = `---
tags: [template-tag]
---
Body`;
        await writeFile(join(templatesDir, 'tagged.md'), templateContent);

        await store.addNote("merge-tags", "Extra Content", {
            template: 'tagged.md',
            tags: ['cli-tag']
        });

        const notes = await store.getNotes("merge-tags");
        const parsed = matter(notes[0].content);

        expect(parsed.data.tags).toContain('template-tag');
        expect(parsed.data.tags).toContain('cli-tag');
        expect(parsed.content).toContain('Body');
        expect(parsed.content).toContain('Extra Content');
    });

    it("should find notes by tag", async () => {
        await store.addNote("find-tag", "content 1", { tags: ["red"] });
        await store.addNote("find-tag", "content 2", { tags: ["blue"] });
        await store.addNote("find-tag", "content 3", { tags: ["red", "green"] });

        const redNotes = await store.findNotes("", undefined, "red");
        expect(redNotes).toHaveLength(2);

        const blueNotes = await store.findNotes("", undefined, "blue");
        expect(blueNotes).toHaveLength(1);
        expect(blueNotes[0].content).toContain("content 2");

        const greenNotes = await store.findNotes("", undefined, "green");
        expect(greenNotes).toHaveLength(1);
    });

    it("should find notes by tag AND keyword", async () => {
        await store.addNote("mix-search", "important update", { tags: ["work"] });
        await store.addNote("mix-search", "boring update", { tags: ["work"] });

        const results = await store.findNotes("important", undefined, "work");
        expect(results).toHaveLength(1);
        expect(results[0].content).toContain("important update");
    });
});
