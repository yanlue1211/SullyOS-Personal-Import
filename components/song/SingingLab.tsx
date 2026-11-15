import VoiceClonePanel from "./VoiceClonePanel";
import { HAIMIAN_READING_TEXT } from "../../features/songwriting/voiceClone";
import React, { useEffect, useState } from "react";
import { useOS } from "../../context/OSContext";
import { DB } from "../../utils/db";
import { synthesizeSpeechDetailed } from "../../utils/minimaxTts";
import { shareOrDownloadBlob } from "../../utils/shareExport";
import type { CharacterProfile } from "../../types";
/** Preparation only. No Haimian credentials or unverified endpoints are submitted. */
export default function SingingLab({ char }: { char?: CharacterProfile }) {
  const { apiConfig, addToast } = useOS();
  const [sampleScript, setSampleScript] = useState("");
  const [script, setScript] = useState(HAIMIAN_READING_TEXT),
    [sample, setSample] = useState<Blob | null>(null),
    [url, setUrl] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [confirmed, setConfirmed] = useState(false);
  useEffect(() => {
    let active = true;
    setSample(null);
    if (char)
      void DB.getAssetRaw("songwriting:voice-sample:" + char.id)
        .then(async (row) => {
          if (active && typeof row?.audio === "string") {
            const blob = await (await fetch(row.audio)).blob();
            if (active) {
              setSample(blob);
              setScript(row.script || HAIMIAN_READING_TEXT);
              setSampleScript(row.script || "");
            }
          }
        })
        .catch(() => {
          if (active) setError("测试音频读取失败，可重新生成");
        });
    return () => {
      active = false;
    };
  }, [char?.id]);
  useEffect(() => {
    if (!sample) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(sample);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [sample]);
  const synthesize = async () => {
    if (!char || !script.trim() || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await synthesizeSpeechDetailed(script, char, apiConfig, {
        textAlreadyPrepared: true,
      });
      try {
        const blob = result.blob || (await (await fetch(result.url)).blob());
        const audio = await new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(String(r.result));
          r.onerror = () => reject(r.error);
          r.readAsDataURL(blob);
        });
        await DB.saveAssetRaw("songwriting:voice-sample:" + char.id, {
          audio,
          script,
          voiceId: char.voiceProfile?.voiceId,
          createdAt: Date.now(),
        });
        setSample(blob);
        setSampleScript(script);
        addToast("测试朗读已准备好", "success");
      } finally {
        if (result.url.startsWith("blob:")) URL.revokeObjectURL(result.url);
      }
    } catch (e: any) {
      setError(e.message || String(e));
    } finally {
      setBusy(false);
      setConfirmed(false);
    }
  };
  return (
    <section className="sw-panel">
      <div className="sw-panel-heading">
        <h3>专属歌声</h3>
        <small>A VOICE THAT FEELS LIKE YOU</small>
      </div>
      <p className="sw-lab-copy">
        先准备角色朗读，再直接上传创建海绵音色。
      </p>
      <div className="sw-lab-info">
        {char?.name || "未选择角色"} · MiniMax 音色：
        {char?.voiceProfile?.voiceId ||
          (char?.voiceProfile?.timberWeights?.length ? "混合音色" : "尚未配置")}
      </div>
      <p className="sw-lab-copy">
        已填入这次官网确认的第五张「朗读以下文字」台词。直接用角色平时的声音朗读，不需要唱。若官网以后更换台词，可以修改后重新生成。
      </p>
      <textarea
        aria-label="音色克隆测试台词"
        value={script}
        onChange={(e) => setScript(e.target.value)}
        rows={5}
        placeholder="粘贴平台指定的完整台词，不自行改字"
      />
      <label className="sw-lab-copy">
        <input
          type="checkbox"
          checked={confirmed}
          onChange={(e) => setConfirmed(e.target.checked)}
        />{" "}
        使用现有 MiniMax 套餐生成一次测试朗读，可能消耗额度
      </label>
      <button
        className="sw-primary"
        disabled={
          busy ||
          !confirmed ||
          !script.trim() ||
          (!char?.voiceProfile?.voiceId &&
            !char?.voiceProfile?.timberWeights?.length)
        }
        onClick={() => void synthesize()}
      >
        {busy ? "正在准备声音…" : "生成测试朗读"}
      </button>
      {error && (
        <div className="sw-error" role="alert">
          {error}
        </div>
      )}
      {url && (
        <div className="sw-lab-sample">
          <audio controls src={url} />
          <button
            onClick={() => {
              if (sample)
                void shareOrDownloadBlob({
                  blob: sample,
                  fileName: `songwriting-voice-${char?.id || "sample"}.${sample.type.includes("wav") ? "wav" : "mp3"}`,
                  preferDownloadOnWeb: true,
                }).catch((e) => setError(e.message));
            }}
          >
            保存测试音频
          </button>
        </div>
      )}
      {char && <VoiceClonePanel key={char.id} charId={char.id} sample={sample} script={sampleScript} />}
      <a
        className="sw-lab-link"
        href="https://www.haimian.com/create"
        target="_blank"
        rel="noopener noreferrer"
      >
        打开海绵音乐 ↗
      </a>
      <a className="sw-lab-link" href="https://nuomi-haimian.yanlue.workers.dev/music" target="_blank" rel="noopener noreferrer">打开音频文件上传测试页 ↗</a>
      <p className="sw-note">
        保存测试音频后，在上传测试页展开“上传朗读音频”，直接选择文件上传，无需外放录音。文件上传链路仍待实测；处理成功不代表歌唱音色完全相同，需要再试听成品确认。
      </p>
    </section>
  );
}
