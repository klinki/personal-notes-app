import { describe, it, expect, beforeEach, afterEach, afterAll } from "bun:test";
import { join } from "node:path";
import { mkdir, rm, exists, writeFile } from "node:fs/promises";
import { getTestDir, cleanupTestRoot } from './test_utils';
import { setDbLocation } from '../src/store';

// We need to import config AFTER setting MNOTE_HOME via store or env
let config: typeof import("../src/config");
let TEST_DIR: string;

describe("Config", () => {
    beforeEach(async () => {
        TEST_DIR = getTestDir('config');

        // Ensure directory exists
        await mkdir(TEST_DIR, { recursive: true });

        // Set store location which dictates config location
        setDbLocation(TEST_DIR);

        // Import config module
        config = await import("../src/config");

        // Reset process.env.EDITOR for isolation
        delete process.env.EDITOR;
    });

    afterEach(async () => {
        // clean up config file
        const configPath = join(TEST_DIR, 'config.json');
        if (await exists(configPath)) {
            await rm(configPath);
        }
    });

    afterAll(async () => {
        await cleanupTestRoot();
    });

    it("should return empty object if config missing", async () => {
        const loaded = await config.loadConfig();
        expect(loaded).toEqual({});
    });

    it("should set and get simple config", async () => {
        await config.setConfig("foo", "bar");
        const val = await config.getConfig("foo");
        expect(val).toBe("bar");
    });

    it("should set and get nested config", async () => {
        await config.setConfig("a.b.c", "value");
        const val = await config.getConfig("a.b.c");
        expect(val).toBe("value");

        const full = await config.loadConfig();
        expect(full).toEqual({ a: { b: { c: "value" } } });
    });

    it("should parse boolean values", async () => {
        await config.setConfig("isTrue", "true");
        const val = await config.getConfig("isTrue");
        expect(val).toBe(true);
    });

    it("should parse number values", async () => {
        await config.setConfig("num", "123");
        const val = await config.getConfig("num");
        expect(val).toBe(123);
    });

    it("should throw error if key not found", async () => {
        try {
            await config.getConfig("non.existent");
            throw new Error("Should have thrown");
        } catch (e: any) {
            expect(e.message).toContain("not found");
        }
    });

    it("should get editor config with precedence", async () => {
        // Default
        expect(await config.getEditorConfig()).toBe("vi");

        // Config
        await config.setConfig("editor", "nano");
        expect(await config.getEditorConfig()).toBe("nano");

        // Env
        process.env.EDITOR = "code";
        expect(await config.getEditorConfig()).toBe("code");
    });
});
