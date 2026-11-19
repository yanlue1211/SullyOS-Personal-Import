import React from 'react';
import type { CharacterProfile, NovelNarration, NovelNarrativePerson } from '../../types';

interface Props {
    value: NovelNarration;
    onChange: (value: NovelNarration) => void;
    characters: CharacterProfile[];
}

const personFields = [
    ['person', '正文整体人称'],
    ['userPerson', 'User 在正文中的人称'],
    ['characterPerson', '角色在正文中的人称'],
] as const;

const selectClass = 'block mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700';

export default function NovelNarrationSettings({ value, onChange, characters }: Props) {
    const viewpoint = value.viewpoint;
    const bias = viewpoint?.kind === 'omniscient' ? viewpoint.bias : undefined;
    const characterId = viewpoint?.kind === 'character' ? viewpoint.characterId
        : bias?.kind === 'character' ? bias.characterId : undefined;

    return (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <summary className="cursor-pointer text-sm font-bold text-slate-700">叙述设置</summary>
            <div className="mt-3 space-y-3 text-xs text-slate-600">
                <label className="block">
                    故事主视角
                    <select className={selectClass} value={viewpoint?.kind || ''}
                        onChange={({ target }) => {
                            switch (target.value) {
                                case 'user': onChange({ ...value, viewpoint: { kind: 'user' } }); break;
                                case 'character': onChange({ ...value, viewpoint: { kind: 'character', characterId: characters[0].id } }); break;
                                case 'omniscient': onChange({ ...value, viewpoint: { kind: 'omniscient' } }); break;
                                default: onChange({ ...value, viewpoint: undefined });
                            }
                        }}>
                        <option value="">自动</option>
                        <option value="user">User 视角</option>
                        <option value="character" disabled={!characters.length}>角色视角</option>
                        <option value="omniscient">上帝视角</option>
                    </select>
                </label>
                {viewpoint?.kind === 'omniscient' && (
                    <label className="block">
                        描述偏向
                        <select className={selectClass} value={bias?.kind || ''}
                            onChange={({ target }) => {
                                const nextBias = target.value === 'user' ? { kind: 'user' as const }
                                    : target.value === 'character' ? { kind: 'character' as const, characterId: characters[0].id }
                                    : undefined;
                                onChange({ ...value, viewpoint: { kind: 'omniscient', bias: nextBias } });
                            }}>
                            <option value="">无偏向</option>
                            <option value="user">偏向 User</option>
                            <option value="character" disabled={!characters.length}>偏向角色</option>
                        </select>
                    </label>
                )}
                {characterId !== undefined && (
                    <label className="block">
                        {viewpoint?.kind === 'character' ? '视角角色' : '偏向角色'}
                        <select className={selectClass} value={characterId}
                            onChange={({ target }) => {
                                const focus = { kind: 'character' as const, characterId: target.value };
                                onChange({ ...value, viewpoint: viewpoint?.kind === 'character' ? focus : { kind: 'omniscient', bias: focus } });
                            }}>
                            {!characters.some(character => character.id === characterId) && <option value={characterId} disabled>原角色不可用，请重新选择</option>}
                            {characters.map(character => <option key={character.id} value={character.id}>{character.name}</option>)}
                        </select>
                    </label>
                )}
                {personFields.map(([field, label]) => (
                    <label key={field} className="block">
                        {label}
                        <select className={selectClass} value={value[field] || 'auto'}
                            onChange={({ target }) => onChange({ ...value, [field]: target.value as NovelNarrativePerson })}>
                            <option value="auto">自动</option>
                            <option value="first">第一人称</option>
                            <option value="second">第二人称</option>
                            <option value="third">第三人称</option>
                        </select>
                    </label>
                ))}
            </div>
        </details>
    );
}
