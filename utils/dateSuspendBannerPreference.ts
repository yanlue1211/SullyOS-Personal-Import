// 见面暂离横条的独立本机显示偏好。与见面会话、见面锁、主动消息、记忆无关。
// 默认不显示，避免切到聊天等其他 App 时横条挡住操作；用户可以在见面设置中开启。
const STORAGE_KEY = 'sully-date-suspend-banner-visible-v1';
const CHANGE_EVENT = 'sully-date-suspend-banner-visibility-change';

export const getDateSuspendBannerVisible = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        return window.localStorage.getItem(STORAGE_KEY) === 'true';
    } catch {
        return false;
    }
};

export const subscribeDateSuspendBannerVisibility = (onChange: () => void): (() => void) => {
    if (typeof window === 'undefined') return () => {};
    const handleStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === null) onChange();
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', handleStorage);
    return () => {
        window.removeEventListener(CHANGE_EVENT, onChange);
        window.removeEventListener('storage', handleStorage);
    };
};

export const setDateSuspendBannerVisible = (visible: boolean): void => {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, visible ? 'true' : 'false');
    } catch {
        // 存储不可用时保持默认隐藏，不影响进行中的见面。
    }
    window.dispatchEvent(new Event(CHANGE_EVENT));
};
