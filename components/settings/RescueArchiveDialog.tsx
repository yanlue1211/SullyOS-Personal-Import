import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';
import { isAmsgRescueExport, rescueExportToBackup } from '../../utils/amsgRescueImport';
import { listRescueArchives, saveRescueArchive, type RescueArchive } from '../../utils/rescueArchive';

type Preview = ReturnType<typeof rescueExportToBackup> & { name: string };

export default function RescueArchiveDialog({ onClose }: { onClose: () => void }) {
    const [archives, setArchives] = useState<RescueArchive[]>([]);
    const [preview, setPreview] = useState<Preview | null>(null);
    const [busy, setBusy] = useState(false);
    const [notice, setNotice] = useState('');

    useEffect(() => {
        void listRescueArchives().then(setArchives, () => setNotice('无法读取本机救援档案。'));
    }, []);

    const readFile = async (file: File) => {
        setBusy(true);
        setNotice('');
        setPreview(null);
        try {
            const data: unknown = JSON.parse(await file.text());
            if (!isAmsgRescueExport(data)) throw new Error('请选择 Worker 救援页下载的 JSON。');
            const recovered = rescueExportToBackup(data);
            if (!recovered.summary.characters) throw new Error('这个文件里没有可读的角色资料。');
            setPreview({ name: file.name, ...recovered });
        } catch (error) {
            setNotice(error instanceof Error ? error.message : '读取失败。');
        } finally {
            setBusy(false);
        }
    };

    const save = async () => {
        if (!preview) return;
        setBusy(true);
        try {
            await saveRescueArchive(preview.name, { backup: preview.backup, summary: preview.summary });
            setArchives(await listRescueArchives());
            setPreview(null);
            setNotice('已保存到独立救援档。');
        } catch {
            setNotice('保存失败，请检查本机空间后重试。');
        } finally {
            setBusy(false);
        }
    };

    const download = (archive: RescueArchive) => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(archive.backup)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'sullyos-rescued-' + archive.id + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 10_000);
    };

    return <Modal isOpen title="主动消息救援档" onClose={onClose} portal>
        <div className="space-y-4 text-sm">
            <p className="text-slate-600">选择从 Worker 救援页下载的 JSON。预览后可存到独立救援档，原有角色和聊天保留。</p>
            <label className="block rounded-xl border border-emerald-200 bg-emerald-50 p-3 font-bold text-emerald-900">
                选择救援文件
                <input type="file" accept=".json,application/json" disabled={busy} className="mt-2 block w-full text-xs"
                    onChange={event => {
                        const file = event.target.files?.[0];
                        event.target.value = '';
                        if (file) void readFile(file);
                    }} />
            </label>
            {notice && <p role="status" className="text-slate-600">{notice}</p>}
            {preview && <div className="space-y-2 rounded-xl border p-3">
                <p>{preview.summary.characters} 个角色 · {preview.summary.messages} 条对话</p>
                <ul className="max-h-32 overflow-y-auto text-slate-600">
                    {preview.backup.characters?.map(char => <li key={char.id}>{char.name}</li>)}
                </ul>
                <button type="button" onClick={() => void save()} disabled={busy}
                    className="rounded-lg bg-emerald-700 px-3 py-2 text-white disabled:opacity-50">保存到独立救援档</button>
            </div>}
            {archives.map(archive => <details key={archive.id} className="rounded-xl border p-3">
                <summary className="break-all">{archive.name} · {archive.summary.characters} 个角色</summary>
                {archive.backup.characters?.map(char => <section key={char.id} className="mt-3 border-t pt-2">
                    <h4 className="font-bold">{char.name}</h4>
                    <p className="whitespace-pre-wrap break-words text-xs text-slate-600">{char.systemPrompt || char.description}</p>
                    <ul className="mt-2 space-y-1 text-xs">
                        {archive.backup.messages?.filter(message => message.charId === char.id).map(message => <li key={message.id}>
                            <span className="font-bold">{message.role === 'user' ? '我' : char.name} </span>
                            <span className="whitespace-pre-wrap break-words">{message.content}</span>
                        </li>)}
                    </ul>
                </section>)}
                <button type="button" className="mt-3 rounded-lg bg-slate-100 px-3 py-2" onClick={() => download(archive)}>下载兼容备份</button>
            </details>)}
        </div>
    </Modal>;
}
