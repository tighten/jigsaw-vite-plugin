import { existsSync, readFileSync } from 'fs';
import { spawn } from 'child_process';
import { resolve, relative, join } from 'path';
import { fileURLToPath } from 'url';
import { Plugin, loadEnv, UserConfig, ConfigEnv, ResolvedConfig, normalizePath } from 'vite';
import laravel from 'laravel-vite-plugin';
import picomatch from 'picomatch';
import colors from 'picocolors';
import hasbin from 'hasbin';

export class Queue {
    private queue: {
        promise: () => Promise<void>;
        resolve: (value?: unknown) => void;
        reject: (err?: unknown) => void;
    }[] = [];
    private pending = false;

    enqueue(promise: () => Promise<void>) {
        return new Promise<any>((resolve, reject) => {
            this.queue.push({
                promise,
                resolve,
                reject,
            });
            this.dequeue();
        });
    }

    dequeue() {
        if (this.pending) {
            return false;
        }
        const item = this.queue.shift();
        if (!item) {
            return false;
        }
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

const JigsawQueue = new Queue();

type LaravelPluginConfig = Extract<Parameters<typeof laravel>[0], { input: any }>;

type RefreshConfig = {
    files: string[];
    ignored: string[];
    /**
     * @default 'cwd'
     */
    root?: string;
    /**
     * @default '*'
     */
    always?: boolean;
    /**
     * @default 0
     */
    delay?: number;
};

type DefinedRefreshConfig = boolean | Required<RefreshConfig>;

type JigsawPluginConfig = {
    /**
     * Jigsaw's source directory.
     *
     * @default 'source'
     */
    sourceDirectory?: string;
    /**
     * The path to the "hot" file.
     *
     * @default `${sourceDirectory}/hot`
     */
    hotFile?: string;
    /**
     * Directory relative from `root` where build output will be placed.
     * If the directory exists, it will be removed before the build.
     * It willl replace the `build.outDir` vite config.
     *
     * @default `${sourceDirectory}/assets/build`
     */
    outDir?: string;
    /**
     * Configuration for performing new Jigsaw builds and
     * full page refresh on blade file changes.
     *
     * @default false
     */
    refresh?: boolean | RefreshConfig;
};

type AvailableLaravelPluginConfig = Pick<LaravelPluginConfig, 'input' | 'detectTls' | 'transformOnServe'>;

type PluginConfig = AvailableLaravelPluginConfig & JigsawPluginConfig;

type DefinedPluginConfig = AvailableLaravelPluginConfig &
    Required<JigsawPluginConfig> & { refresh: DefinedRefreshConfig };

const defaultWatchFiles = (source: string) => [
    'config.php',
    'bootstrap.php',
    'listeners/**/*.php',
    `${source}/**/*.md`,
    `${source}/**/*.php`,
    `${source}/**/*.html`,
];

const defaultWatchIgnored = (source: string) => ['build_**/**', 'cache/**', `${source}/**/_tmp/*`];

export function normalizePaths(root: string, path: string | string[]): string[] {
    return (Array.isArray(path) ? path : [path]).map((path) => resolve(root, path)).map(normalizePath);
}

/**
 * Returns the Jigsaw binary.
 */
function jigsawBinPath() {
    if (existsSync('./vendor/bin/jigsaw')) {
        return resolve('./vendor/bin/jigsaw');
    }

    if (hasbin.sync('jigsaw')) {
        return 'jigsaw';
    }

    console.error('Could not find Jigsaw; please install it via Composer.');
    process.exit();
}

/**
 * Spawns a child process to run "jigsaw build" with the proper environment.
 */
function spawnJigsawBuild(quiet = true): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const bin = jigsawBinPath();
        const envArg = process.env.NODE_ENV === 'development' ? 'local' : process.env.NODE_ENV;
        const child = spawn(bin, [`build ${quiet ? '-q' : ''}`, envArg!], { stdio: 'inherit', shell: true });
        child.on('exit', (code) => {
            if (Number(code) > 0) {
                console.warn('\nJigsaw build failed, see above.');
                reject(new Error(`Jigsaw build exited with code ${code}`));
            } else {
                resolve();
            }
        });
    });
}

export default function jigsaw(config: PluginConfig): [JigsawPlugin, ...Plugin[]] {
    const pluginConfig = resolvePluginConfig(config);

    return [
        ...laravel({
            ...config,
            refresh: false,
            hotFile: pluginConfig.hotFile,
        } as LaravelPluginConfig),
        resolveJigsawPlugin(pluginConfig),
        ...resolveJigsawWatcherPlugin(pluginConfig),
    ];
}

function resolveRefreshPluginConfig(
    refreshConfig: PluginConfig['refresh'],
    sourceDirectory: string,
): DefinedRefreshConfig {
    let config: DefinedRefreshConfig = false;

    const defaultRefreshConfig = {
        files: defaultWatchFiles(sourceDirectory),
        ignored: defaultWatchIgnored(sourceDirectory),
        root: process.cwd(),
        always: true,
        delay: 0,
    };

    if (refreshConfig === true) {
        config = defaultRefreshConfig;
    }

    if (typeof refreshConfig === 'object') {
        config = {
            files: refreshConfig.files ?? defaultRefreshConfig.files,
            ignored: refreshConfig.ignored ?? defaultRefreshConfig.ignored,
            root: refreshConfig.root ?? defaultRefreshConfig.root,
            always: refreshConfig.always ?? defaultRefreshConfig.always,
            delay: refreshConfig.delay ?? defaultRefreshConfig.delay,
        };
    }
    return config;
}

function resolvePluginConfig(config: PluginConfig): DefinedPluginConfig {
    const sourceDirectory = config.sourceDirectory ?? 'source';

    return {
        ...config,
        sourceDirectory: sourceDirectory,
        refresh: resolveRefreshPluginConfig(config.refresh, sourceDirectory),
        hotFile: config.hotFile ?? `${sourceDirectory}/hot`,
        outDir: config.outDir ?? `${sourceDirectory}/assets/build`,
    };
}

interface JigsawPlugin extends Plugin {
    config: (config: UserConfig, env: ConfigEnv) => UserConfig;
}

function resolveJigsawPlugin(pluginConfig: DefinedPluginConfig): JigsawPlugin {
    let resolvedConfig: ResolvedConfig;

    return {
        name: 'jigsaw',
        enforce: 'post',
        config: (_config, { command }) => {
            let publicDir: boolean | string = false;

            if (command === 'serve') {
                const suffix = process.env.NODE_ENV === 'development' ? 'local' : process.env.NODE_ENV;
                publicDir = `build_${suffix}`;
            }

            return {
                publicDir,
                build: {
                    outDir: pluginConfig.outDir,
                },
            };
        },

        configResolved(config) {
            resolvedConfig = config;
        },

        configureServer(server) {
            // Trigger the initial build on server start.
            spawnJigsawBuild()
                .then(() => {
                    server.config.logger.info(`\n  ${colors.green('Initial Jigsaw build completed.')}`);
                })
                .catch((error) => {
                    console.error('Initial Jigsaw build error:', error);
                });

            setTimeout(() => {
                server.config.logger.info(
                    `\n  ${colors.yellow(`${colors.bold('JIGSAW')} ${jigsawVersion()}`)}  ${colors.dim('plugin')} ${colors.bold(`v${pluginVersion()}`)}`,
                );
            }, 100);

            const envDir = resolvedConfig.envDir || process.cwd();
            const appUrl = loadEnv(resolvedConfig.mode, envDir, 'APP_URL').APP_URL ?? 'undefined';

            return () => {
                // This is the line that removes the laravel-vite middleware
                server.middlewares.stack.pop();

                server.middlewares.use((req, res, next) => {
                    if (req.url === '/index.html') {
                        res.statusCode = 404;

                        res.end(
                            readFileSync(join(dirname(), 'dev-server-index.html'))
                                .toString()
                                .replace(/{{ APP_URL }}/g, appUrl),
                        );
                    }
                    next();
                });
            };
        },

        async closeBundle() {
            try {
                await spawnJigsawBuild(false);
            } catch (error) {
                console.error('Jigsaw build error:', error);
            }
        },
    };
}

function resolveJigsawWatcherPlugin(pluginConfig: DefinedPluginConfig): JigsawPlugin[] {
    if (typeof pluginConfig.refresh !== 'object') {
        return [];
    }

    const refreshConfig = pluginConfig.refresh;
    const files = normalizePaths(refreshConfig.root, refreshConfig.files);
    const ignored = normalizePaths(refreshConfig.root, refreshConfig.ignored);
    const shouldReload = picomatch(files);

    return [
        {
            name: 'jigsaw-watcher',
            apply: 'serve',
            config: () => ({
                server: {
                    watch: { disableGlobbing: false, ignored: ignored },
                },
            }),

            configureServer(server) {
                const checkReload = async (path: string) => {
                    if (shouldReload(path)) {
                        const start = performance.now();

                        await JigsawQueue.enqueue(() => spawnJigsawBuild());

                        const end = performance.now();

                        setTimeout(() => {
                            server.config.logger.info(
                                `${colors.green('full reload')} for ${colors.dim(relative(refreshConfig.root, path))} - build: ${Math.round(end - start)} ms`,
                                {
                                    timestamp: true,
                                    clear: true,
                                },
                            );

                            server.ws.send({ type: 'full-reload', path: refreshConfig.always ? '*' : path });
                        }, refreshConfig.delay);
                    }
                };

                // Ensure Vite keeps track of the files and triggers HMR as needed.
                server.watcher.add(files);

                // Do a full page reload if any of the watched files changes.
                server.watcher.on('add', checkReload);
                server.watcher.on('change', checkReload);
            },

            handleHotUpdate({ file: path, modules }) {
                if (shouldReload(path)) {
                    return [];
                }

                return modules;
            },
        },
    ];
}

function dirname(): string {
    return fileURLToPath(new URL('.', import.meta.url));
}

function pluginVersion(): string {
    try {
        return JSON.parse(readFileSync(join(dirname(), '../package.json')).toString())?.version;
    } catch {
        return '';
    }
}

function jigsawVersion(): string {
    try {
        const composer = JSON.parse(readFileSync('composer.lock').toString());

        return (
            composer.packages?.find((composerPackage: { name: string }) => composerPackage.name === 'tightenco/jigsaw')
                ?.version ?? ''
        );
    } catch {
        return '';
    }
}
