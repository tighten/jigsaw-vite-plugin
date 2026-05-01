/** Adapted from laravel/vite-plugin */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs';
import type { AddressInfo } from 'net';
import { dirname as pathDirname, join } from 'path';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Connect, ResolvedConfig, UserConfig } from 'vite';
import { dirname } from './utils.js';

export type DevServerUrl = `${'http' | 'https'}://${string}:${number}`;

// Rewritten to the real dev server URL at serve time, once the port is known.
export const DEV_URL_PLACEHOLDER = '__jigsaw_vite_placeholder__';

let exitHandlersBound = false;

export function bindHotFileExitHandlers(hotFile: string): void {
    if (exitHandlersBound) return;

    const clean = () => {
        if (existsSync(hotFile)) {
            try {
                rmSync(hotFile);
            } catch {
                // ignore - best-effort cleanup
            }
        }
    };

    process.on('exit', clean);
    process.on('SIGINT', () => process.exit());
    process.on('SIGTERM', () => process.exit());
    process.on('SIGHUP', () => process.exit());

    exitHandlersBound = true;
}

// Jigsaw's `vite()` Blade helper reads the hot file to decide whether to load
// assets from the dev server or from the production manifest.
export function writeHotFile(hotFile: string, contents: string): void {
    const parent = pathDirname(hotFile);
    if (!existsSync(parent)) {
        mkdirSync(parent, { recursive: true });
    }
    writeFileSync(hotFile, contents);
}

export function defaultCorsOrigin(env: Record<string, string>): (string | RegExp)[] {
    return [
        /^https?:\/\/(?:(?:[^:]+\.)?localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/,
        ...(env.APP_URL ? [env.APP_URL] : []),
        /^https?:\/\/.*\.test(:\d+)?$/,
    ];
}

export function resolveDevServerUrl(
    address: AddressInfo,
    config: ResolvedConfig,
    userConfig: UserConfig,
): DevServerUrl {
    const hmrProtocol = typeof config.server.hmr === 'object' ? config.server.hmr.protocol : null;
    const clientProtocol = hmrProtocol ? (hmrProtocol === 'wss' ? 'https' : 'http') : null;
    const serverProtocol = config.server.https ? 'https' : 'http';
    const protocol = clientProtocol ?? serverProtocol;

    const hmrHost = typeof config.server.hmr === 'object' ? config.server.hmr.host : null;
    const configHost = typeof config.server.host === 'string' ? config.server.host : null;
    const serverAddress = isIpv6(address) ? `[${address.address}]` : address.address;
    const host = hmrHost ?? configHost ?? serverAddress;

    const hmrClientPort = typeof config.server.hmr === 'object' ? config.server.hmr.clientPort : null;
    const port = hmrClientPort ?? address.port;

    return `${protocol}://${host}:${port}`;
}

function isIpv6(address: AddressInfo): boolean {
    return (
        address.family === 'IPv6' ||
        // In node >=18.0 <18.4 `family` was an integer. See laravel/vite-plugin#103.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (address as any).family === 6
    );
}

// Serves the Jigsaw-branded dev index when a user hits the Vite server
// directly instead of going through Jigsaw's built output.
export function createDevIndexMiddleware(appUrl: string): Connect.NextHandleFunction {
    const template = readFileSync(join(dirname(), 'dev-server-index.html'), 'utf-8');
    const html = template.replace(/{{ APP_URL }}/g, appUrl);

    return (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
        if (req.url === '/index.html') {
            res.statusCode = 404;
            res.end(html);
            return;
        }
        next();
    };
}
