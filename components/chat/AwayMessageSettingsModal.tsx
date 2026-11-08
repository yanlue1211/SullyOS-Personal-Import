import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile } from '../../types';
import { AWAY_DELAY_OPTIONS, resolveAwayDelayMinutes } from '../../utils/awayMessageCore';
import { isAwayCloudRoute, isAwayCloudWorkerCompatible } from '../../utils/awayMessage';
import { ActiveMsgClient } from '../../utils/activeMsgClient';
import type { AmsgDailySends } from '../../utils/amsgLimits';

interface AwayMessageSettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
    char: CharacterProfile;
    onSave: (config: NonNullable<CharacterProfile['awayMessage']>) => void;
}

const formatDelay = (minutes: number) => minutes < 60 ? `${minutes} 分钟` : `${minutes / 60} 小时`;

const AwayMessageSettingsModal: React.FC<AwayMessageSettingsModalProps> = ({ isOpen, onClose, char, onSave }) => {
    const [enabled, setEnabled] = useState(!!char.awayMessage?.enabled);
    const [delay, setDelay] = useState(resolveAwayDelayMinutes(char));
    const [quietEnabled, setQuietEnabled] = useState(!!char.awayMessage?.quietHours?.enabled);
    const [quietStart, setQuietStart] = useState(char.awayMessage?.quietHours?.startTime || '23:00');
    const [quietEnd, setQuietEnd] = useState(char.awayMessage?.quietHours?.endTime || '08:00');
    const [cloud, setCloud] = useState<boolean | null>(null);
    const [workerCompatible, setWorkerCompatible] = useState<boolean | null>(null);
    const [nextAwayAt, setNextAwayAt] = useState<string | null>(null);
    const [awayDailySends, setAwayDailySends] = useState<AmsgDailySends | null>(null);

    useEffect(() => {
        if (!isOpen) return;
        setEnabled(!!char.awayMessage?.enabled);
        setDelay(resolveAwayDelayMinutes(char));
        setQuietEnabled(!!char.awayMessage?.quietHours?.enabled);
        setQuietStart(char.awayMessage?.quietHours?.startTime || '23:00');
        setQuietEnd(char.awayMessage?.quietHours?.endTime || '08:00');
        let cancelled = false;
        setCloud(null);
        setWorkerCompatible(null);
        setNextAwayAt(null);
        setAwayDailySends(null);
        void isAwayCloudRoute(char).then(async v => {
            if (cancelled) return;
            setCloud(v);
            if (v) {
                const ready = await isAwayCloudWorkerCompatible();
                if (!cancelled) setWorkerCompatible(ready);
                if (ready) {
                    const [remote, status] = await Promise.allSettled([
                        ActiveMsgClient.listRemoteTasksForChar(char.id),
                        ActiveMsgClient.readPanelStatus(char.id),
                    ]);
                    if (cancelled) return;
                    if (remote.status === 'fulfilled') {
                        const next = remote.value
                            .filter(task => task.status === 'pending' && task.clientTaskId?.startsWith('away-'))
                            .map(task => task.nextSendAt).filter((at): at is string => Boolean(at))
                            .sort()[0];
                        setNextAwayAt(next ?? null);
                    }
                    if (status.status === 'fulfilled') setAwayDailySends(status.value.awayDailySends);
                }
            }
        });
        return () => { cancelled = true; };
    }, [isOpen, char]);

    const handleSave = () => {
        onSave({ enabled, delayMinutes: delay, quietHours: { enabled: quietEnabled, startTime: quietStart, endTime: quietEnd } });
        onClose();
    };

    return (
        <Modal isOpen={isOpen} title="离开后消息" onClose={onClose} footer={
            <>
                <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl active:scale-95 transition-transform">
                    取消
                </button>
                <button onClick={handleSave} className="flex-1 py-3 bg-violet-500 text-white font-bold rounded-2xl active:scale-95 transition-transform shadow-lg">
                    保存
                </button>
            </>
        }>
            <div className="space-y-5">
                <p className="text-xs text-slate-400 leading-relaxed">
                    你超过设定时间没说话后，每隔这段时间就给{char.name}一次主动联系你的机会；睡眠禁发或仍在线下见面时跳过，不累计补发。
                </p>

                <div className="flex items-center justify-between">
                    <span className="text-sm font-bold text-slate-700">启用离开后消息</span>
                    <button
                        onClick={() => setEnabled(!enabled)}
                        className={`w-12 h-7 rounded-full transition-colors relative ${enabled ? 'bg-violet-500' : 'bg-slate-200'}`}
                    >
                        <span className={`absolute top-0.5 left-0.5 w-6 h-6 bg-white rounded-full shadow transition-all duration-200 ${enabled ? 'translate-x-5' : 'translate-x-0'}`} />
                    </button>
                </div>

                {enabled && (
                    <>
                        <div>
                            <label className="text-sm font-bold text-slate-700 block mb-2">离开多久后</label>
                            <div className="grid grid-cols-4 gap-2">
                                {AWAY_DELAY_OPTIONS.map(minutes => (
                                    <button
                                        key={minutes}
                                        onClick={() => setDelay(minutes)}
                                        className={`py-2 px-1 rounded-xl text-xs font-bold transition-all ${delay === minutes
                                            ? 'bg-violet-500 text-white shadow-md'
                                            : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                                        }`}
                                    >
                                        {formatDelay(minutes)}
                                    </button>
                                ))}
                            </div>
                        </div>


                        <div className="border-t border-slate-100 pt-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                                <div>
                                    <div className="text-sm font-bold text-slate-700">睡眠时段禁发</div>
                                    <div className="text-xs text-slate-400 mt-1 leading-relaxed">
                                        只拦“超过多久没互动而自动找你”，不会影响 TA 自己预约的消息、明早行程报备或你们正在聊天时的回复。
                                    </div>
                                </div>
                                <button type="button" aria-label="睡眠时段禁发" aria-pressed={quietEnabled} onClick={() => setQuietEnabled(!quietEnabled)}
                                  className={`w-12 h-7 shrink-0 rounded-full relative transition-colors ${quietEnabled ? 'bg-violet-500' : 'bg-slate-200'}`}>
                                  <span className={`absolute top-0.5 w-6 h-6 rounded-full bg-white shadow transition-transform ${quietEnabled ? 'translate-x-5' : 'translate-x-0.5'}`}/>
                                </button>
                            </div>
                            {quietEnabled && (
                              <div className="grid grid-cols-2 gap-3">
                                <label className="text-xs text-slate-600">开始时间<input type="time" value={quietStart} onChange={e => setQuietStart(e.target.value)} className="block w-full mt-1 bg-slate-100 rounded-xl p-2.5"/></label>
                                <label className="text-xs text-slate-600">结束时间<input type="time" value={quietEnd} onChange={e => setQuietEnd(e.target.value)} className="block w-full mt-1 bg-slate-100 rounded-xl p-2.5"/></label>
                                <div className="col-span-2 text-[11px] text-slate-400">
                                  按你手机的时间计算，允许跨午夜。禁发的自动提醒直接跳过，醒来不会补发。
                                  {quietStart === quietEnd ? ' 时间相同表示全天禁发。' : ''}
                                </div>
                              </div>
                            )}
                        </div>
                        {cloud && workerCompatible && (
                            <div className="pt-2 border-t border-slate-100 text-xs text-violet-700 leading-relaxed">
                                <p>下一次离开提醒：{nextAwayAt
                                    ? new Date(nextAwayAt).toLocaleString()
                                    : '暂无云端待触发任务（保存后会补建，或下次进入时自动检查）'}</p>
                                {awayDailySends?.day === new Date().toLocaleDateString('en-CA') && (
                                    <p className="mt-1">今天离开后成功联系 {awayDailySends.sends} 次
                                        {awayDailySends.llmCalls != null ? ` · 后台 AI 调用 ${awayDailySends.llmCalls} 次` : ''}
                                    </p>
                                )}
                            </div>
                        )}
                        <p className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
                            {cloud === null ? '正在确认 Worker…' : cloud
                                ? workerCompatible === null ? '正在核对云端 Worker 版本…'
                                    : workerCompatible
                                        ? `${char.name} 已使用独立空闲提醒：与 TA 的自主预约分开计数，睡眠禁发和见面/通话保护只拦自动空闲机会。`
                                        : '云端 Worker 版本未匹配或无法验证：已保护旧任务，暂停创建新的循环空闲提醒。先检查主动消息2.0的 Worker 更新状态。'
                                : `没有云端2.0时，打开 SullyOS 只检查最新一个有效时间点，不会一次补发多条；通过检查才会调用API。`}
                        </p>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default React.memo(AwayMessageSettingsModal);
