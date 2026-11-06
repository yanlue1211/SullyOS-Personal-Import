import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import { DB } from './db';
import { buildStoryActorRecallMessages, loadStoryActorContext, replaceStoryTheaterReply } from './storyTheaterReply';

describe('剧情重写上下文和保存', () => {
    it('本剧情的用户/助手镜像都不回流，仍保留其他来源和剧情的可见原文', async () => {
        const char = { id: 'reroll-actor', contextRangeMode: 'manual', contextLimit: 20, contextRangePolicyVersion: 1 } as CharacterProfile;
        for (const [content, metadata] of [
            ['私聊', { source: 'chat' }],
            ['别的剧情', { source: 'story_theater_memory', theaterId: 'other' }],
            ['本轮输入', { source: 'story_theater_memory', theaterId: 'current' }],
            ['旧回复', { source: 'story_theater_memory', theaterId: 'current' }],
        ] as const) await DB.saveMessage({ charId: char.id, role: 'assistant', type: 'text', content, metadata });
        expect((await loadStoryActorContext(char, 'current', 20)).map(message => message.content)).toEqual(['私聊', '别的剧情']);
    });
    const seed = async (id: string): Promise<Message> => {
        const centralId = await DB.saveMessage({ charId: id, role: 'assistant', type: 'text', content: '旧回复' });
        const mirrorId = await DB.saveMessage({ charId: id + '-actor', role: 'assistant', type: 'text', content: '旧回复' });
        await DB.updateMessageMetadata(centralId, () => ({ theaterMirrorIds: { actor: mirrorId } }));
        return (await DB.getMessagesByCharId(id, true))[0];
    };
    it('成功后原位原子替换，中央正文和镜像不会多出一条', async () => {
        const old = await seed('reroll-save');
        await replaceStoryTheaterReply(old, '新回复', { theaterPromptTokens: 123 });
        const rows = await DB.getMessagesByCharId(old.charId, true);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ id: old.id, content: '新回复', metadata: { theaterPromptTokens: 123 } });
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('新回复');
    });
    it('任意镜像在请求期间被编辑，整个事务回滚保留用户修改和原正文', async () => {
        const old = await seed('reroll-conflict');
        const mirrorId = Number((old.metadata?.theaterMirrorIds as Record<string, number>).actor);
        await DB.updateMessage(mirrorId, '手动编辑');
        await expect(replaceStoryTheaterReply(old, '新回复', {})).rejects.toThrow('已被修改');
        expect((await DB.getMessagesByCharId(old.charId, true))[0].content).toBe('旧回复');
        expect((await DB.getMessagesByCharId(old.charId + '-actor', true))[0].content).toBe('手动编辑');
    });
});

describe('剧情共享上下文与召回线索', () => {
 it('真实时间携带完整共享窗口；虚构模式仍尊重独立条数和用户断点', async () => {
  const char={id:'story-full-window',contextRangeMode:'manual',contextLimit:150,contextRangePolicyVersion:1} as CharacterProfile;
  for(let i=0;i<130;i++) await DB.saveMessage({charId:char.id,role:'user',type:'text',content:`消息${i}`});
  const all=await loadStoryActorContext(char,'scene');
  expect(all).toHaveLength(130);
  expect(await loadStoryActorContext(char,'scene',100)).toHaveLength(100);
  expect(await loadStoryActorContext({...char,contextUserStartMessageId:all[120].id},'scene')).toHaveLength(10);
  expect(await loadStoryActorContext(char,'scene',0)).toEqual([]);
 });
 it('当前剧情用户输入成为最新召回线索，保留私聊且不重复或改写原数组', () => {
  const old={id:1,role:'user',content:'旧私聊'} as Message;
  const fresh={id:2,role:'user',content:'现在剧情里找钥匙'} as Message;
  const carried=[old,fresh];
  const result=buildStoryActorRecallMessages(carried,[fresh]);
  expect(result).toEqual([old,fresh]);
  expect(carried).toEqual([old,fresh]);
  expect(buildStoryActorRecallMessages([old],[fresh]).at(-1)).toBe(fresh);
 });
});
