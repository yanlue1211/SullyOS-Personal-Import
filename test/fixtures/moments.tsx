import React from "react";
import { createRoot } from "react-dom/client";
import { OSPreviewProvider } from "../../context/OSContext";
import { DB } from "../../utils/db";
import MomentsApp from "../../apps/MomentsApp";
import {
  saveConfig,
  publish,
  interact,
  getConfig,
} from "../../features/moments/storage";
import { participantDefaults } from "../../features/moments/schema";
import type { CharacterProfile } from "../../types";
// Isolated localhost fixture: synthetic data only. No scheduler or model request.
const chars = ["D", "E", "F", "G", "H", "I", "A", "B", "C"].map(
  (name, i) =>
    ({
      id: "mm-preview-" + name,
      name,
      avatar: ["🌿", "☀️", "🌼", "☕", "🌙", "🌊", "🐶", "🐈", "🍃"][i],
      systemPrompt: "示例角色",
      memories: [],
      mountedWorldbooks: [],
    }) as unknown as CharacterProfile,
);
for (const c of chars) await DB.saveCharacter(c);
await DB.saveUserProfile({ name: "小雨", avatar: "🌻" } as any);
if (!(await getConfig()).revision) {
  await saveConfig((c) => {
    c.enabled = true;
    for (const char of chars)
      c.participants[char.id] = { ...participantDefaults(), enabled: true };
    const six = chars.slice(0, 6);
    for (const a of six)
      for (const b of six) if (a.id < b.id) c.friends.push([a.id, b.id]);
    for (const x of chars.slice(6, 8))
      for (const y of six) c.friends.push([x.id, y.id]);
    c.friends.push([chars[8].id, chars[6].id], [chars[8].id, chars[0].id]);
  });
  const p = await publish(
    "user",
    "小雨",
    {
      text: "太阳落下之前，刚好走到这里。",
      theme: "",
      visibility: { mode: "all", ids: [] },
      media: [
        {
          kind: "image",
          virtual: true,
          description:
            "河堤上的一排树，叶子被夕阳照得透明。远处有两个人牵着狗慢慢走，水面是浅金色。",
        },
        {
          kind: "image",
          virtual: true,
          description:
            "一杯喝到一半的冰拿铁放在长椅旁，杯壁凝着细小水珠，后面是落日。",
        },
      ],
    },
    "mm-fixture-user",
  );
  await interact(chars[6].id, "A", p.id, {
    kind: "comment",
    text: "这个时间的光真好。",
    id: "mm-root",
  });
  await interact(chars[8].id, "C", p.id, {
    kind: "comment",
    text: "对，我也喜欢第二张。",
    replyTo: "mm-root",
    id: "mm-c",
  });
  await interact(chars[7].id, "B", p.id, { kind: "like" });
  await publish(
    chars[0].id,
    "D",
    {
      text: "早起多出来的十分钟，用来吃一碗热面。",
      theme: "早餐",
      visibility: { mode: "all", ids: [] },
      media: [],
    },
    "mm-fixture-d",
  );
  await publish(
    chars[6].id,
    "A",
    {
      text: "今天的风，适合把窗户再开大一点。",
      theme: "天气",
      visibility: { mode: "all", ids: [] },
      media: [
        {
          kind: "video",
          virtual: true,
          description:
            "窗边的白纱帘被风轻轻吹起，几片树影摇晃在木地板上。镜头缓慢移向窗外，街角有人骑车经过。",
        },
      ],
    },
    "mm-fixture-a",
  );
}
createRoot(document.getElementById("root")!).render(
  <OSPreviewProvider
    value={
      {
        characters: chars,
        userProfile: { name: "小雨", avatar: "🌻" },
        apiConfig: {},
        realtimeConfig: {},
        closeApp() {},
      } as any
    }
  >
    <MomentsApp />
  </OSPreviewProvider>,
);
