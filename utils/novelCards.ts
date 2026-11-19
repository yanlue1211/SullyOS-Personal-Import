import type { CharacterProfile, NovelBook, NovelSegment } from '../types';

export interface NovelCardAuthor {
    id: string;
    name: string;
    collaboratedWithUser: boolean;
}

export interface NovelCardData {
    kind: 'start' | 'chapter' | 'complete' | 'share';
    bookTitle: string;
    subtitle?: string;
    bookSummary: string;
    coverImage?: string;
    userName: string;
    userAuthored: boolean;
    authors: NovelCardAuthor[];
    scope?: 'work' | 'chapters';
    completed?: boolean;
    chapters?: Array<{ index: number; original?: string; summary?: string }>;
    summary?: string;
}

export function getNovelAuthors(segments: NovelSegment[], characters: CharacterProfile[]): NovelCardAuthor[] {
    const authors = new Map<string, NovelCardAuthor>();
    for (const segment of segments) {
        if (segment.focus === 'chapter_summary') continue;
        const character = characters.find(candidate => candidate.id === segment.authorId);
        if (!character) continue;
        authors.set(character.id, {
            id: character.id, name: character.name,
            collaboratedWithUser: authors.get(character.id)?.collaboratedWithUser === true
                || segment.creativeIdentity !== 'independent',
        });
    }
    return [...authors.values()];
}

export function buildNovelCard(
    kind: NovelCardData['kind'], book: NovelBook, userName: string, segments: NovelSegment[], characters: CharacterProfile[],
): NovelCardData {
    const authors = getNovelAuthors(segments, characters);
    return {
        kind,
        bookTitle: book.title,
        subtitle: book.subtitle,
        bookSummary: book.summary,
        coverImage: kind === 'share' ? book.coverImage : undefined,
        userName,
        userAuthored: authors.some(author => author.collaboratedWithUser)
            || segments.some(segment => segment.authorId === 'user' && segment.type === 'story'),
        authors,
        completed: kind === 'complete' || !!book.completion?.completedAt,
    };
}

export function formatNovelCardForPrompt(card: NovelCardData, recipientId: string): string {
    const recipient = card.authors.find(author => author.id === recipientId);
    const names = card.authors.map(author => author.name);
    if (card.userAuthored) names.unshift(card.userName);
    const relationship = recipient?.collaboratedWithUser ? `你曾和${card.userName}共同创作这部作品。`
        : recipient ? '你曾独立执笔这部作品。' : '你以读者身份阅读这部作品。';
    const label = { start: '开始创作', chapter: '章节完成', complete: '作品完结', share: '作品原文分享' }[card.kind];
    const chapters = (card.chapters || []).map(chapter =>
        `${card.scope === 'work' && card.chapters?.length === 1 ? '正文' : `第 ${chapter.index} 章`}${chapter.original !== undefined ? `原文：\n${chapter.original}` : `剧情总结：\n${chapter.summary || ''}`}`);
    return [
        `[笔友会·${label}]《${card.bookTitle}》${card.subtitle || ''}`,
        `创作者：${names.join('、') || '普通 AI 作者'}。 ${relationship}`,
        '创作活动真实发生，作品情节属于虚构。',
        card.bookSummary ? `简介：${card.bookSummary}` : '',
        card.summary ? `全文剧情总结：${card.summary}` : '',
        ...chapters,
    ].filter(Boolean).join('\n\n');
}
