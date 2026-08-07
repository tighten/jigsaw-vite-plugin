import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import jigsaw from '../src';
import {
    defaultRefreshFiles,
    defaultRefreshIgnored,
    resolvePluginConfig,
} from '../src/config';
import { DEV_URL_PLACEHOLDER, defaultCorsOrigin } from '../src/dev-server';
import { Queue, normalizePaths } from '../src/utils';

const root = '/root';
const expectNormalized = (path: string | string[]) => expect(normalizePaths(root, path));

describe('jigsaw()', () => {
    afterEach(() => {
        vi.unstubAllEnvs();
    });

    test('returns at least the main plugin when refresh is disabled', () => {
        const plugins = jigsaw({ input: 'source/_assets/js/main.js' });

        expect(plugins).toHaveLength(1);
        expect(plugins[0].name).toBe('jigsaw');
    });

    test('adds the watcher plugin when refresh is enabled', () => {
        const plugins = jigsaw({
            input: 'source/_assets/js/main.js',
            refresh: true,
        });

        expect(plugins).toHaveLength(2);
        expect(plugins[0].name).toBe('jigsaw');
        expect(plugins[1].name).toBe('jigsaw:watcher');
    });

    test('handles missing configuration', () => {
        // @ts-expect-error intentional bad input
        expect(() => jigsaw())
            .toThrowError('@tighten/jigsaw-vite-plugin: missing configuration.');

        // @ts-expect-error intentional bad input
        expect(() => jigsaw({}))
            .toThrowError('@tighten/jigsaw-vite-plugin: missing configuration for "input".');
    });

    test('sets Jigsaw-aware build defaults', () => {
        const plugin = jigsaw({ input: 'source/_assets/js/main.js' })[0];

        const config = plugin.config({}, { command: 'build', mode: 'production' });

        expect(config.publicDir).toBe(false);
        expect(config.build!.manifest).toBe('manifest.json');
        expect(config.build!.assetsInlineLimit).toBe(0);
        expect(config.build!.outDir).toBe('source/assets/build');
        expect((config.build!.rollupOptions as any).input).toBe('source/_assets/js/main.js');
        expect(config.server!.origin).toBe(`http://${DEV_URL_PLACEHOLDER}.test`);
    });

    test('uses build_${NODE_ENV} as publicDir during serve', () => {
        vi.stubEnv('NODE_ENV', 'development');
        const plugin = jigsaw({ input: 'source/_assets/js/main.js' })[0];

        const config = plugin.config({}, { command: 'serve', mode: 'development' });

        expect(config.publicDir).toBe('build_local');
    });

    test('respects user-provided overrides', () => {
        const plugin = jigsaw({ input: 'source/_assets/js/main.js' })[0];

        const config = plugin.config(
            {
                base: '/my-base/',
                publicDir: 'public',
                build: {
                    manifest: 'my-manifest.json',
                    outDir: 'custom-dist',
                    assetsInlineLimit: 1024,
                    rollupOptions: { input: 'other.js' },
                },
                server: { origin: 'https://custom.test' },
            },
            { command: 'build', mode: 'production' },
        );

        expect(config.base).toBe('/my-base/');
        expect(config.publicDir).toBe('public');
        expect(config.build!.manifest).toBe('my-manifest.json');
        expect(config.build!.outDir).toBe('custom-dist');
        expect(config.build!.assetsInlineLimit).toBe(1024);
        expect((config.build!.rollupOptions as any).input).toBe('other.js');
        expect(config.server!.origin).toBe('https://custom.test');
    });

    test("respects the user's server.cors config", () => {
        const plugin = jigsaw({ input: 'source/_assets/js/main.js' })[0];

        const config = plugin.config({ server: { cors: true } }, { command: 'serve', mode: 'development' });

        expect(config.server!.cors).toBe(true);
    });

    test('uses the user-supplied server.origin as the cors origin', () => {
        const plugin = jigsaw({ input: 'source/_assets/js/main.js' })[0];

        const config = plugin.config({ server: { origin: 'https://custom.test' } }, { command: 'serve', mode: 'development' });

        expect((config.server!.cors as any).origin).toBe('https://custom.test');
    });
});

describe('resolvePluginConfig', () => {
    test('fills in sensible defaults', () => {
        const resolved = resolvePluginConfig({ input: 'app.js' });

        expect(resolved).toMatchObject({
            input: 'app.js',
            sourceDirectory: 'source',
            hotFile: 'source/hot',
            outDir: 'source/assets/build',
            refresh: false,
            detectTls: null,
        });
        expect(resolved.transformOnServe('ab', 'http://x:1')).toBe('ab');
    });

    test('derives paths from a custom sourceDirectory', () => {
        const resolved = resolvePluginConfig({
            input: 'app.js',
            sourceDirectory: 'site',
        });

        expect(resolved.hotFile).toBe('site/hot');
        expect(resolved.outDir).toBe('site/assets/build');
    });

    test('resolves refresh: true to defaults based on sourceDirectory', () => {
        const resolved = resolvePluginConfig({
            input: 'app.js',
            sourceDirectory: 'site',
            refresh: true,
        });

        expect(resolved.refresh).toMatchObject({
            files: defaultRefreshFiles('site'),
            ignored: defaultRefreshIgnored('site'),
            always: true,
            delay: 0,
        });
    });

    test('merges partial refresh overrides with defaults', () => {
        const resolved = resolvePluginConfig({
            input: 'app.js',
            refresh: { delay: 200, always: false },
        });

        expect(resolved.refresh).toMatchObject({
            files: defaultRefreshFiles('source'),
            ignored: defaultRefreshIgnored('source'),
            delay: 200,
            always: false,
        });
    });
});

describe('defaultCorsOrigin', () => {
    const allows = (origins: (string | RegExp)[], url: string) =>
        origins.some((o) => o instanceof RegExp ? o.test(url) : o === url);

    test('configures default cors.origin values', () => {
        const origins = defaultCorsOrigin({ APP_URL: 'https://my-app.tld' });

        for (const url of [
            'http://localhost',
            'https://localhost:5173',
            'http://127.0.0.1',
            'https://127.0.0.1:8000',
            'http://laravel.test',
            'https://sub.my-app.test:8443',
            'https://my-app.tld',
        ]) {
            expect(allows(origins, url)).toBe(true);
        }

        for (const url of ['http://evil.com', 'https://128.0.0.1', 'http://exampletest']) {
            expect(allows(origins, url)).toBe(false);
        }
    });

    test('omits APP_URL when the env var is unset', () => {
        const origins = defaultCorsOrigin({});
        expect(allows(origins, 'https://my-app.tld')).toBe(false);
        expect(allows(origins, 'http://localhost:5173')).toBe(true);
    });
});

describe('normalizePaths', () => {
    test('handles strings and arrays', () => {
        expectNormalized('/absolute/**/*.js').toEqual(['/absolute/**/*.js']);
        expectNormalized('relative/**/*.php').toEqual(['/root/relative/**/*.php']);
        expectNormalized(['/absolute/**/*.js', 'relative/**/*.php']).toEqual([
            '/absolute/**/*.js',
            '/root/relative/**/*.php',
        ]);
    });
});

describe('Queue', () => {
    let queue: Queue;

    beforeEach(() => {
        queue = new Queue();
    });

    test('dequeue returns false when empty', () => {
        expect(queue.dequeue()).toBe(false);
    });

    test('processes promises in enqueue order', async () => {
        const order: number[] = [];
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const p1 = () => delay(30).then(() => order.push(1)) as Promise<void>;
        const p2 = () => delay(20).then(() => order.push(2)) as Promise<void>;
        const p3 = () => delay(10).then(() => order.push(3)) as Promise<void>;

        await Promise.all([queue.enqueue(p1), queue.enqueue(p2), queue.enqueue(p3)]);

        expect(order).toEqual([1, 2, 3]);
    });

    test('continues after a rejected task', async () => {
        const results: (string | Error)[] = [];

        const success = () => Promise.resolve().then(() => results.push('one')) as Promise<void>;
        const failing = () => Promise.reject(new Error('boom'));
        const another = () => Promise.resolve().then(() => results.push('three')) as Promise<void>;

        await queue.enqueue(success).catch(() => {});
        await queue.enqueue(failing).catch((e) => results.push(e));
        await queue.enqueue(another).catch(() => {});

        expect(results).toHaveLength(3);
        expect(results[0]).toBe('one');
        expect(results[1]).toBeInstanceOf(Error);
        expect(results[2]).toBe('three');
    });
});
