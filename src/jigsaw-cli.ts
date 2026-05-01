import { spawn } from 'child_process';
import { existsSync, unlinkSync } from 'fs';
import { resolve } from 'path';
import { hasBin } from './utils.js';

export function jigsawBinPath(): string {
    const vendorBin = resolve('./vendor/bin/jigsaw');

    if (existsSync(vendorBin)) {
        return vendorBin;
    }

    if (hasBin('jigsaw')) {
        // `spawn` resolves bare command names against PATH for us.
        return 'jigsaw';
    }

    console.error('Could not find Jigsaw; please install it via Composer.');
    process.exit(1);
}

export function spawnJigsawBuild(hotFile: string | null = null, quiet = true): Promise<void> {
    return new Promise<void>((resolvePromise, rejectPromise) => {
        const bin = jigsawBinPath();
        const env = process.env.NODE_ENV === 'development' ? 'local' : process.env.NODE_ENV;

        if (hotFile && existsSync(hotFile)) {
            try {
                unlinkSync(hotFile);
            } catch (error) {
                console.warn(`Could not remove hot file at ${hotFile}:`, error);
            }
        }

        const args = ['build'];
        if (env) args.push(env);

        const child = quiet
            ? spawn(bin, args, { stdio: ['inherit', 'pipe', 'pipe'] })
            : spawn(bin, args, { stdio: 'inherit' });

        let captured = '';
        if (quiet) {
            const append = (chunk: Buffer) => {
                captured += chunk.toString('utf-8');
            };
            child.stdout?.on('data', append);
            child.stderr?.on('data', append);
        }

        child.on('error', (error) => {
            rejectPromise(error);
        });

        child.on('exit', (code) => {
            if (Number(code) > 0) {
                if (quiet && captured.length > 0) {
                    process.stderr.write(captured);
                }
                console.warn(`\nJigsaw build failed with exit code ${code}.`);
                rejectPromise(new Error(`Jigsaw build exited with code ${code}`));
            } else {
                resolvePromise();
            }
        });
    });
}
