import type { Plugin } from 'vite';
import { JigsawPluginConfig, resolvePluginConfig } from './config.js';
import { JigsawPlugin, resolveJigsawPlugin } from './plugin.js';
import { createWatcherPlugin } from './watcher.js';

export type { JigsawPluginConfig, RefreshConfig, ResolvedJigsawPluginConfig, ResolvedRefreshConfig } from './config.js';
export type { DevServerUrl } from './dev-server.js';
export type { DetectTlsOption } from './tls.js';
export type { JigsawPlugin } from './plugin.js';

/**
 * Jigsaw Vite plugin.
 *
 * @example
 * ```js
 * import { defineConfig } from 'vite';
 * import jigsaw from '@tighten/jigsaw-vite-plugin';
 *
 * export default defineConfig({
 *     plugins: [
 *         jigsaw({
 *             input: ['source/_assets/js/main.js', 'source/_assets/css/main.css'],
 *             refresh: true,
 *         }),
 *     ],
 * });
 * ```
 */
export default function jigsaw(config: JigsawPluginConfig): [JigsawPlugin, ...Plugin[]] {
    const resolved = resolvePluginConfig(config);

    return [resolveJigsawPlugin(resolved), ...createWatcherPlugin(resolved)];
}
