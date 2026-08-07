import { relative } from 'path';
import colors from 'picocolors';
import picomatch from 'picomatch';
import type { Plugin } from 'vite';
import type { ResolvedJigsawPluginConfig, ResolvedRefreshConfig } from './config.js';
import { spawnJigsawBuild } from './jigsaw-cli.js';
import { Queue, normalizePaths } from './utils.js';

/**
 * Shared queue so that file change bursts don't kick off a stampede of
 * concurrent `jigsaw build` processes.
 */
const BuildQueue = new Queue();

export function createWatcherPlugin(pluginConfig: ResolvedJigsawPluginConfig): Plugin[] {
    if (pluginConfig.refresh === false) {
        return [];
    }

    const refresh: ResolvedRefreshConfig = pluginConfig.refresh;
    const files = normalizePaths(refresh.root, refresh.files);
    const ignored = normalizePaths(refresh.root, refresh.ignored);
    const shouldReload = picomatch(files);

    return [
        {
            name: 'jigsaw:watcher',
            apply: 'serve',

            config: () => ({
                server: {
                    watch: { disableGlobbing: false, ignored },
                },
            }),

            configureServer(server) {
                // Make sure chokidar keeps an eye on our patterns even though they
                // aren't in Vite's module graph.
                server.watcher.add(files);

                // Set during teardown so in-flight change events become no-ops.
                let closing = false;

                const checkReload = async (path: string) => {
                    if (closing || !shouldReload(path)) return;

                    const start = performance.now();

                    try {
                        await BuildQueue.enqueue(() => spawnJigsawBuild());
                    } catch (error) {
                        // Build failure is already reported by spawnJigsawBuild; avoid
                        // spamming the logger and fall through so the user can save again.
                        return;
                    }

                    if (closing) return;

                    const elapsed = Math.round(performance.now() - start);

                    setTimeout(() => {
                        if (closing) return;
                        server.config.logger.info(
                            `${colors.green('full reload')} for ${colors.dim(
                                relative(refresh.root, path),
                            )} - build: ${elapsed} ms`,
                            { timestamp: true, clear: true },
                        );

                        server.ws.send({ type: 'full-reload', path: refresh.always ? '*' : path });
                    }, refresh.delay);
                };

                server.watcher.on('add', checkReload);
                server.watcher.on('change', checkReload);

                server.httpServer?.once('close', () => {
                    closing = true;
                    server.watcher.off('add', checkReload);
                    server.watcher.off('change', checkReload);
                });
            },

            handleHotUpdate({ file, modules }) {
                // We're going to do a full reload ourselves, so there's no reason to
                // let Vite replay module updates for these files.
                return shouldReload(file) ? [] : modules;
            },
        },
    ];
}
