// 保存“离开后消息”设置时也要用 Char 最后一次真实发言做空闲锚点。
// 这是源码级接线守卫：完整云端建链行为由 awayMessageCloudBootstrap.test.ts 覆盖。
// apps/Chat.tsx 很大、含 React/浏览器依赖，Node 下不直接渲染它。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const chatSource = readFileSync(fileURLToPath(new URL('../apps/Chat.tsx', import.meta.url)), 'utf8');
const settingsStart = chatSource.indexOf('<AwayMessageSettingsModal');
const settingsEnd = chatSource.indexOf('{/* 思考链设置 Modal', settingsStart);
if (settingsStart < 0 || settingsEnd < 0) throw new Error('找不到离开后消息设置保存入口');
const settingsCode = chatSource.slice(settingsStart, settingsEnd);

describe('离开后设置保存时补建首条云端任务', () => {
  it('只从角色发言读取锚点，与聊天入口和 Worker 的规则保持一致', () => {
    expect(settingsCode).toContain('const lastCharAt = getLastRealCharMessageAt(recent)');
    expect(settingsCode).toContain('if (lastCharAt == null) return');
    expect(settingsCode).toMatch(/syncCloudAwayTask\(\{\s*char: updatedChar, lastCharAt,/);
    expect(settingsCode).not.toMatch(/lastUserAt|getLastRealUserMessageAt/);
  });
});
