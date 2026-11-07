import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { CharacterProfile } from '../../types';
import { AWAY_DELAY_OPTIONS, resolveAwayDelayMinutes } from '../../utils/awayMessageCore';
import { isAwayCloudRoute } from '../../utils/awayMessage';

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

    useEffect(() => {
        if (!isOpen) return;
        setEnabled(!!char.awayMessage?.enabled);
        setDelay(resolveAwayDelayMinutes(char));
        setQuietEnabled(!!char.awayMessage?.quietHours?.enabled);
        setQuietStart(char.awayMessage?.quietHours?.startTime || '23:00');
        setQuietEnd(char.awayMessage?.quietHours?.endTime || '08:00');
        let cancelled = false;
        void isAwayCloudRoute(char).then(v => { if (!cancelled) setCloud(v); });
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
                    你超过设定的时间没说话，{char.name} 就会来找你。一次离开只找一次，你开口后重新计时。
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
                        <p className="pt-2 border-t border-slate-100 text-[11px] text-slate-400 leading-relaxed">
                            {cloud === null ? '' : cloud
                                ? `${char.name} 开着主动消息 2.0：到时间会直接推送给你。这一次算作「没回时找你」，受主动频率里的上限管。`
                                : `你下次打开 SullyOS 时，${char.name} 会补上你不在时发的消息。每次打开，每个开了这项的角色会调一次聊天 API。`}
                        </p>
                    </>
                )}
            </div>
        </Modal>
    );
};

export default React.memo(AwayMessageSettingsModal);
