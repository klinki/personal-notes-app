import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getConfigPath } from './store';

export async function loadConfig(): Promise<any> {
    const configPath = getConfigPath();
    if (!existsSync(configPath)) {
        return {};
    }
    try {
        const content = await readFile(configPath, 'utf-8');
        return JSON.parse(content);
    } catch (e) {
        // If file exists but is invalid JSON, we might want to warn
        // console.error('Error loading config:', e);
        return {};
    }
}

export async function saveConfig(config: any): Promise<void> {
    const configPath = getConfigPath();
    await writeFile(configPath, JSON.stringify(config, null, 2));
}

function parseValue(value: string): any {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

export async function setConfig(keyPath: string, value: string): Promise<any> {
    const config = await loadConfig();
    const keys = keyPath.split('.');
    let current = config;
    const parsedValue = parseValue(value);

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i];
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key];
    }

    current[keys[keys.length - 1]] = parsedValue;
    await saveConfig(config);
    return config;
}

export async function getConfig(keyPath: string): Promise<any> {
    const config = await loadConfig();
    const keys = keyPath.split('.');
    let current = config;

    for (const key of keys) {
        if (current === undefined || current === null) {
             throw new Error(`Config key "${keyPath}" not found`);
        }
        current = current[key];
    }

    if (current === undefined) {
         throw new Error(`Config key "${keyPath}" not found`);
    }

    return current;
}

export async function getEditorConfig(): Promise<string> {
    // 1. Env
    if (process.env.EDITOR) {
        return process.env.EDITOR;
    }

    // 2. Config
    try {
        const configEditor = await getConfig('editor');
        if (typeof configEditor === 'string' && configEditor) {
            return configEditor;
        }
    } catch {
        // Ignore if key not found
    }

    // 3. Default
    return 'vi';
}
