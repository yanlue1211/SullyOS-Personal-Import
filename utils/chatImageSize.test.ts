// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHAT_IMAGE_MAX_BYTES, processChatImage } from './file';
afterEach(() => vi.restoreAllMocks());
describe('chat image size budget', () => {
    it('preserves small originals including resolution, transparency and animation', async () => {
        for (const type of ['image/png', 'image/jpeg', 'image/gif']) {
            const file = new File(['original'], 'image', { type });
            expect(await processChatImage(file)).toBe(file);
        }
    });
    it('stops at the first full-resolution encode under budget', async () => {
        const revoke = vi.fn();
        vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
        vi.stubGlobal('Image', class { width = 4000; height = 3000; onload?: () => void; set src(_: string) { this.onload?.(); } });
        const draw = vi.fn();
        vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ fillRect: vi.fn(), drawImage: draw } as any);
        let calls = 0;
        vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function(callback) {
            calls++;
            expect(this.width).toBe(4000); expect(this.height).toBe(3000);
            callback(new Blob([new Uint8Array(calls === 1 ? CHAT_IMAGE_MAX_BYTES + 1 : 1000)]));
        });
        expect((await processChatImage(new File([new Uint8Array(CHAT_IMAGE_MAX_BYTES)], 'big.jpg', { type: 'image/jpeg' }))).size).toBe(1000);
        expect(calls).toBe(2); expect(revoke).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
    it('asks for manual compression rather than flattening a large GIF', async () => {
        await expect(processChatImage(new File([new Uint8Array(CHAT_IMAGE_MAX_BYTES)], 'big.gif', { type: 'image/gif' }))).rejects.toThrow('手动压缩');
    });
});
