// @vitest-environment jsdom
import { beforeEach, expect, it } from 'vitest';
import { beginStoryMeeting, endStoryMeeting } from './storyMeetingLock';
import { isAmsgActiveDate, setAmsgActiveDate } from './amsgInteractionGuard';
beforeEach(() => localStorage.clear());
it('暂离再进入同一剧情保留场次，多角色各自上锁，结束只影响本角色', () => {
    const a = beginStoryMeeting('a', 'story');
    beginStoryMeeting('b', 'story');
    expect(beginStoryMeeting('a', 'story')).toBe(a);
    expect(endStoryMeeting('a', a)).toBe(true);
    expect(isAmsgActiveDate('a')).toBe(false);
    expect(isAmsgActiveDate('b')).toBe(true);
    expect(beginStoryMeeting('a', 'story')).not.toBe(a);
});
it('旧剧情不能解除新普通见面或另一剧情的锁', () => {
    const old = beginStoryMeeting('a', 'story');
    setAmsgActiveDate('a', true, 'normal-date');
    expect(endStoryMeeting('a', old)).toBe(false);
    const newer = beginStoryMeeting('a', 'other');
    expect(newer).not.toBe(old);
    expect(endStoryMeeting('a', old)).toBe(false);
    expect(isAmsgActiveDate('a')).toBe(true);
});
