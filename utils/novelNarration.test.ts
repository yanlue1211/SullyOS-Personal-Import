import { describe, expect, it } from 'vitest';
import type { CharacterProfile, NovelBook, UserProfile } from '../types';
import { buildNovelChapterContext, buildNovelNarrationRules, buildPrompt, NOVEL_WRITING_STYLES } from './novelUtils';

const author = { id: 'author', name: '执笔者', description: '' } as CharacterProfile;
const observer = { id: 'observer', name: '视角角色', description: '' } as CharacterProfile;
const characters = [author, observer];
const user = { name: '读者' } as UserProfile;

describe('novel narration', () => {
    it('keeps narrator focus independent of grammatical person and writer identity', () => {
        const rules = buildNovelNarrationRules({
            viewpoint: { kind: 'character', characterId: observer.id },
            person: 'third',
            userPerson: 'second',
            characterPerson: 'first',
        }, user.name, characters);
        expect(rules).toContain('主视角跟随「视角角色」');
        expect(rules).toContain('正文默认用第三人称');
        expect(rules).toContain('对应人物时使用第二人称');
        expect(rules).toContain('对应人物时使用第一人称');
        expect(rules).not.toContain(author.name);
    });

    it('preserves full narrative access when omniscient narration favors a character', () => {
        const rules = buildNovelNarrationRules({
            viewpoint: { kind: 'omniscient', bias: { kind: 'character', characterId: observer.id } },
        }, user.name, characters);
        expect(rules).toContain('描述偏向「视角角色」');
        expect(rules).toContain('焦点人物未知的信息');
        expect(buildNovelNarrationRules({ viewpoint: { kind: 'omniscient' } }, user.name, characters)).toContain('无固定描述偏向');
    });

    it('only applies narration rules to writing and preserves legacy defaults', () => {
        const book = { title: '测试作品', protagonists: [], narration: { viewpoint: { kind: 'user' } } } as NovelBook;
        const discuss = buildPrompt(author, user, book, '', '', { write: false, comment: true, analyze: false }, [], characters);
        expect(discuss).not.toContain('故事主视角');
        expect(discuss).not.toContain('"writer":');
        expect(buildNovelNarrationRules(undefined, user.name, characters)).toBe('');
    });

    it('uses custom style with additional instructions and limits the opening scene to the start', () => {
        expect(Object.keys(NOVEL_WRITING_STYLES)).toHaveLength(7);
        const book = {
            title: '测试作品', protagonists: [],
            creativeSettings: { style: 'custom', customStyle: 'CUSTOM_STYLE', extraStyle: 'EXTRA_STYLE', openingScene: 'OPENING_SCENE' },
        } as NovelBook;
        const generate = (segments: NovelBook['segments']) => buildPrompt(author, user, book, '', '', { write: true, comment: false, analyze: false }, segments, characters);
        const opening = generate([]);
        expect(opening).toContain('CUSTOM_STYLE');
        expect(opening).toContain('EXTRA_STYLE');
        expect(opening).toContain('OPENING_SCENE');
        expect(opening).toContain('Anti-Cliché Protocol');
        expect(generate([{ id: 'draft', type: 'story', authorId: 'user', content: '第一幕', timestamp: 1 }])).not.toContain('OPENING_SCENE');
    });
});

describe('novel chapter context', () => {
    it('uses the previous chapter original and older summaries until the user overrides them', () => {
        const segments: NovelBook['segments'] = [
            { id: 'one', authorId: 'user', content: 'ORIGINAL1', timestamp: 0, type: 'story' },
            { id: 'recap1', authorId: 'system', content: 'RECAP1', timestamp: 1, type: 'analysis', focus: 'chapter_summary' },
            { id: 'two', authorId: 'user', content: 'ORIGINAL2', timestamp: 2, type: 'story' },
            { id: 'recap2', authorId: 'system', content: 'RECAP2', timestamp: 3, type: 'analysis', focus: 'chapter_summary' },
            { id: 'current', authorId: 'user', content: 'CURRENT', timestamp: 4, type: 'story' },
            { id: 'discussion', authorId: 'user', content: 'DISCUSSION', timestamp: 5, type: 'discussion' },
        ];
        expect(buildNovelChapterContext(segments, undefined)).toMatch(/RECAP1[\s\S]+ORIGINAL2[\s\S]+CURRENT/);
        expect(buildNovelChapterContext(segments, { recap1: 'original', recap2: 'summary' })).toMatch(/ORIGINAL1[\s\S]+RECAP2[\s\S]+CURRENT/);
        expect(buildNovelChapterContext(segments, undefined)).not.toContain('DISCUSSION');
    });
});

describe('novel creator modes', () => {
    it('supports character-free AI writing and independent authorship', () => {
        const book = { title: '测试作品', protagonists: [], creativeIdentity: 'independent' } as NovelBook;
        const options = { write: false, comment: true, analyze: true };
        const solo = buildPrompt(author, user, book, '', '', options, [], characters);
        expect(solo).toContain('幕后编辑指令');
        expect(solo).not.toContain('可以直接对用户说');
        expect(solo).not.toContain('"writer":');
        const ai = buildPrompt(undefined, user, book, '', '', options, [], characters);
        expect(ai).toContain('普通小说作者');
        expect(ai).not.toContain('你的写作人格');
    });
});
