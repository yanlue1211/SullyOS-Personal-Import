import { describe, expect, it } from 'vitest';
import { describeD1LimitCode } from './amsgD1Limits';

describe('legacy browser D1 quota messaging compatibility', () => {
    it('still explains known Cloudflare quota codes when Object.hasOwn is absent', () => {
        const original = Object.getOwnPropertyDescriptor(Object, 'hasOwn');
        Object.defineProperty(Object, 'hasOwn', { configurable: true, value: undefined });
        try {
            expect(describeD1LimitCode('D1_STORAGE_FULL')).toContain('数据库满了');
            expect(describeD1LimitCode('D1_DAILY_READ_LIMIT')).toContain('读取额度');
            expect(describeD1LimitCode('D1_DAILY_WRITE_LIMIT')).toContain('写入额度');
            expect(describeD1LimitCode('toString')).toBe('');
            expect(describeD1LimitCode('__proto__')).toBe('');
            expect(describeD1LimitCode(null)).toBe('');
        } finally {
            if (original) Object.defineProperty(Object, 'hasOwn', original);
            else Reflect.deleteProperty(Object, 'hasOwn');
        }
    });
});
