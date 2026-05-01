import type { AddressInfo } from 'net';
import colors from 'picocolors';
import { ConfigEnv, loadEnv, Plugin, ResolvedConfig, UserConfig } from 'vite';
import type { ResolvedJigsawPluginConfig } from './config.js';

export interface JigsawPlugin extends Plugin {
    config: (config: UserConfig, env: ConfigEnv) => UserConfig;
}
import {
    DEV_URL_PLACEHOLDER,
    DevServerUrl,
    bindHotFileExitHandlers,
    createDevIndexMiddleware,
    defaultCorsOrigin,
    resolveDevServerUrl,
    writeHotFile,
} from './dev-server.js';
import { spawnJigsawBuild } from './jigsaw-cli.js';
import { isHerdKey, isValetKey, resolveDevelopmentEnvironmentServerConfig } from './tls.js';
import { jigsawVersion, pluginVersion } from './utils.js';

const PLACEHOLDER_ORIGIN_REGEXP = new RegExp(`http://${DEV_URL_PLACEHOLDER}\\.test`, 'g');

export function resolveJigsawPlugin(pluginConfig: ResolvedJigsawPluginConfig): JigsawPlugin {
    let devServerUrl: DevServerUrl;
    let resolvedConfig: ResolvedConfig;
    let userConfig: UserConfig;

    return {
        name: 'jigsaw',
        enforce: 'post',

        config(config, { command, mode }) {
            userConfig = config;

            const env = loadEnv(mode, userConfig.envDir || process.cwd(), '');

            const tlsServerConfig = command === 'serve' ? resolveDevelopmentEnvironmentServerConfig(pluginConfig.detectTls) : undefined;

            // Point Vite at Jigsaw's `build_${env}` output so asset lookups resolve during dev.
            let publicDir: string | false = false;
            if (command === 'serve') {
                const suffix = process.env.NODE_ENV === 'development' ? 'local' : process.env.NODE_ENV;
                publicDir = suffix ? `build_${suffix}` : false;
            }

            return {
                base: userConfig.base ?? '',
                publicDir: userConfig.publicDir ?? publicDir,
                build: {
                    manifest: userConfig.build?.manifest ?? 'manifest.json',
                    outDir: userConfig.build?.outDir ?? pluginConfig.outDir,
                    assetsInlineLimit: userConfig.build?.assetsInlineLimit ?? 0,
                    rollupOptions: {
                        input: userConfig.build?.rollupOptions?.input ?? pluginConfig.input,
                    },
                },
                server: {
                    origin: userConfig.server?.origin ?? `http://${DEV_URL_PLACEHOLDER}.test`,
                    cors: userConfig.server?.cors ?? {
                        origin: userConfig.server?.origin ?? defaultCorsOrigin(env),
                    },
                    ...(tlsServerConfig
                        ? {
                              host: userConfig.server?.host ?? tlsServerConfig.host,
                              hmr:
                                  userConfig.server?.hmr === false
                                      ? false
                                      : {
                                            ...tlsServerConfig.hmr,
                                            ...(userConfig.server?.hmr === true ? {} : userConfig.server?.hmr),
                                        },
                              https: userConfig.server?.https ?? tlsServerConfig.https,
                          }
                        : undefined),
                },
            };
        },

        configResolved(config) {
            resolvedConfig = config;
        },

        transform(code) {
            if (resolvedConfig.command !== 'serve') return;

            const rewritten = code.replace(PLACEHOLDER_ORIGIN_REGEXP, devServerUrl);
            return pluginConfig.transformOnServe(rewritten, devServerUrl);
        },

        configureServer(server) {
            const envDir = resolvedConfig.envDir || process.cwd();
            const appUrl = loadEnv(resolvedConfig.mode, envDir, 'APP_URL').APP_URL ?? 'undefined';

            server.httpServer?.once('listening', () => {
                const address = server.httpServer?.address();
                if (typeof address !== 'object' || address === null) return;

                devServerUrl =
                    (userConfig.server?.origin as DevServerUrl | undefined) ??
                    resolveDevServerUrl(address as AddressInfo, server.config, userConfig);

                // Hot file must be written before the build
                writeHotFile(pluginConfig.hotFile, `${devServerUrl}${server.config.base.replace(/\/$/, '')}`);

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
                    server.config.logger.info('');
                    server.config.logger.info(
                        `  ${colors.green('➜')}  ${colors.bold('APP_URL')}: ${colors.cyan(
                            appUrl.replace(/:(\d+)/, (_, port) => `:${colors.bold(port)}`),
                        )}`,
                    );

                    const https = resolvedConfig.server.https;
                    if (typeof https === 'object' && typeof https.key === 'string') {
                        if (isHerdKey(https.key)) {
                            server.config.logger.info(`  ${colors.green('➜')}  Using Herd certificate to secure Vite.`);
                        } else if (isValetKey(https.key)) {
                            server.config.logger.info(`  ${colors.green('➜')}  Using Valet certificate to secure Vite.`);
                        }
                    }
                }, 100);
            });

            bindHotFileExitHandlers(pluginConfig.hotFile);

            return () => {
                server.middlewares.use(createDevIndexMiddleware(appUrl));
            };
        },

        async writeBundle() {
            try {
                await spawnJigsawBuild(pluginConfig.hotFile, false);
            } catch (error) {
                console.error('Jigsaw build error:', error);
            }
        },
    };
}
