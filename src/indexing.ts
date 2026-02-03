import { join, relative, basename } from 'node:path';
import { existsSync } from 'node:fs';
import { readFile, writeFile, readdir } from 'node:fs/promises';

const MARKER_START = '<!-- MNOTE_INDEX_START -->';
const MARKER_END = '<!-- MNOTE_INDEX_END -->';

/**
 * Updates a file with generated content, preserving content outside markers.
 */
async function updateFileWithContent(filePath: string, generatedContent: string, title: string) {
    let content = '';
    if (existsSync(filePath)) {
        content = await readFile(filePath, 'utf-8');
    } else {
        content = `# ${title}\n\n`;
    }

    const startIdx = content.indexOf(MARKER_START);
    const endIdx = content.indexOf(MARKER_END);

    let newContent = '';

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        const pre = content.substring(0, startIdx);
        const post = content.substring(endIdx + MARKER_END.length);
        newContent = `${pre}${MARKER_START}\n${generatedContent}\n${MARKER_END}${post}`;
    } else {
        if (content.trim().length > 0) {
            newContent = `${content}\n\n${MARKER_START}\n${generatedContent}\n${MARKER_END}\n`;
        } else {
            newContent = `# ${title}\n\n${MARKER_START}\n${generatedContent}\n${MARKER_END}\n`;
        }
    }

    await writeFile(filePath, newContent, 'utf-8');
}

/**
 * Generates/Updates the root README.md with a tree view of all books.
 * @param rootPath - The absolute path of the root directory
 */
export async function generateRootReadme(rootPath: string) {
    const readmePath = join(rootPath, 'README.md');

    // Build tree
    const tree = await buildTree(rootPath);
    const markdown = generateTreeMarkdown(tree);

    await updateFileWithContent(readmePath, markdown, 'My Personal Notes');
}

/**
 * Generates/Updates INDEX.md for a specific book.
 * @param bookAbsolutePath - The absolute path to the book directory
 */
export async function generateBookIndex(bookAbsolutePath: string) {
    const indexPath = join(bookAbsolutePath, 'INDEX.md');

    let entries;
    try {
        entries = await readdir(bookAbsolutePath, { withFileTypes: true });
        // console.log(`[DEBUG] generateBookIndex(${bookAbsolutePath}) found:`, entries.map(e => e.name));
    } catch (e) {
        // Did directory get deleted?
        return;
    }

    // Sort directories then files
    entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
    });

    let md = '## Contents\n\n';

    // Lists
    const dirs: string[] = [];
    const files: string[] = [];

    for (const entry of entries) {
        if (entry.name === 'INDEX.md' || entry.name.startsWith('.')) continue; // Skip self and hidden

        if (entry.isDirectory()) {
            dirs.push(`- 📂 [${entry.name}](${encodeURI(entry.name)}/INDEX.md)`);
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
            files.push(`- 📄 [${entry.name.replace('.md', '')}](${encodeURI(entry.name)})`);
        }
    }

    if (dirs.length > 0) {
        md += '### Sub-books\n' + dirs.join('\n') + '\n\n';
    }

    if (files.length > 0) {
        md += '### Notes\n' + files.join('\n') + '\n';
    }

    if (dirs.length === 0 && files.length === 0) {
        md += '_Empty_\n';
    }

    const title = basename(bookAbsolutePath);
    await updateFileWithContent(indexPath, md, title);
}

// Tree generation helper
interface TreeNode {
    name: string;
    path: string; // Relative to root
    children: TreeNode[];
}

async function buildTree(currentPath: string, relPath: string = ''): Promise<TreeNode[]> {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    const nodes: TreeNode[] = [];

    for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const nextRel = relPath ? join(relPath, entry.name) : entry.name;
            const children = await buildTree(join(currentPath, entry.name), nextRel);
            nodes.push({
                name: entry.name,
                path: nextRel.replace(/\\/g, '/'), // Force forward slashes for markdown links
                children
            });
        }
    }
    return nodes;
}

function generateTreeMarkdown(nodes: TreeNode[], level: number = 0): string {
    let md = '';
    const indent = '  '.repeat(level);
    for (const node of nodes) {
        md += `${indent}- [${node.name}](${node.path}/INDEX.md)\n`;
        if (node.children.length > 0) {
            md += generateTreeMarkdown(node.children, level + 1);
        }
    }
    return md;
}

/**
 * Reindexes everything: Root README and all Book INDEXes.
 * @param rootPath - The absolute path to the root directory
 */
export async function reindexAll(rootPath: string) {
    await generateRootReadme(rootPath);
    await traverseAndIndex(rootPath, '');
}

async function traverseAndIndex(currentPath: string, relPath: string) {
    if (relPath) {
        await generateBookIndex(currentPath);
    }

    const entries = await readdir(currentPath, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isDirectory() && !entry.name.startsWith('.')) {
            const nextRel = relPath ? join(relPath, entry.name) : entry.name;
            await traverseAndIndex(join(currentPath, entry.name), nextRel);
        }
    }
}
