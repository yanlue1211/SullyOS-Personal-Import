import { beforeEach, it, expect, vi } from "vitest";
import { DB, openDB } from "./db";
import { safeFetchJson } from "./safeApi";
import {
  runActivity,
  assessHabits,
  activityMaterial,
} from "../features/moments/runtime";
import {
  saveConfig,
  publish,
  rows,
  getRow,
  transaction,
  getConfig,
  markSeen,
  refreshSnapshot,
  interact,
} from "../features/moments/storage";
import {
  participantDefaults,
  habitDefaults,
  type Post,
  type Call,
  type Activity,
  type Seen,
} from "../features/moments/schema";
import {
  chatMomentsContext,
  prepareMomentsQuery,
} from "../features/moments/bridge";
import {
  exportMoments,
  validateMomentsBackup,
} from "../features/moments/backup";
vi.mock("./safeApi", async (original) => ({
  ...(await original<any>()),
  safeFetchJson: vi.fn(),
}));
const actor = {
  id: "a",
  name: "阿青",
  memories: [],
  mountedWorldbooks: [],
  systemPrompt: "甲的独立人设",
  dialogueApi: {
    baseUrl: "https://actor.invalid/v1",
    apiKey: "actor-key",
    model: "actor-model",
  },
  timeAwarenessEnabled: false,
} as any;
const global = {
  baseUrl: "https://global.invalid/v1",
  apiKey: "global-key",
  model: "global-model",
} as any;
let post: Post;
beforeEach(async () => {
  vi.restoreAllMocks();
  vi.mocked(safeFetchJson).mockReset();
  await DB.deleteDB();
  localStorage.clear();
  await DB.saveCharacter(actor);
  await DB.saveCharacter({
    id: "b",
    name: "乙",
    memories: [],
    mountedWorldbooks: [],
    systemPrompt: "B的秘密人设",
  } as any);
  await DB.saveUserProfile({ name: "小雨" } as any);
  await DB.saveMessage({
    charId: "b",
    role: "user",
    type: "text",
    content: "B的私人秘密资料",
  } as any);
  await saveConfig((c) => {
    c.enabled = true;
    c.participants.a = {
      ...participantDefaults(),
      enabled: true,
      habits: { ...habitDefaults(), quietStart: 0, quietEnd: 0 },
    };
    c.participants.b = { ...participantDefaults(), enabled: true };
  });
  post = await publish("user", "小雨", {
    text: "今天去海边，风很轻",
    theme: "",
    media: [],
    visibility: { mode: "all", ids: [] },
  });
});
const promptRequest = (options: any) => {
  const body = JSON.parse(String(options.body)),
    text = body.messages
      .map((m: any) =>
        typeof m.content === "string" ? m.content : JSON.stringify(m.content),
      )
      .join("\n");
  return { body, text, id: text.match(/"requestId":"([^"]+)"/)?.[1] };
};
it("sends one real payload using the actor credentials and no other character private history", async () => {
  vi.mocked(safeFetchJson).mockImplementation(async (_url, options) => {
    const { id } = promptRequest(options);
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              requestId: id,
              browsed: [post.id],
              actions: [{ kind: "like", postId: post.id }],
              post: null,
              important: [],
            }),
          },
          finish_reason: "stop",
        },
      ],
    };
  });
  await runActivity("a", { api: global, user: { name: "小雨" } as any });
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
  const call = vi.mocked(safeFetchJson).mock.calls[0],
    p = promptRequest(call[1]);
  expect(call[0]).toBe("https://actor.invalid/v1/chat/completions");
  expect(p.body.model).toBe("actor-model");
  expect(JSON.stringify(call[1]?.headers)).toContain("actor-key");
  expect(p.text).toContain("甲的独立人设");
  expect(p.text).not.toContain("B的私人秘密资料");
  expect(p.text).not.toContain("B的秘密人设");
  expect((await getRow<Post>(post.id))?.likes[0].authorId).toBe("a");
  expect((await rows<Call>("call"))[0].phase).toBe("success");
});
it("counts one failed provider attempt without consuming browsing events or immediately retrying", async () => {
  vi.mocked(safeFetchJson).mockRejectedValue(Error("模拟失败"));
  await expect(
    runActivity("a", { api: global, user: { name: "小雨" } as any }),
  ).rejects.toThrow("模拟失败");
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
  expect((await rows<Call>("call"))[0].phase).toBe("failed");
  expect(await getRow(`seen:a:${post.id}`)).toBeUndefined();
  expect((await getConfig()).lease).toBeUndefined();
});
it("a generated post never creates matching comments from other actors in the same call", async () => {
  vi.mocked(safeFetchJson).mockImplementation(async (_url, options) => {
    const { id } = promptRequest(options);
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              requestId: id,
              browsed: [],
              actions: [],
              post: {
                text: "晚饭后的散步",
                theme: "散步",
                media: [],
                visibility: { mode: "all", ids: [] },
              },
              important: [
                { postId: "new", summary: "我分享了一次重要的散步经历" },
              ],
            }),
          },
          finish_reason: "stop",
        },
      ],
    };
  });
  await runActivity("a", { api: global, user: { name: "小雨" } as any });
  const p = (await rows<Post>("post", "a"))[0];
  expect(p.comments).toEqual([]);
  expect(await DB.getRecentMessagesByCharId("a", 10)).toHaveLength(1);
  expect(await DB.getRecentMessagesByCharId("b", 10)).toHaveLength(1);
  validateMomentsBackup(await exportMoments(await openDB()));
});
it("assesses sleep and exceptions once, returning a reviewable suggestion without applying it", async () => {
  const h = {
    ...habitDefaults("quiet", "active"),
    quietStart: 2,
    quietEnd: 10,
    lateNightChance: 0.06,
    lateChatChance: 0.4,
    reason: "习惯晚睡但发布很少",
  };
  vi.mocked(safeFetchJson).mockResolvedValue({
    choices: [
      { message: { content: JSON.stringify(h) }, finish_reason: "stop" },
    ],
  });
  expect(
    await assessHabits("a", { api: global, user: { name: "小雨" } as any }),
  ).toEqual(h);
  expect((await getConfig()).participants.a.habits.quietEnd).toBe(0);
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
  expect(
    promptRequest(vi.mocked(safeFetchJson).mock.calls[0][1]).text,
  ).toContain("lateChatChance");
});
it("does not expose later comments when retrieving an already browsed historical post", async () => {
  await transaction(async (s) => {
    const c = await getConfig(s);
    await markSeen(s, c, "a", post);
    await refreshSnapshot(s, c, "a");
  }, true);
  await interact("user", "小雨", post.id, {
    kind: "comment",
    text: "后来评论才写下的文字",
  });
  const m = {
    id: 8,
    charId: "a",
    role: "user",
    type: "text",
    content: "我的朋友圈呢",
    timestamp: Date.now(),
  } as any;
  await prepareMomentsQuery("a", [{ ...m, content: "小雨的朋友圈呢" }]);
  expect((await chatMomentsContext("a", 8)).dynamic).not.toContain(
    "后来评论才写下",
  );
});
it("bounds long activity material while retaining reply ancestors and original source records", async () => {
  let p = {
    ...post,
    text: "长".repeat(4000),
    comments: Array.from({ length: 100 }, (_, i) => ({
      id: "r" + i,
      authorId: "user",
      name: "小雨",
      text: "评论".repeat(500),
      at: Date.now(),
      ...(i % 7 ? { replyTo: "r" + (i - 1) } : {}),
    })),
  };
  const material = activityMaterial(p);
  expect(JSON.stringify(material).length).toBeLessThan(16000);
  expect(p.text.length).toBe(4000);
  for (const c of material.comments)
    if (c.replyTo)
      expect(material.comments.some((x) => x.id === c.replyTo)).toBe(true);
});
it("round-trips through the real full export/import entry point and resets old packages safely", async () => {
  await transaction(async (s) => {
    const c = await getConfig(s);
    await markSeen(s, c, "a", post);
    await refreshSnapshot(s, c, "a");
  }, true);
  const data = await DB.exportFullData();
  expect(data.momentsRecords).toBeDefined();
  const old = structuredClone(data);
  delete old.momentsRecords;
  await saveConfig((c) => {
    c.enabled = false;
  });
  await DB.importFullData(data as any);
  expect((await getConfig()).enabled).toBe(true);
  expect(await getRow(`seen:a:${post.id}`)).toBeDefined();
  await DB.importFullData(old as any);
  expect((await getConfig()).enabled).toBe(false);
  expect(await rows("post")).toEqual([]);
});

it.each([{ownMax:16384,globalMax:9000,expected:16384},{ownMax:undefined,globalMax:24576,expected:24576}])('preserves heavy character context and respects configured output tokens ($expected)',async({ownMax,globalMax,expected})=>{
  const heavy='完整人设与上下文。'.repeat(12000);
  await DB.saveCharacter({...actor,systemPrompt:heavy,dialogueApi:{...actor.dialogueApi,maxTokens:ownMax}});
  vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[],actions:[],post:null,important:[]})}}]}));
  await runActivity('a',{api:{...global,maxTokens:globalMax},user:{name:'小雨'} as any});
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
  const request=promptRequest(vi.mocked(safeFetchJson).mock.calls[0][1]);
  expect(request.text.includes(heavy)).toBe(true);
  expect(request.body.max_tokens).toBe(expected);
  expect((await rows<Call>('call'))[0].phase).toBe('success');
});

it("posting has an independent opportunity when browsing is not due or has zero frequency", async () => {
  await saveConfig((c) => {
    c.participants.a.habits.browsesPerDay = 0;
  });
  const next = Date.now() + 86400000;
  await transaction(async (s) => {
    s.put({
      id: "activity:a",
      kind: "activity",
      owner: "a",
      at: Date.now(),
      nextAt: next,
      postDue: 0,
      lastPost: 0,
    } satisfies Activity);
  }, true);
  const { reserveActivity, markCallSent, applyActivity } = await import(
    "../features/moments/runtime"
  );
  const task = (await reserveActivity("a", true))!;
  expect(task.canPost).toBe(true);
  expect(task.browseOpportunity).toBe(false);
  expect(task.posts).toEqual([]);
  await markCallSent(task.call.id);
  await applyActivity(
    task,
    {
      requestId: task.call.id,
      browsed: [],
      actions: [],
      post: null,
      important: [],
    },
    actor,
  );
  expect((await getRow<Activity>("activity:a"))?.nextAt).toBe(next);
});

it("important event cards include only the submitted comment material, not unread old replies", async () => {
  await transaction(async (s) => {
    const p = (await getRow<Post>(post.id, s))!;
    p.comments = Array.from({ length: 20 }, (_, i) => ({
      id: "old-" + i,
      authorId: "user",
      name: "小雨",
      text: i === 0 ? "最早未提交的评论秘密" : "最近可读评论" + i,
      at: Date.now(),
    }));
    p.revision++;
    s.put(p);
  }, true);
  vi.mocked(safeFetchJson).mockImplementation(async (_url, options) => {
    const { id, text } = promptRequest(options);
    expect(text).not.toContain("最早未提交的评论秘密");
    return {
      choices: [
        {
          message: {
            content: JSON.stringify({
              requestId: id,
              browsed: [post.id],
              actions: [],
              post: null,
              important: [{ postId: post.id, summary: "读到了一段重要的交流" }],
            }),
          },
          finish_reason: "stop",
        },
      ],
    };
  });
  await runActivity("a", { api: global, user: { name: "小雨" } as any });
  expect(
    (await DB.getRecentMessagesByCharId("a", 10))[0].content,
  ).not.toContain("最早未提交的评论秘密");
});
it('allows a character to delete only its own submitted historical post during one normal call',async()=>{
 const own=await publish('a','阿青',{text:'昨晚赌气写下的话，今天不想留着。',media:[],visibility:{mode:'all',ids:[]},theme:'昨夜'});
 const {reserveActivity,markCallSent,applyActivity}=await import('../features/moments/runtime');
 const task=(await reserveActivity('a',false))!;expect(task.history.some(p=>p.id===own.id)).toBe(true);await markCallSent(task.call.id);
 await applyActivity(task,{requestId:task.call.id,browsed:[],actions:[{kind:'delete',postId:own.id}],post:null,important:[]},actor);
 expect((await getRow<Post>(own.id))?.deletedAt).toBeTypeOf('number');
 expect((await rows<Call>('call'))[0].phase).toBe('success');
});
