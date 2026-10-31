import React, { useEffect, useRef, useState } from 'react';
import { createWorkroomHost } from '../features/workroom/host';
import { type WorkroomVersion } from '../features/workroom/schema';
import { buildWorkroomDocument, WORKROOM_SANDBOX } from '../features/workroom/runner';

export interface WorkroomRunnerProps {
    charId: string;
    version: WorkroomVersion;
    onNotify?: (text: string) => void;
    onError?: (text: string) => void;
    preview?: boolean;
}
/** Each mount/version owns a fresh iframe and capability port; teardown revokes old work. */
export default function WorkroomRunner({ charId, version, onNotify, onError, preview = false }: WorkroomRunnerProps) {
    const iframe = useRef<HTMLIFrameElement>(null);
    const [stopped, setStopped] = useState(false);
    const callbacks = useRef({ onNotify, onError });
    callbacks.current = { onNotify, onError };
    const [doc, setDoc] = useState('');
    const setup = useRef<(() => void) | undefined>();
    const stop = useRef<(() => void) | undefined>();
    useEffect(() => {
        let active = true;
        let loadCount = 0;
        let port: MessagePort | undefined;
        const session = crypto.randomUUID();
        const host = createWorkroomHost(charId, version.workId, version.id, session, {
            onNotify: text => callbacks.current.onNotify?.(text),
            onError: text => callbacks.current.onError?.(text),
            onStop: () => setStopped(true),
        }, preview);
        const dispose = () => { active = false; port?.close(); host.close(); };
        stop.current = dispose;
        setup.current = () => {
            if (!active) return;
            // A navigation never inherits the previous frame's capability.
            if (++loadCount > 1) { dispose(); setStopped(true); return; }
            const channel = new MessageChannel();
            port = channel.port1;
            host.bind(port);
            iframe.current?.contentWindow?.postMessage({ workroomSession: session }, '*', [channel.port2]);
        };
        setStopped(false);
        if (version.charId !== charId) { setStopped(true); return dispose; }
        setDoc(buildWorkroomDocument(version, session));
        return () => { dispose(); setup.current = undefined; stop.current = undefined; };
    }, [charId, version.id, preview]);
    if (stopped) return <div role="status">组件已停止。</div>;
    return <div className="h-full flex flex-col">
        <button type="button" onClick={() => { stop.current?.(); setup.current = undefined; setStopped(true); }} className="self-end px-3 py-1 text-xs">停止运行</button>
        {doc && <iframe key={doc} ref={iframe} title="造物间作品" className="w-full flex-1 border-0" sandbox={WORKROOM_SANDBOX}
            referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'"
            srcDoc={doc} onLoad={() => setup.current?.()} />}
    </div>;
}
