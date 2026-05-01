import type { DevServerUrl } from './dev-server.js';
import type { DetectTlsOption } from './tls.js';

/**
 * Configuration for Jigsaw refresh watcher.
 *
 * When `refresh: true`, sensible defaults based on `sourceDirectory` are used.
 * Pass an object to override any individual option.
 */
export interface RefreshConfig {
    /**
     * Glob patterns of files that should trigger a Jigsaw build + full reload.
     */
    files?: string[];

    /**
     * Glob patterns of files/directories that should be ignored by the watcher.
     */
    ignored?: string[];

    /**
     * Root directory that `files` and `ignored` are resolved against.
     *
     * @default process.cwd()
     */
    root?: string;

    /**
     * When true, a `full-reload` message is sent to every open page (wildcard `*`).
     * When false, only the page matching the changed path is reloaded.
     *
     * @default true
     */
    always?: boolean;

    /**
     * Milliseconds to wait after a build completes before notifying the client.
     *
     * @default 0
     */
    delay?: number;
}

export type ResolvedRefreshConfig = Required<RefreshConfig>;

export interface JigsawPluginConfig {
    /**
     * Entry points to compile. Passed through to `build.rollupOptions.input`.
     */
    input: string | string[] | Record<string, string>;

    /**
     * Jigsaw's source directory. Used to compute defaults for `hotFile`,
     * `outDir`, and `refresh.files`/`refresh.ignored`.
     *
     * @default 'source'
     */
    sourceDirectory?: string;

    /**
     * Path to the Vite "hot" file that signals to the Blade `@vite` helper
     * that a dev server is running.
     *
     * @default `${sourceDirectory}/hot`
     */
    hotFile?: string;

    /**
     * Directory (relative to the Vite root) where the production build is emitted.
     *
     * @default `${sourceDirectory}/assets/build`
     */
    outDir?: string;

    /**
     * Configure automatic Jigsaw rebuilds + full page reloads on source changes.
     *
     * Pass `true` for sensible defaults, or an object to customize.
     *
     * @default false
     */
    refresh?: boolean | RefreshConfig;

    /**
     * Enable Herd/Valet TLS certificate detection for the dev server.
     *
     * - `false`: disabled
     * - `null`:  auto-detect silently (default — no error if certs aren't found)
     * - `true`:  auto-detect using the cwd directory name
     * - `string`: use the given host name
     *
     * @default null
     */
    detectTls?: DetectTlsOption;

    /**
     * Transform emitted code while serving. Runs after the `__jigsaw_vite_placeholder__`
     * origin has been rewritten to the actual dev server URL.
     */
    transformOnServe?: (code: string, url: DevServerUrl) => string;
}

export interface ResolvedJigsawPluginConfig {
    input: string | string[] | Record<string, string>;
    sourceDirectory: string;
    hotFile: string;
    outDir: string;
    refresh: false | ResolvedRefreshConfig;
    detectTls: DetectTlsOption;
    transformOnServe: (code: string, url: DevServerUrl) => string;
}

/**
 * Default glob patterns watched for changes when `refresh: true`.
 */
export function defaultRefreshFiles(sourceDirectory: string): string[] {
    return [
        '**/config.php',
        '**/bootstrap.php',
        '**/listeners/**/*.php',
        `**/${sourceDirectory}/**/*.md`,
        `**/${sourceDirectory}/**/*.php`,
        `**/${sourceDirectory}/**/*.html`,
    ];
}

export function defaultRefreshIgnored(sourceDirectory: string): string[] {
    return ['**/build_**/**', '**/cache/**', `**/${sourceDirectory}/**/_tmp/*`];
}

export function resolvePluginConfig(config: JigsawPluginConfig): ResolvedJigsawPluginConfig {
    if (!config || typeof config !== 'object') {
        throw new Error('@tighten/jigsaw-vite-plugin: missing configuration.');
    }

    if (!config.input) {
        throw new Error('@tighten/jigsaw-vite-plugin: missing configuration for "input".');
    }

    const sourceDirectory = config.sourceDirectory ?? 'source';

    return {
        input: config.input,
        sourceDirectory,
        hotFile: config.hotFile ?? `${sourceDirectory}/hot`,
        outDir: config.outDir ?? `${sourceDirectory}/assets/build`,
        refresh: resolveRefreshConfig(config.refresh, sourceDirectory),
        detectTls: config.detectTls ?? null,
        transformOnServe: config.transformOnServe ?? ((code) => code),
    };
}

function resolveRefreshConfig(
    refresh: JigsawPluginConfig['refresh'],
    sourceDirectory: string,
): false | ResolvedRefreshConfig {
    if (!refresh) return false;

    const defaults = {
        files: defaultRefreshFiles(sourceDirectory),
        ignored: defaultRefreshIgnored(sourceDirectory),
        root: process.cwd(),
        always: true,
        delay: 0,
    };

    if (refresh === true) return defaults;

    return {
        files: refresh.files ?? defaults.files,
        ignored: refresh.ignored ?? defaults.ignored,
        root: refresh.root ?? defaults.root,
        always: refresh.always ?? defaults.always,
        delay: refresh.delay ?? defaults.delay,
    };
}
