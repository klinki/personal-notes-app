import { describe, it, expect, mock, spyOn } from "bun:test";
import { readFromTerminal, parseEditorCommand } from "../src/editor";

describe("readFromTerminal", () => {
    it("should exist", () => {
        expect(readFromTerminal).toBeDefined();
    });

    // To properly test readFromTerminal without user interaction, we'd need to mock 'node:readline' 
    // or the 'createInterface' function.
});

describe("parseEditorCommand", () => {
    it("should parse simple command", () => {
        const result = parseEditorCommand("vim");
        expect(result.cmd).toBe("vim");
        expect(result.args).toEqual([]);
    });

    it("should parse command with flags", () => {
        const result = parseEditorCommand("code -w");
        expect(result.cmd).toBe("code");
        expect(result.args).toEqual(["-w"]);
    });

    it("should parse command with multiple args", () => {
        const result = parseEditorCommand("code --wait --new-window");
        expect(result.cmd).toBe("code");
        expect(result.args).toEqual(["--wait", "--new-window"]);
    });

    it("should handle extra spaces", () => {
        const result = parseEditorCommand(" code  -w ");
        expect(result.cmd).toBe("code");
        expect(result.args).toEqual(["-w"]);
    });
});
