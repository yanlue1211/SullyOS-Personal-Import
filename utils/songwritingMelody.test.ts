import { describe, it, expect } from 'vitest';
import { melodyToAbc, validateBars, makeVersion, type MelodyBar } from '../features/songwriting/melody';

const eight = (): MelodyBar[] => Array.from({ length: 8 }, () => ({
  notes: [
    { pitch: 'C4', beats: 1, lyric: '我' },
    { pitch: 'D4', beats: 1, lyric: '想' },
    { pitch: 'E4', beats: 1, lyric: '陪' },
    { pitch: 'G4', beats: 1, lyric: '你' },
  ],
}));
describe('versioned char melody notation', () => {
  it('validates eight measures and keeps precise note data', () => {
    const v = makeVersion(eight(), 84, '完成第一版');
    expect(v.bars).toHaveLength(8);
    expect(v.bars[0].notes[0]).toEqual({ pitch: 'C4', beats: 1, lyric: '我' });
    const score = melodyToAbc(v, '测试旋律');
    expect(score).toContain('M:4/4');
    expect(score).toContain('Q:1/4=84');
    expect(score).toContain('=C2 =D2 =E2 =G2 |');
    expect(score.split('|')).toHaveLength(9);
  });
  it('rejects incomplete measures without changing saved versions', () => {
    const bars = eight(); bars[2].notes[0].beats = 0.5;
    expect(() => validateBars(bars)).toThrow(/第 3 小节/);
    expect(() => validateBars(eight().slice(1))).toThrow(/恰好 8 小节/);
  });
  it('rejects out-of-range note names and invalid durations', () => {
    const bars = eight(); bars[1].notes[0].pitch = 'C8';
    expect(() => validateBars(bars)).toThrow(/第 2 小节/);
    const bars2 = eight(); bars2[1].notes[0].beats = -1;
    expect(() => validateBars(bars2)).toThrow(/第 2 小节/);
  });
  it('renders sharps, naturals, rests and upper octaves faithfully', () => {
    const bars = eight();
    bars[0].notes = [
      { pitch: 'F#4', beats: 1 },
      { pitch: 'F4', beats: 1 },
      { pitch: 'R', beats: 1 },
      { pitch: 'C5', beats: 1 },
    ];
    const score = melodyToAbc(makeVersion(bars, 96, '调整'), '测试');
    expect(score).toContain('^F2 =F2 z2 =c2 |');
  });
  it('rejects invalid bpm', () => {
    expect(() => makeVersion(eight(), 300, '太快')).toThrow(/50–160/);
  });
});
