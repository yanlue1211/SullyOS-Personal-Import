import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';
import { formatMessageForPrompt, formatMessageWithTime, isMessageSemanticallyRelevant, normalizeMessageContent } from './messageFormat';
import { createWorkroomMessage, readWorkroomEvent, type WorkroomEvent, type WorkroomEventKind } from './workroomEvent';
import type { CharacterProfile, Message, UserProfile } from '../types';

const sample = (kind: WorkroomEventKind): WorkroomEvent => ({
    version: 1, eventId: `event-${kind}`, charId: 'ayuan', charName: '阿源', kind,
    subjectId: 'work-1', title: '星空日历', summary: '记录特殊日期的互动日历',
    detail: kind === 'shared' ? 'User 分享给阿源，尚未收藏。'
        : kind === 'accepted' ? '阿源明确接收，已创建独立副本。'
        : 'User 和阿源共同完成了新功能，小狗升到 3 级。',
    timestamp: 1_793_400_000_000,
    ...(['shared', 'accepted'].includes(kind) ? { sourceAuthorName: 'Claude', shareId: 'share-1' } : {}),
});
const message = (event: WorkroomEvent): Message => ({ id: 1, ...createWorkroomMessage(event) });

describe('造物间事件：聊天和记忆共享可读材料', () => {
    it.each<WorkroomEventKind>(['inspiration', 'completed', 'progress', 'shared', 'accepted'])('%s 经 JSON 往返后进入聊天、宫殿及手动归档格式化入口', kind => {
        const m: Message = JSON.parse(JSON.stringify(message(sample(kind))));
        const expected = normalizeMessageContent(m, '阿源', 'User');
        const { apiMessages } = ChatPrompts.buildMessageHistory([m], 10,
            { id: 'ayuan', name: '阿源', workroomEnabled: false } as unknown as CharacterProfile,
            { name: 'User' } as UserProfile, []);
        expect(apiMessages.some(row => String(row.content).includes(expected))).toBe(true);
        expect(formatMessageForPrompt(m, '阿源', 'User')).toContain(expected);
        expect(formatMessageWithTime(m, '阿源', 'User', () => '时间')).toContain(expected);
        expect(isMessageSemanticallyRelevant(m)).toBe(true);
        expect(expected).toContain('星空日历');
        expect(expected).toContain(sample(kind).detail);
    });

    it('拒绝其他角色、未知版本、畸形字段和缺少来源的接收事件', () => {
        expect(readWorkroomEvent(sample('completed'), 'claude')).toBeUndefined();
        for (const patch of [{ version: 2 }, { kind: 'toString' }, { timestamp: NaN }, { timestamp: -1 },
            { title: '' }, { detail: 'a'.repeat(8001) }, { summary: {} }, { shareId: undefined }, { sourceAuthorName: undefined }]) {
            expect(readWorkroomEvent({ ...sample('accepted'), ...patch }, 'ayuan')).toBeUndefined();
        }
    });

    it('只保留白名单字段，作品源码、原作者私聊和凭据不进入事件消息', () => {
        const m = message({ ...sample('shared'), code: '<script>private</script>', apiKey: 'secret-key',
            privateChat: '不可分享的私聊' } as WorkroomEvent);
        const serialized = JSON.stringify(m);
        expect(serialized).not.toContain('secret-key');
        expect(serialized).not.toContain('<script>');
        expect(serialized).not.toContain('不可分享的私聊');
        expect(serialized).toContain('Claude');
        expect(m.role).toBe('user');
    });

    it('坏快照不退回原始 JSON、代码或跨角色内容', () => {
        const m = message(sample('shared'));
        m.charId = 'another';
        m.content = '<script>secret()</script>';
        expect(normalizeMessageContent(m, '另一个角色', 'User')).toBe('[造物间记录不可用]');
    });

    it('事件快照独立于后续作品变更，分享不被描述成已接收', () => {
        const e = sample('shared');
        const m = message(e);
        e.title = '改名后的作品';
        expect(normalizeMessageContent(m, '阿源', 'User')).toContain('星空日历');
        expect(normalizeMessageContent(m, '阿源', 'User')).toContain('尚未收藏');
        expect(normalizeMessageContent(m, '阿源', 'User')).not.toContain('已创建独立副本');
    });
});
