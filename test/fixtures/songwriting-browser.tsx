import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { OSPreviewProvider } from "../../context/OSContext";
import SongwritingStudio from "../../components/song/SongwritingStudio";
import { DB } from "../../utils/db";
import { getSong, writeTurn } from "../../features/songwriting/storage";
import {
  parseLyrics,
  type StudioTheme,
} from "../../features/songwriting/model";
import type { SongSheet } from "../../types";
const char = {
  id: "sw-qa",
  name: "阿源",
  systemPrompt: "你是温柔又有主见的阿源。",
  memories: [],
  activeMemoryMonths: [],
  refinedMemories: {},
  contextRangePolicyVersion: 1,
  contextRangeMode: "manual",
  contextLimit: 100,
};
await DB.saveCharacter(char as any);
let song: SongSheet;
try {
  song = await getSong("sw-browser");
} catch {
  song = {
    id: "sw-browser",
    title: "月亮寄来的信",
    subtitle: "留一小片海，给还没唱完的明天",
    genre: "folk",
    mood: "dreamy",
    collaboratorId: char.id,
    lines: parseLyrics(
      "[verse]\n你把月光折成一封信\n寄给睡在海边的星星\n[chorus]\n等风吹过你温柔的眼睛\n我就唱起那天未完的旋律",
      "user",
    ),
    comments: [],
    status: "draft",
    coverStyle: "forest",
    createdAt: 1,
    lastActiveAt: 1,
  };
  await DB.saveSong(song);
  await writeTurn(song, "user", "第二段可以更温柔一点吗？", "seed-user");
  await writeTurn(
    song,
    "assistant",
    "可以呀，把告别写成一阵慢慢经过的海风，好不好？",
    "seed-assistant",
  );
}
function Harness() {
  const [theme, setTheme] = useState<StudioTheme>("moon-sheep");
  return (
    <OSPreviewProvider
      value={
        {
          characters: [char],
          apiConfig: {
            baseUrl: "https://qa-songwriting.invalid/v1",
            apiKey: "TEST-ONLY",
            model: "qa-model",
          },
          userProfile: { name: "你" },
          groups: [],
          realtimeConfig: {},
          addToast: () => {},
          closeApp: () => {},
          lastMsgTimestamp: 0,
        } as any
      }
    >
      <SongwritingStudio
        song={song}
        theme={theme}
        onTheme={setTheme}
        onBack={() => {}}
        onPreview={() => {}}
      />
    </OSPreviewProvider>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
(window as any).__songwritingQA = { DB, getSong };
