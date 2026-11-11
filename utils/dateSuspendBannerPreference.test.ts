import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getDateSuspendBannerVisible,
    setDateSuspendBannerVisible,
    subscribeDateSuspendBannerVisibility,
} from './dateSuspendBannerPreference';

describe('date suspended banner preference', () => {
    const store = new Map<string, string>();

    beforeEach(() => {
        store.clear();
        const mockWindow = Object.assign(new EventTarget(), {
            localStorage: {
                getItem: (key: string) => store.get(key) ?? null,
                setItem: (key: string, value: string) => { store.set(key, value); },
            },
        });
        vi.stubGlobal('window', mockWindow);
    });

    afterEach(() => vi.unstubAllGlobals());

    it('defaults to hidden without touching meeting state', () => {
        expect(getDateSuspendBannerVisible()).toBe(false);
        expect(store.size).toBe(0);
    });

    it('toggles the visibility and notifies mounted listeners immediately', () => {
        const notify = vi.fn();
        const unsubscribe = subscribeDateSuspendBannerVisibility(notify);
        setDateSuspendBannerVisible(true);
        expect(getDateSuspendBannerVisible()).toBe(true);
        expect(notify).toHaveBeenCalledTimes(1);
        setDateSuspendBannerVisible(false);
        expect(getDateSuspendBannerVisible()).toBe(false);
        expect(notify).toHaveBeenCalledTimes(2);
        unsubscribe();
        setDateSuspendBannerVisible(true);
        expect(notify).toHaveBeenCalledTimes(2);
        expect([...store.keys()]).toEqual(['sully-date-suspend-banner-visible-v1']);
    });
});
