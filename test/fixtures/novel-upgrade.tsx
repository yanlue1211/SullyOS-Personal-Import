import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import NovelWriter from '../../components/novel/NovelWriter';
import { OSPreviewProvider } from '../../context/OSContext';
import type { CharacterProfile, NovelBook, UserProfile } from '../../types';

const user = { name: '测试用户' } as UserProfile;
const author = {
    id: 'author', name: '测试作者', avatar: '', description: '', systemPrompt: '作者核心',
    mountedWorldbooks: [
        { id: 'enabled', title: '已选', constant: true, position: 1, content: 'WORLD_ENABLED' },
        { id: 'disabled', title: '未选', constant: true, position: 1, content: 'WORLD_DISABLED' },
    ],
} as CharacterProfile;
const reader = { id: 'reader', name: '视角人物', avatar: '', description: '' } as CharacterProfile;
const characters = [author, reader];
const characterMode = new URLSearchParams(location.search).has('chapters');
const initial: NovelBook = {
    id: 'novel-test', title: '测试手稿', summary: '', coverStyle: 'parchment', worldSetting: '',
    protagonists: [], collaboratorIds: characterMode ? [author.id, reader.id] : [], segments: [],
    writingMode: characterMode ? 'chapters' : 'single', creativeIdentity: characterMode ? 'independent' : 'ai',
    narration: { viewpoint: { kind: 'omniscient', bias: { kind: 'character', characterId: reader.id } }, person: 'third' },
    sourceSettings: { worldbookIds: ['enabled'] }, targetWords: 20000,
    createdAt: 1, lastActiveAt: 1,
};

function App() {
    const [book, setBook] = useState(initial);
    const [target, setTarget] = useState(characterMode ? author.id : '');
    const apiConfig = { baseUrl: `${location.origin}/novel-test-main/v1`, apiKey: 'mock', model: 'mock-main', stream: true };
    const value = {
        addToast: (message: string) => console.info(message), characterGroups: [],
        memoryPalaceConfig: { lightLLM: { baseUrl: `${location.origin}/novel-test-summary/v1`, apiKey: 'mock', model: 'mock-summary' } },
    } as unknown as React.ComponentProps<typeof OSPreviewProvider>['value'];

    return <OSPreviewProvider value={value}>
        <NovelWriter activeBook={book} characters={characters} userProfile={user} apiConfig={apiConfig}
            onBack={() => {}} updateCharacter={() => {}} collaborators={characterMode ? characters : []}
            targetCharId={target} setTargetCharId={setTarget} onOpenSettings={() => {}}
            updateNovel={async (_, patch) => setBook(current => ({ ...current, ...patch }))} />
    </OSPreviewProvider>;
}

createRoot(document.getElementById('root')!).render(<App />);
