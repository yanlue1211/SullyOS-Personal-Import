import { describe, expect, it, vi, afterEach } from 'vitest';
import { ChatParser } from './chatParser';
import { DB } from './db';

// 旧本地定时消息已退役：不再从任何聊天内容创建新的 IndexedDB 任务。
// 已存在的队列不迁移、不删除，继续沿用原有定时投递及用户手动取消途径。
const noop = () => {};
afterEach(() => { vi.restoreAllMocks(); });
const run = (content: string, toast: (message: string, type: 'info' | 'success' | 'error') => void = noop) =>
    ChatParser.parseAndExecuteActions(content, `c-sched-${Date.now()}`, '阿一', toast);

describe('旧 [schedule_message] 退役但保护存量数据', () => {
    it('过去/未来的旧文本都不新建任务，且剥掉不应显示的指令', async () => {
        const save = vi.spyOn(DB, 'saveScheduledMessage');
        const toast = vi.fn();
        const farFuture = new Date(Date.now() + 86400_000);
        const date = `${farFuture.getFullYear()}-${String(farFuture.getMonth() + 1).padStart(2, '0')}-${String(farFuture.getDate()).padStart(2, '0')} 12:00:00`;
        const out = await run(`好\n[schedule_message | ${date} | fixed | 到时来找你]\n[schedule_message | 2020-01-01 08:00:00 | fixed | 早安]`, toast);
        expect(out).toBe('好');
        expect(save).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(expect.stringContaining('已停用'), 'info');
    });

    it('仍然保留正常文本和其他动作的处理', async () => {
        const save = vi.spyOn(DB, 'saveScheduledMessage');
        const out = await run('早安\n[schedule_message | 2027-01-01 08:00:00 | fixed | 久等啦]');
        expect(out).toBe('早安');
        expect(save).not.toHaveBeenCalled();
    });

    it('已有本地队列依然原样保留，不对存量做删除/迁移', async () => {
        const charId = `legacy-keep-${Date.now()}`;
        const id = `sched-keep-${Date.now()}`;
        const row = { notificationId: 1234, id, charId, content: '老任务的约定要保留', dueAt: Date.now() + 86400_000, createdAt: Date.now() };
        await DB.saveScheduledMessage(row);
        try {
            const del = vi.spyOn(DB, 'deleteScheduledMessage');
            await ChatParser.parseAndExecuteActions(
                '照常聊天\n[schedule_message | 2030-02-03 04:05:06 | fixed | 新任务禁止创建]',
                charId, '阿一', noop,
            );
            const tasks = await DB.getScheduledMessages(charId);
            expect(tasks).toEqual(expect.arrayContaining([expect.objectContaining({ id, content: row.content })]));
            expect(del).not.toHaveBeenCalled();
        } finally {
            await DB.deleteScheduledMessage(id);
        }
    });
});

// 回归守卫：离线补收时一条消息会被拆成正文气泡 + 卡片/系统提示。正文走
// applyAssistantPostProcessing 的 persistMessage 盖上原始发送时刻，而 chatParser 这边
// 以前是一水儿的裸 DB.saveMessage，默认写库当刻——用户凌晨三点收到的那条消息，正文显示
// 凌晨三点、戳一戳和转账显示「早上九点打开 App 那一刻」，一条消息两个时间。
describe('parseAndExecuteActions 落库时间戳', () => {
    it('传了 messageTimestamp → 戳一戳 / 转账 / 日程系统提示全用同一个时刻', async () => {
        const charId = `c-ts-${Date.now()}`;
        const sentAt = Date.UTC(2026, 7, 2, 19, 0);   // 凌晨三点（东八区）发出

        await ChatParser.parseAndExecuteActions(
            '睡吧\n[[ACTION:POKE]]\n[[ACTION:TRANSFER:520]]\n[[ACTION:ADD_EVENT | 面试 | 2026-08-03]]',
            charId, '阿一', noop, undefined, undefined, sentAt,
        );

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        const stamped = msgs.filter(m => m.type !== 'text' || m.role === 'system');
        expect(stamped.length).toBeGreaterThanOrEqual(3);
        for (const m of stamped) expect(m.timestamp).toBe(sentAt);
    }, 20000);

    it('不传 → 维持写库当刻（前台聊天那条路不变）', async () => {
        const charId = `c-ts-none-${Date.now()}`;
        const before = Date.now();
        await ChatParser.parseAndExecuteActions('[[ACTION:POKE]]', charId, '阿一', noop);

        const msgs = await DB.getRecentMessagesByCharId(charId, 50);
        expect(msgs).toHaveLength(1);
        expect(msgs[0].timestamp).toBeGreaterThanOrEqual(before);
    }, 20000);
});
