import { describe, expect, beforeEach, test } from 'vitest';
import { normalizePaths, Queue } from '../src';

const root = '/root';
const expectNormalized = (path: any) => expect(normalizePaths(root, path));

describe('normalizePaths', () => {
    test('it handles strings and arrays', () => {
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

    test('should process empty queue correctly', () => {
        expect(queue.dequeue()).toBe(false);
    });

    test('should process promises in sequence', async () => {
        const order: number[] = [];
        const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

        const promise1 = () => delay(300).then(() => order.push(1)) as Promise<void>;
        const promise2 = () => delay(200).then(() => order.push(2)) as Promise<void>;
        const promise3 = () => delay(100).then(() => order.push(3)) as Promise<void>;

        await Promise.all([queue.enqueue(promise1), queue.enqueue(promise2), queue.enqueue(promise3)]);

        expect(order).toEqual([1, 2, 3]);
    });

    test('should handle errors without breaking the queue', async () => {
        const results: (string | Error)[] = [];

        const successPromise = () => Promise.resolve().then(() => results.push('one')) as Promise<void>;
        const errorPromise = () => Promise.reject(new Error('fails at two'));
        const anotherSuccess = () => Promise.resolve().then(() => results.push('three')) as Promise<void>;

        await queue.enqueue(successPromise).catch(() => {});
        await queue.enqueue(errorPromise).catch((e) => results.push(e));
        await queue.enqueue(anotherSuccess).catch(() => {});

        expect(results).toHaveLength(3);
        expect(results[0]).toBe('one');
        expect(results[1]).toBeInstanceOf(Error);
        expect(results[2]).toBe('three');
    });
});
