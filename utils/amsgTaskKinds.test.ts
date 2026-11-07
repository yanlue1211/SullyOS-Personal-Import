import { describe, expect, it } from 'vitest';
import { classifyTaskRow } from './amsgTaskKinds';

describe('author 8a4d6c99fb: cloud task classification', () => {
  it('list projections are classified by subtype when metadata is unavailable', () => {
    expect(classifyTaskRow({ messageSubtype: 'chat' })).toBe('scheduled');
    expect(classifyTaskRow({ messageSubtype: 'instant-chat' })).toBe('instant-chat');
    expect(classifyTaskRow({ messageSubtype: 'job' })).toBe('background-job');
    expect(classifyTaskRow({})).toBe('scheduled');
  });
  it('metadata identity has precedence over row subtype', () => {
    expect(classifyTaskRow({ messageSubtype: 'chat', metadata: { amsgInstantChat: true } })).toBe('instant-chat');
    expect(classifyTaskRow({ messageSubtype: 'chat', metadata: { amsgKind: 'plate' } })).toBe('background-job');
    expect(classifyTaskRow({ messageSubtype: 'instant-chat', metadata: { amsgSelfScheduled: true } })).toBe('scheduled');
    expect(classifyTaskRow({ messageSubtype: 'instant-chat', metadata: { amsgSelfScheduled: true, amsgInstantChat: true } })).toBe('instant-chat');
  });
});
