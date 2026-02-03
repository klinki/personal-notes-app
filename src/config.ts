import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { getConfigPath } from './store';

/**
 * Configuration object type with known keys and strict types.
 * Extensible - allows adding new keys without breaking the type.
 */
export interface Config {
    editor?: string;
    autoSync?: {
        enabled?: boolean;
        git?: {
            branch?: string;
            [key: string]: unknown;
        };
        [key: string]: unknown;
    };
    generateIndexFiles?: boolean;
    [key: string]: unknown;
}

/**
 * Loads the configuration from the config file.
 * @returns The parsed configuration object, or an empty object if no config exists
 */
export async function loadConfig(): Promise<Config> {
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

/**
 * Saves the configuration to the config file.
 * @param config - The configuration object to save
 */
export async function saveConfig(config: Config): Promise<void> {
    const configPath = getConfigPath();
    await writeFile(configPath, JSON.stringify(config, null, 2));
}

function parseValue(value: string): unknown {
    try {
        return JSON.parse(value);
    } catch {
        return value;
    }
}

/**
 * Sets a configuration value using dot-notation key path.
 * @param keyPath - The configuration key path (e.g., 'editor' or 'git.branch')
 * @param value - The value to set (will be parsed as JSON if valid, otherwise stored as string)
 * @returns The updated full configuration object
 */
export async function setConfig(keyPath: string, value: string): Promise<Config> {
    const config = await loadConfig();
    const keys = keyPath.split('.');
    let current = config;
    const parsedValue = parseValue(value);

    for (let i = 0; i < keys.length - 1; i++) {
        const key = keys[i]!
        if (!current[key] || typeof current[key] !== 'object') {
            current[key] = {};
        }
        current = current[key] as Config;
    }

    current[keys[keys.length - 1]!] = parsedValue;
    await saveConfig(config);
    return config;
}

/**
 * Gets a configuration value using dot-notation key path.
 * @param keyPath - The configuration key path (e.g., 'editor' or 'git.branch')
 * @returns The configuration value
 * @throws Error if the key path is not found
 */
export async function getConfig(keyPath: string): Promise<unknown> {
    const config = await loadConfig();
    const keys = keyPath.split('.');
    let current: unknown = config;

    for (const key of keys) {
        if (current === undefined || current === null) {
            throw new Error(`Config key "${keyPath}" not found`);
        }
        current = (current as Config)[key];
    }

    if (current === undefined) {
        throw new Error(`Config key "${keyPath}" not found`);
    }

    return current;
}

/**
 * Gets the editor command from environment, config, or default.
 * @returns The editor command string
 */
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
