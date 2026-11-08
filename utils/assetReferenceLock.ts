/**
 * Protects the single-user image-reference maintenance paths against each other.
 *
 * Browser Web Locks synchronize participating tabs; fallback serializes one page
 * when Web Locks are unavailable (it must NOT be described as cross-tab safety).
 * No extra database, cross-user pool, timer or new persistent reference index.
 *
 * Keep calls short except explicit user-initiated maintenance. Do not acquire
 * another asset lock from inside a lock callback: Web Locks are not reentrant.
 */
const LOCK_NAME = 'sully-personal-image-references-v1';
let fallbackTail: Promise<unknown> = Promise.resolve();

export const withAssetReferenceLock = async <T>(
    mode: 'shared' | 'exclusive',
    action: () => Promise<T>,
): Promise<T> => {
    if (typeof navigator !== 'undefined' && navigator.locks?.request) {
        return navigator.locks.request(LOCK_NAME, { mode }, action);
    }
    // Fallback is intentionally exclusive for both modes, and process-local.
    const run = fallbackTail.then(action, action);
    fallbackTail = run.then(() => undefined, () => undefined);
    return run;
};
