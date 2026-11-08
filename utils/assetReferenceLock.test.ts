import { describe, it, expect } from 'vitest';
import { withAssetReferenceLock } from './assetReferenceLock';

describe('single-user image reference coordination', () => {
    it('fallback serializes maintenance operations inside the same page', async () => {
        const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
        Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
        try {
            const order: string[] = [];
            let release!: () => void;
            const first = withAssetReferenceLock('exclusive', async () => {
                order.push('first-start');
                await new Promise<void>(resolve => { release = resolve; });
                order.push('first-end');
            });
            const second = withAssetReferenceLock('exclusive', async () => {
                order.push('second-start');
            });
            await Promise.resolve();
            await Promise.resolve();
            expect(order).toEqual(['first-start']);
            release();
            await Promise.all([first, second]);
            expect(order).toEqual(['first-start', 'first-end', 'second-start']);
        } finally {
            if (previous) Object.defineProperty(navigator, 'locks', previous);
            else delete (navigator as any).locks;
        }
    });

    it('uses one stable Web Locks name to coordinate participating tabs', async () => {
        const previous = Object.getOwnPropertyDescriptor(navigator, 'locks');
        const calls: Array<{ name: string; mode: string }> = [];
        Object.defineProperty(navigator, 'locks', {
            configurable: true,
            value: { request: async (name: string, options: { mode: string }, action: () => Promise<unknown>) => {
                calls.push({ name, mode: options.mode });
                return action();
            } },
        });
        try {
            const value = await withAssetReferenceLock('exclusive', async () => 42);
            expect(value).toBe(42);
            expect(calls).toEqual([{ name: 'sully-personal-image-references-v1', mode: 'exclusive' }]);
        } finally {
            if (previous) Object.defineProperty(navigator, 'locks', previous);
            else delete (navigator as any).locks;
        }
    });
});
