// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import Chat from '../apps/Chat';
import { DB } from './db';

/** Single-user only. Reproduce the old React hook-order crash when a character
 * disappears/reappears during DB initialization, import, or role deletion.
 */
const state = vi.hoisted(() => ({ characters: [] as any[], close: vi.fn() }));
vi.mock('../context/OSContext', () => { const context = {
    activeApp: 'chat', activeCharacterId: 'missing',
    theme: {}, userProfile: { name: '测试用户', avatar: '', bio: '' },
    apiConfig: {}, apiPresets: [], availableModels: [], customThemes: [], groups: [], characterGroups: [],
    unreadMessages: {}, realtimeConfig: {}, memoryPalaceConfig: {}, remoteVectorConfig: {},
    proactiveComposingChars: {},
    closeApp: state.close, openApp: vi.fn(), clearUnread: vi.fn(), setActiveCharacterId: vi.fn(),
    addToast: vi.fn(), updateCharacter: vi.fn(), updateUserProfile: vi.fn(),
}; return { useOS: () => ({ ...context, characters: state.characters }) }; });
vi.mock('../hooks/useChatAI', () => ({ useChatAI: () => ({
    isTyping: false, streamingBubbles: [], streamingThinking: '', streamingHandoverIds: [], triggerAI: vi.fn(),
    setLastTokenUsage: vi.fn(), setLastDigestResult: vi.fn(), setMemoryPalaceResult: vi.fn(),
}) }));
vi.mock('./contentFavorites', async importOriginal => ({
    ...await importOriginal<typeof import('./contentFavorites')>(),
    listContentFavorites: vi.fn().mockResolvedValue([]),
}));
vi.mock('../hooks/useStreamingVoice', () => ({ useStreamingVoice: () => ({ state: null, stop: vi.fn() }) }));
vi.mock('../components/chat/MemoryContextSelfCheck', () => ({ default: () => null }));
vi.mock('../components/chat/ChatHeaderShell', () => ({ default: () => React.createElement('header', null, '聊天标题') }));
vi.mock('../components/chat/ChatInputArea', () => ({ default: () => React.createElement('footer', null, '聊天输入') }));
(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { state.characters = []; vi.restoreAllMocks(); vi.clearAllMocks(); });

it('keeps hooks stable when the last character vanishes and later reappears', async () => {
    vi.spyOn(DB, 'initializeEmojiData').mockResolvedValue(undefined);
    vi.spyOn(DB, 'getEmojis').mockResolvedValue([]);
    vi.spyOn(DB, 'getEmojiCategories').mockResolvedValue([]);
    const host = document.createElement('div'), root = createRoot(host);
    try {
        await act(async () => root.render(React.createElement(Chat)));
        expect(host.textContent).toContain('暂时没有可用的角色');
        state.characters = [{ id: 'new', name: '新角色', avatar: '', memories: [], description: '', systemPrompt: '' }];
        await act(async () => root.render(React.createElement(Chat)));
        expect(host.querySelector('.sully-chat-root')).not.toBeNull();
        state.characters = [];
        await act(async () => root.render(React.createElement(Chat)));
        expect(host.textContent).toContain('暂时没有可用的角色');
        await act(async () => Array.from(host.querySelectorAll('button')).find(b => b.textContent === '返回桌面')!.click());
        expect(state.close).toHaveBeenCalledOnce();
    } finally { await act(async () => root.unmount()); }
});
