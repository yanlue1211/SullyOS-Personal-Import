import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { DB, openDB } from "./db";
import type { SongSheet } from "../types";
import {
  createProposal,
  parseLyrics,
  lyricsText,
  lyricFingerprint,
} from "../features/songwriting/model";
import {
  acceptProposal,
  commitStudioReply,
  completeSong,
  getSong,
  saveProposal,
  writeTurn,
  studioMessages,
} from "../features/songwriting/storage";
import {
  generateStudioReply,
  parseStudioReply,
} from "../features/songwriting/generate";
import { formatMessageForPrompt } from "./messageFormat";
import * as palace from "./memoryPalace/pipeline";
vi.mock("./activeMsgRuntime", () => ({
  prepareInboxBeforeChat: vi.fn(async () => {}),
}));
let song: SongSheet;
beforeEach(async () => {
  localStorage.clear();
  const db = await openDB();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(["songs", "messages", "characters"], "readwrite");
    for (const n of ["songs", "messages", "characters"])
      tx.objectStore(n).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  song = {
    id: "test-song",
    title: "海边的小羊",
    genre: "folk",
    mood: "dreamy",
    collaboratorId: "a",
    lines: parseLyrics("[verse]\n第一句\n第二句\n[chorus]\n原来的副歌", "user"),
    comments: [],
    status: "draft",
    coverStyle: "forest",
    createdAt: 1,
    lastActiveAt: 1,
  };
  await DB.saveSong(song);
  await DB.saveCharacter({
    id: "a",
    name: "阿源",
    systemPrompt: "温柔有主见的人设标记",
    contextRangePolicyVersion: 1,
    contextRangeMode: "manual",
    contextLimit: 100,
    mountedWorldbooks: [
      {
        id: "wb",
        title: "海岸设定",
        content: "世界书标记",
        constant: true,
        position: 1,
      },
    ],
    dialogueApi: {
      baseUrl: "https://char.invalid/v1",
      apiKey: "CHAR",
      model: "char-model",
    },
  } as any);
  await DB.saveCharacter({ id: "b", name: "别人" } as any);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
const proposal = () =>
  createProposal(
    song,
    "section",
    "修改主歌",
    0,
    2,
    parseLyrics("[verse]\n修改后第一句\n修改后第二句\n第三句", "a"),
    "a",
  );
it("discussion is saved once with real user/assistant identities and complete text", async () => {
  await Promise.all([
    writeTurn(song, "user", "我觉得情绪不太对", "u1"),
    writeTurn(song, "user", "我觉得情绪不太对", "u1"),
  ]);
  await writeTurn(song, "assistant", "是情绪不对，还是歌词太直白？", "a1");
  const rows = await studioMessages(song);
  expect(rows).toHaveLength(2);
  expect(rows.map((m) => m.role)).toEqual(["user", "assistant"]);
  expect((await getSong(song.id)).comments).toEqual([]);
  expect(rows.every((m) => !m.metadata.songwritingCard)).toBe(true);
});
it("proposal persists without changing lyrics or producing a card", async () => {
  const p = proposal();
  await saveProposal(song.id, p);
  expect((await getSong(song.id)).lyricProposal?.id).toBe(p.id);
  expect((await getSong(song.id)).lines).toEqual(song.lines);
  expect(await studioMessages(song)).toHaveLength(0);
});
it("one batch edit atomically creates one version and one readable card; concurrent retries deduplicate", async () => {
  const p = proposal();
  await Promise.all([
    acceptProposal(song.id, p, "阿源"),
    acceptProposal(song.id, p, "阿源"),
  ]);
  const next = await getSong(song.id);
  expect(next.lyricRevisions).toHaveLength(1);
  expect(next.lines).toHaveLength(4);
  expect(next.lines.at(-1)?.content).toBe("原来的副歌");
  const rows = await studioMessages(song);
  expect(rows).toHaveLength(1);
  expect(rows[0].metadata.songwritingCard.before).toContain("第一句");
  expect(formatMessageForPrompt(rows[0], "阿源", "User")).toContain(
    "修改后第二句",
  );
  expect(rows[0].id).toBe(next.lyricRevisions?.[0].cardId);
});
it("cancelled candidates and no-op manual saves create no cards", async () => {
  await saveProposal(song.id, proposal());
  await saveProposal(song.id, undefined);
  const p = createProposal(
    song,
    "song",
    "不变",
    0,
    3,
    parseLyrics(lyricsText(song.lines), "user"),
    "user",
  );
  await acceptProposal(song.id, p, "我");
  expect(await studioMessages(song)).toHaveLength(0);
  expect((await getSong(song.id)).lyricRevisions).toBeUndefined();
});
it("stale candidates cannot overwrite a newer lyric version", async () => {
  const old = proposal();
  await acceptProposal(song.id, proposal(), "阿源");
  await expect(acceptProposal(song.id, old, "阿源")).rejects.toThrow(
    "别处更新",
  );
  expect((await getSong(song.id)).lyricRevisions).toHaveLength(1);
  expect(await studioMessages(song)).toHaveLength(1);
});
it("out-of-range edits and failed transactions preserve both song and message stream", async () => {
  const p = { ...proposal(), start: 99 };
  await expect(acceptProposal(song.id, p, "阿源")).rejects.toThrow();
  expect((await getSong(song.id)).lines).toEqual(song.lines);
  expect(await studioMessages(song)).toHaveLength(0);
});
it("completion is deduplicated across retries; a later actual edit can be completed again", async () => {
  await Promise.all([
    completeSong(song.id, "双方"),
    completeSong(song.id, "双方"),
  ]);
  expect(await studioMessages(song)).toHaveLength(1);
  await acceptProposal(song.id, proposal(), "阿源");
  await completeSong(song.id, "双方");
  expect(await studioMessages(song)).toHaveLength(3);
});
it("restoring a prior version is a new operation, preserving history", async () => {
  await acceptProposal(song.id, proposal(), "阿源");
  const current = await getSong(song.id);
  const restore = createProposal(
    current,
    "song",
    "恢复",
    0,
    current.lines.length,
    song.lines,
    "user",
  );
  await acceptProposal(song.id, restore, "我");
  expect(lyricsText((await getSong(song.id)).lines)).toBe(
    lyricsText(song.lines),
  );
  expect((await getSong(song.id)).lyricRevisions).toHaveLength(2);
});
it("song and character filters preserve one underlying message stream", async () => {
  await writeTurn(song, "user", "当前歌曲", "1");
  await DB.saveMessage({
    charId: "a",
    role: "user",
    type: "text",
    content: "普通聊天",
  });
  await DB.saveMessage({
    charId: "b",
    role: "user",
    type: "text",
    content: "其他人隐私",
  });
  expect(await studioMessages(song)).toHaveLength(1);
  expect(await studioMessages(song, true)).toHaveLength(2);
});
it("structured generation validates exact line and paragraph ranges without enforcing four lines", () => {
  const result = parseStudioReply(
    JSON.stringify({
      reply: "这样怎么样？",
      proposal: {
        scope: "section",
        label: "主歌",
        start: 0,
        deleteCount: 2,
        lines: Array.from({ length: 6 }, (_, i) => ({
          section: "verse",
          content: "新句" + i,
        })),
      },
    }),
    song,
    { scope: "section", start: 0, deleteCount: 2, section: "verse" },
  );
  expect(result.proposal?.lines).toHaveLength(6);
  expect(() => parseStudioReply('{"reply":"残缺', song)).toThrow();
  expect(() =>
    parseStudioReply(
      JSON.stringify({
        reply: "改好了",
        proposal: {
          scope: "song",
          label: "偷改全部",
          start: 0,
          deleteCount: 3,
          lines: [],
        },
      }),
      song,
      { scope: "line", start: 1, deleteCount: 1, section: "verse" },
    ),
  ).toThrow("指定修改范围");
});
it("actual request includes current ordinary chat, source discussion, role/worldbooks and selected character API", async () => {
  await DB.saveMessage({
    charId: "a",
    role: "user",
    type: "text",
    content: "共同经历标记",
  });
  await writeTurn(song, "user", "想写一首关于灯塔的歌", "last");
  await DB.saveMessage({
    charId: "b",
    role: "user",
    type: "text",
    content: "不应读取的其他人",
  });
  const fetcher = vi.fn(
    async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: '{"reply":"那就从灯塔开始写。","proposal":null}',
              },
            },
          ],
        }),
      ),
  );
  vi.stubGlobal("fetch", fetcher);
  vi.spyOn(palace, "injectMemoryPalace").mockImplementation(async (char) => {
    char.memoryPalaceInjection = "召回标记";
    return { stages: [] } as any;
  });
  const result = await generateStudioReply(
    song,
    {
      api: {
        baseUrl: "https://global.invalid/v1",
        apiKey: "GLOBAL",
        model: "global",
      } as any,
      user: { name: "User" } as any,
      context: { groups: [], emojis: [], categories: [] },
    },
    new AbortController().signal,
  );
  expect(result.reply).toContain("灯塔");
  const [url, options] = fetcher.mock.calls[0] as any;
  expect(url).toContain("char.invalid");
  expect(options.headers.Authorization).toBe("Bearer CHAR");
  const body = JSON.parse(options.body);
  expect(body.model).toBe("char-model");
  const sent = JSON.stringify(body.messages);
  for (const marker of [
    "共同经历标记",
    "灯塔",
    "世界书标记",
    "人设标记",
    "海边的小羊",
  ])
    expect(sent).toContain(marker);
  expect(sent).not.toContain("不应读取的其他人");
});
it("stopped or truncated responses never produce a candidate", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                finish_reason: "length",
                message: { content: '{"reply":"截断","proposal":null}' },
              },
            ],
          }),
        ),
    ),
  );
  await expect(
    generateStudioReply(
      song,
      {
        api: { baseUrl: "https://a.invalid/v1", model: "m" } as any,
        user: { name: "我" } as any,
        context: { groups: [], emojis: [], categories: [] },
      },
      new AbortController().signal,
    ),
  ).rejects.toThrow("截断");
  expect((await getSong(song.id)).lines).toEqual(song.lines);
});
it("song revisions, proposal and canonical messages round trip through existing backup", async () => {
  const p = proposal();
  await acceptProposal(song.id, p, "阿源");
  const current = await getSong(song.id);
  await saveProposal(
    song.id,
    createProposal(
      current,
      "line",
      "下一句",
      0,
      1,
      parseLyrics("新候选", "a"),
      "a",
    ),
  );
  await writeTurn(song, "user", "完整原文", "backup");
  const backup = await DB.exportFullData();
  expect(
    backup.songs?.find((s) => s.id === song.id)?.lyricRevisions,
  ).toHaveLength(1);
  await DB.importFullData(backup as any);
  const restored = await getSong(song.id);
  expect(restored.lyricProposal?.label).toBe("下一句");
  expect(restored.lyricRevisions).toHaveLength(1);
  expect(
    (await studioMessages(song)).some((m) => m.content === "完整原文"),
  ).toBe(true);
});
it("chat confirmation must reference the exact pending proposal, never a stale or unrelated one", async () => {
  const p = proposal();
  song = await saveProposal(song.id, p);
  expect(
    parseStudioReply(
      JSON.stringify({
        reply: "那就用这一版。",
        proposal: null,
        confirmProposalId: p.id,
      }),
      song,
    ).confirmedProposalId,
  ).toBe(p.id);
  expect(() =>
    parseStudioReply(
      JSON.stringify({
        reply: "保存",
        proposal: null,
        confirmProposalId: "wrong-id",
      }),
      song,
    ),
  ).toThrow("已变化");
});

it("reply and candidate commit together, and repeated response saves do not replace the original candidate", async () => {
  const p = proposal();
  await Promise.all([
    commitStudioReply(song.id, "reply1", "我写好一版候选了", p),
    commitStudioReply(song.id, "reply1", "迟到的不同内容", p),
  ]);
  expect(await studioMessages(song)).toHaveLength(1);
  expect((await getSong(song.id)).lyricProposal?.id).toBe(p.id);
  const current = await getSong(song.id);
  await acceptProposal(song.id, p, "阿源");
  await expect(
    commitStudioReply(song.id, "reply2", "过期候选", p),
  ).rejects.toThrow("歌词已更新");
  expect(
    (await studioMessages(song)).some((m) => m.content === "过期候选"),
  ).toBe(false);
});
