/** Adapted from laravel/vite-plugin */
import { existsSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { basename, resolve } from 'path';

export type DetectTlsOption = string | boolean | null;

export interface TlsServerConfig {
    hmr: { host: string };
    host: string;
    https: { key: string; cert: string };
}

/**
 * Resolve the Herd or Valet server config for the given host.
 */
export function resolveDevelopmentEnvironmentServerConfig(host: DetectTlsOption): TlsServerConfig | undefined {
    if (host === false) return undefined;

    const configPath = determineDevelopmentEnvironmentConfigPath();

    if (typeof configPath === 'undefined' && host === null) {
        return undefined;
    }

    if (typeof configPath === 'undefined') {
        throw new Error(
            'Unable to find the Herd or Valet configuration directory. Please check they are correctly installed.',
        );
    }

    const resolvedHost = host === true || host === null
        ? `${basename(process.cwd())}.${resolveDevelopmentEnvironmentTld(configPath)}`
        : host;

    const keyPath = resolve(configPath, 'Certificates', `${resolvedHost}.key`);
    const certPath = resolve(configPath, 'Certificates', `${resolvedHost}.crt`);

    if (!existsSync(keyPath) || !existsSync(certPath)) {
        if (host === null) {
            return undefined;
        }

        if (configPath === herdMacConfigPath() || configPath === herdWindowsConfigPath()) {
            throw new Error(
                `Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site via the Herd UI.`,
            );
        }

        if (typeof host === 'string') {
            throw new Error(
                `Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site by running \`valet secure ${host}\`.`,
            );
        }

        throw new Error(
            `Unable to find certificate files for your host [${resolvedHost}] in the [${configPath}/Certificates] directory. Ensure you have secured the site by running \`valet secure\`.`,
        );
    }

    return {
        hmr: { host: resolvedHost },
        host: resolvedHost,
        https: { key: keyPath, cert: certPath },
    };
}

export function isHerdKey(key: string): boolean {
    return key.startsWith(herdMacConfigPath()) || key.startsWith(herdWindowsConfigPath());
}

export function isValetKey(key: string): boolean {
    return key.startsWith(valetMacConfigPath()) || key.startsWith(valetLinuxConfigPath());
}

function determineDevelopmentEnvironmentConfigPath(): string | undefined {
    return [herdMacConfigPath(), herdWindowsConfigPath(), valetMacConfigPath(), valetLinuxConfigPath()].find(existsSync);
}

function resolveDevelopmentEnvironmentTld(configPath: string): string {
    const configFile = resolve(configPath, 'config.json');
    if (!existsSync(configFile)) {
        throw new Error(`Unable to find the configuration file [${configFile}].`);
    }

    const config: { tld: string } = JSON.parse(readFileSync(configFile, 'utf-8'));
    return config.tld;
}

function herdMacConfigPath(): string {
    return resolve(homedir(), 'Library', 'Application Support', 'Herd', 'config', 'valet');
}

function herdWindowsConfigPath(): string {
    return resolve(homedir(), '.config', 'herd', 'config', 'valet');
}

function valetMacConfigPath(): string {
    return resolve(homedir(), '.config', 'valet');
}

function valetLinuxConfigPath(): string {
    return resolve(homedir(), '.valet');
}
