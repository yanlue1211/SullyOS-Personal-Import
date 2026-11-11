/**
 * Bounded, reference-safe bulk reclamation for voice recordings.
 *
 * deleteBlobRef() deliberately scans every reference store before EACH deletion.
 * That is safe for interactive single-item changes but becomes quadratic for
 * hundreds of recordings. Here we scan ONCE inside the same exclusive asset
 * reference lock, and never delete anything if the scan is incomplete.
 */
import { DB } from './db';
import { BLOBREF_PREFIX, isBlobRef } from './blobRef';
import { blobStore } from './blobStore';
import { REF_SOURCE_STORES } from './blobGc';
import { WORKROOM_STORES } from '../features/workroom/schema';
import { withAssetReferenceLock } from './assetReferenceLock';

const REF_TOKEN = /blobref:[A-Za-z0-9_-]+/g;
const PAGE_SIZE = 200;

/** Returns only refs that were actually deleted. Scan/lock failures retain all files. */
export async function reclaimUnreferencedVoiceBlobs(
    refs: Iterable<string>,
    onProgress?: (label: string) => void,
): Promise<Set<string>> {
    const candidates = new Set(Array.from(refs).filter(isBlobRef));
    const deleted = new Set<string>();
    if (candidates.size === 0) return deleted;

    try {
        await withAssetReferenceLock('exclusive', async () => {
            const referenced = new Set<string>();
            const inspect = (value: string) => {
                if (!value.includes(BLOBREF_PREFIX)) return;
                for (const token of value.matchAll(REF_TOKEN)) {
                    if (candidates.has(token[0])) referenced.add(token[0]);
                }
            };

            // Include the same shared-reference surfaces as image GC, plus workroom
            // sources. No deletion happens until every source has been scanned.
            const stores = Array.from(new Set<string>([...REF_SOURCE_STORES, ...WORKROOM_STORES]));
            for (let i = 0; i < stores.length; i++) {
                const store = stores[i];
                let after: IDBValidKey | null = null;
                onProgress?.(`正在核对共享引用（${i + 1}/${stores.length}）`);
                for (;;) {
                    const page = await DB.getStoreRowsPage(store, after, PAGE_SIZE);
                    for (const row of page.rows) inspect(JSON.stringify(row) || '');
                    if (page.lastKey === null || page.rows.length < PAGE_SIZE) break;
                    after = page.lastKey;
                }
            }

            // Snapshot localStorage synchronously, with no await between keys.
            if (typeof localStorage !== 'undefined') {
                for (let i = 0; i < localStorage.length; i++) {
                    const key = localStorage.key(i);
                    if (key !== null) inspect(localStorage.getItem(key) || '');
                }
            }

            const unreferenced = Array.from(candidates).filter(ref => !referenced.has(ref));
            for (let i = 0; i < unreferenced.length; i++) {
                const ref = unreferenced[i];
                try {
                    await blobStore.delete(ref);
                    deleted.add(ref);
                } catch {
                    // A failed deletion is retained and can be safely retried.
                }
                if (i % 10 === 0 || i === unreferenced.length - 1) {
                    onProgress?.(`正在释放未引用录音（${i + 1}/${unreferenced.length}）`);
                }
            }
        });
    } catch {
        // Reference scan or lock failed: fail closed. This operation never falls
        // back to an unguarded delete, even if that means leaving orphaned audio.
    }
    return deleted;
}
