import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOS } from '../context/OSContext';
import Modal from './os/Modal';
import {
  AMSG_OWNER_CONFLICT_EVENT,
  findCloudOwnerConflicts,
  type CloudOwnerConflict,
} from '../utils/amsgOwnerReconcile';

/**
 * Non-destructive phase of upstream df40214ae6.
 * Only detects mismatched owner generations and asks the user to check them.
 * Does NOT call deleteCharacter / restoreOwner / any cloud mutation.
 */
export default function AmsgOwnerConflictNotice() {
  const { characters, isDataLoaded } = useOS();
  const [conflicts, setConflicts] = useState<CloudOwnerConflict[]>([]);
  const currentCharacters = useRef(characters);
  currentCharacters.current = characters;
  const checking = useRef(false);
  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const rows = await findCloudOwnerConflicts(currentCharacters.current);
      setConflicts(rows);
    } catch (err) {
      // Read-only check failure is not permission to remove or re-register a character.
      console.warn('[amsg2] 云端角色只读对账失败，下次打开再试', err);
    } finally {
      checking.current = false;
    }
  }, []);
  useEffect(() => {
    if (!isDataLoaded) return;
    const timer = setTimeout(() => void check(), 3000);
    const onConflict = () => void check();
    window.addEventListener(AMSG_OWNER_CONFLICT_EVENT, onConflict);
    return () => {
      clearTimeout(timer);
      window.removeEventListener(AMSG_OWNER_CONFLICT_EVENT, onConflict);
    };
  }, [isDataLoaded, check]);
  if (!conflicts.length || typeof document === 'undefined') return null;
  return createPortal(
    <Modal
      isOpen
      title="角色的云端状态需要核对"
      onClose={() => setConflicts([])}
      footer={
        <button type="button" onClick={() => setConflicts([])}
          className="w-full py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">
          知道了，稍后处理
        </button>
      }
    >
      <div className="space-y-3 text-sm leading-relaxed text-slate-600">
        <p>这些角色的本地记录与云端登记不一致，可能是另一台设备删除或恢复过角色、或导入了旧备份。当前不会自动删除角色、恢复云端状态或覆盖聊天记录。</p>
        {conflicts.map(char => (
          <div key={char.id} className="rounded-2xl border border-amber-200 bg-amber-50 p-3">
            <p className="font-bold text-slate-800 break-all">{char.name}</p>
            <p className="text-xs text-amber-800">{char.retired
              ? '云端已停用，主动消息任务可能无法再写入。'
              : '本机保存的云端恢复代次与服务器不一致。'}</p>
          </div>
        ))}
        <p className="text-xs text-slate-500">建议先备份本地数据，再到主动消息 2.0 的云端数据管理核对。是否恢复使用或删除角色，应由你明确选择。</p>
      </div>
    </Modal>,
    document.body,
  );
}
