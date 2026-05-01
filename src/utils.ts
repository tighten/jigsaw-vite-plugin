import { execSync } from 'node:child_process';
import { readFileSync } from 'fs';
import { join, resolve } from 'path';
import { fileURLToPath } from 'url';
import { normalizePath } from 'vite';

/** Serializes async tasks so file-change bursts don't trigger overlapping Jigsaw builds. */
export class Queue {
    private items: {
        promise: () => Promise<void>;
        resolve: (value?: unknown) => void;
        reject: (err?: unknown) => void;
    }[] = [];
    private pending = false;

    enqueue(promise: () => Promise<void>): Promise<unknown> {
        return new Promise((resolve, reject) => {
            this.items.push({ promise, resolve, reject });
            this.dequeue();
        });
    }

    dequeue(): boolean {
        if (this.pending) return false;

        const item = this.items.shift();
        if (!item) return false;

        this.pending = true;

        item.promise()
            .then(item.resolve)
            .catch(item.reject)
            .finally(() => {
                this.pending = false;
                this.dequeue();
            });

        return true;
    }
}

export function normalizePaths(root: string, path: string | string[]): string[] {
    return (Array.isArray(path) ? path : [path]).map((p) => resolve(root, p)).map(normalizePath);
}

export function hasBin(name: string): boolean {
    try {
        execSync(process.platform === 'win32' ? `where ${name}` : `which ${name}`, { stdio: 'ignore' });
        return true;
    } catch {
        return false;
    }
}

export function dirname(): string {
    return fileURLToPath(new URL('.', import.meta.url));
}

export function pluginVersion(): string {
    try {
        return JSON.parse(readFileSync(join(dirname(), '../package.json'), 'utf-8'))?.version ?? '';
    } catch {
        return '';
    }
}

export function jigsawVersion(): string {
    try {
        const composer = JSON.parse(readFileSync('composer.lock', 'utf-8'));
        return (
            composer.packages?.find(
                (composerPackage: { name: string }) => composerPackage.name === 'tightenco/jigsaw',
            )?.version ?? ''
        );
    } catch {
        return '';
    }
}
