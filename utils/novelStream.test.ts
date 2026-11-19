import { describe, expect, it } from 'vitest';
import { readNovelStreamPreview } from './novelStream';

describe('novel streaming fields', () => {
    it('previews a partial JSON string without field names or unfinished escaped characters', () => {
        expect(readNovelStreamPreview(String.raw`{"writer":{"content":"门开了。\n他问：\"谁？\"\u62`).body)
            .toBe('门开了。\n他问："谁？"');
    });

    it('keeps other tasks separate even when a gateway changes field order', () => {
        expect(readNovelStreamPreview('{"comment":{"content":"感想"},"analysis":{"reaction":"简评","critique":"复盘"},"writer":{"mood":"紧张","content":"正文"}}'))
            .toEqual({ body: '正文', comment: '感想', analysis: '复盘' });
    });

    it('recovers completed book title and summary even when the first paragraph is truncated', () => {
        expect(readNovelStreamPreview('{"bookMeta":{"title":"海底来信","summary":"一条人鱼的远行"},"writer":{"content":"潮汐涌来'))
            .toEqual({ body: '潮汐涌来', comment: '', analysis: '', bookMeta: { title: '海底来信', summary: '一条人鱼的远行' } });
        expect(readNovelStreamPreview('{"bookMeta":{"title":"尚未结束'))
            .toEqual({ body: '', comment: '', analysis: '' });
    });

    it('does not promote metadata fragments or fenced wrappers to prose', () => {
        expect(readNovelStreamPreview('```json\n{"meta":{"content":"假正文"},"writer":{"content":"第一段')).toEqual({
            body: '第一段', comment: '', analysis: '',
        });
    });
});
