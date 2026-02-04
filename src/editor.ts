import { spawn } from 'bun';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';
import { getEditorConfig } from './config';

/**
 * Opens the default editor for note editing.
 * Falls back to terminal input if the editor fails to open.
 * @param initialContent - Optional initial content to populate the editor with
 * @returns The edited content, or null if the content is empty or unchanged
 */
export async function openEditor(initialContent = ''): Promise<string | null> {
  const editor = await getEditorConfig();
  const tmpPath = join(tmpdir(), `mnote-edit-${Date.now()}.md`);

  await writeFile(tmpPath, initialContent);

  try {
    // Parse the editor command into executable and arguments
    const { cmd, args } = parseEditorCommand(editor);

    const proc = spawn([cmd, ...args, tmpPath], {
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    });

    const exitCode = await proc.exited;

    if (exitCode !== 0) {
      throw new Error(`Editor exited with code ${exitCode}`);
    }

    const content = await readFile(tmpPath, 'utf-8');
    await unlink(tmpPath);

    if (content.trim() === '') return null;
    return content;
  } catch (e: any) {
    // If it's a spawn error (e.g. editor not found), fallback to inline
    // We treat exit code != 0 as a failure too, asking user if they want to retry or use inline
    // For now, let's simply fallback to inline input if editor fails.

    // Cleanup tmp file if it still exists
    try { await unlink(tmpPath); } catch { }

    console.warn(`\n⚠️  Could not open editor '${editor}' or editor exited with error.`);
    // Only show error details if verbose or needed? 
    // console.warn(e.message); 

    console.log('\n📝 Switched to inline input mode.');
    console.log('Type your note below. Press Ctrl+Z (Windows) or Ctrl+D (Linux/Mac) then Enter on a new line to save.\n');

    return await readFromTerminal(initialContent);
  }
}

/**
 * Reads input from the terminal.
 * @param initialContent - Optional initial content to display
 * @returns The input content, or null if empty
 */
export async function readFromTerminal(initialContent: string): Promise<string | null> {
  const { createInterface } = await import('node:readline');

  if (initialContent) {
    console.log('--- Initial Content ---');
    console.log(initialContent);
    console.log('--- End Initial Content ---\n');
    console.log('(Append your text below)');
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: '',
  });

  const lines: string[] = [];
  if (initialContent) lines.push(initialContent);

  for await (const line of rl) {
    lines.push(line);
  }

  const content = lines.join('\n');
  if (content.trim() === '') return null;
  return content;
}

/**
 * Parses the editor command string into command and arguments.
 * Handles simple space-separated arguments.
 * Does not currently support quoted paths with spaces, but assumes simple "cmd arg1 arg2" format.
 * @param editorCommand - The editor command string (e.g. "code -w" or "vim")
 * @returns Object containing the command and an array of arguments
 */
export function parseEditorCommand(editorCommand: string): { cmd: string, args: string[] } {
  const parts = editorCommand.trim().split(/\s+/);
  const cmd = parts[0];
  const args = parts.slice(1);
  return { cmd: cmd || '', args };
}
