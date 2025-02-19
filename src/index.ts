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

type JigsawPluginConfig = {
    outDir?: string;
    refresh?: boolean | { files: string[]; ignored: string[] };
};
type PluginConfig = Pick<LaravelPluginConfig, 'input' | 'detectTls' | 'transformOnServe'> & JigsawPluginConfig;

const defaultWatch = {
    files: [
        'config.php',
        'bootstrap.php',
        'listeners/**/*.php',
        'source/**/*.md',
        'source/**/*.php',
        'source/**/*.html',
    ],

    ignored: ['build_**/**', 'cache/**', 'source/**/_tmp/*'],
};

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
function spawnJigsawBuild() {
    return new Promise<void>((resolve, reject) => {
        const bin = jigsawBinPath();
        const envArg = process.env.NODE_ENV === 'development' ? 'local' : process.env.NODE_ENV;
        const child = spawn(bin, ['build -q', envArg!], { stdio: 'inherit', shell: true });
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
            hotFile: 'hot',
        } as LaravelPluginConfig),
        resolveJigsawPlugin(pluginConfig),
        ...resolveJigsawWatcherPlugin(pluginConfig),
    ];
}

function resolvePluginConfig(config: PluginConfig): PluginConfig {
    if (config.refresh === true) {
        config.refresh = { files: defaultWatch.files, ignored: defaultWatch.ignored };
    }

    return {
        ...config,
        outDir: config.outDir ?? 'source/assets/build',
    };
}

interface JigsawPlugin extends Plugin {
    config: (config: UserConfig, env: ConfigEnv) => UserConfig;
}

function resolveJigsawPlugin(pluginConfig: PluginConfig): JigsawPlugin {
    let resolvedConfig: ResolvedConfig;
    let userConfig: UserConfig;

    return {
        name: 'jigsaw',
        enforce: 'post',
        config: (config) => {
            userConfig = config;

            return {
                build: {
                    outDir: userConfig.build?.outDir ?? pluginConfig.outDir,
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
                console.log('end?');
                await spawnJigsawBuild();
            } catch (error) {
                console.error('Jigsaw build error:', error);
            }
        },
    };
}

function resolveJigsawWatcherPlugin(pluginConfig: JigsawPluginConfig): JigsawPlugin[] {
    if (typeof pluginConfig.refresh !== 'object') {
        return [];
    }
    const { root = process.cwd(), log = true, always = true, delay = 0 } = {};

    const files = normalizePaths(root, pluginConfig.refresh.files);
    const ignored = normalizePaths(root, pluginConfig.refresh.ignored);
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
                                `${colors.green('full reload')} for ${colors.dim(relative(root, path))} - build: ${Math.round(end - start)} ms`,
                                {
                                    timestamp: true,
                                    clear: true,
                                },
                            );

                            server.ws.send({ type: 'full-reload', path: always ? '*' : path });
                        }, delay);
                    }
                };

                // Ensure Vite keeps track of the files and triggers HMR as needed.
                server.watcher.add(files);

                // Do a full page reload if any of the watched files changes.
                server.watcher.on('add', checkReload);
                server.watcher.on('change', checkReload);
            },

            handleHotUpdate({ file: path, server, modules }) {
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
