import { spawn } from 'bun';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFile, readFile, unlink } from 'node:fs/promises';

export async function openEditor(initialContent = ''): Promise<string | null> {
  const editor = process.env.EDITOR || 'vi';
  const tmpPath = join(tmpdir(), `mnote-edit-${Date.now()}.md`);

  await writeFile(tmpPath, initialContent);

  const proc = spawn([editor, tmpPath], {
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
}
