import { beforeEach, it, expect, vi } from "vitest";
import { DB, openDB } from "./db";
import { momentsEngagement } from "../features/moments/engagement";
import { safeFetchJson } from "./safeApi";
import {
  runActivity,
  assessHabits,
  activityMaterial,
  reserveActivity,
  activityPrompt,
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
              actions: [{kind:"comment",postId:post.id,text:"这阵海风好舒服"}],
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

it('records ordinary posts and comments in one activity card without another API call',async()=>{
 await saveConfig(c=>{c.participants.a.habits.commentChance=1;});
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'comment',postId:post.id,text:'这阵海风真舒服。'}],post:{text:'买到了新鲜的番茄',theme:'买菜',media:[],visibility:{mode:'all',ids:[]}},important:[{postId:post.id,summary:'记下了海边的交流'}]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 const cards=(await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card');
 expect(cards).toHaveLength(1);expect(cards[0].content).toContain('这阵海风真舒服');expect(cards[0].content).toContain('买到了新鲜的番茄');expect(cards[0].metadata?.momentsPostIds).toHaveLength(2);expect(safeFetchJson).toHaveBeenCalledTimes(1);
 const {revisePost}=await import('../features/moments/revisions');
 await revisePost('user',post.id,null,true);
 const remaining=(await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card');expect(remaining).toHaveLength(1);expect(remaining[0].content).not.toContain('这阵海风真舒服');expect(remaining[0].content).toContain('买到了新鲜的番茄');
});
it('a plain like or browse creates no activity card',async()=>{
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'like',postId:post.id}],post:null,important:[]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});expect((await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card')).toHaveLength(0);
});
it('only actual first reading of a comment addressed to the actor creates a receipt card',async()=>{
 const own=await publish('a','阿青',{text:'周末散步',theme:'散步',media:[],visibility:{mode:'all',ids:[]}});
 await transaction(async s=>markSeen(s,await getConfig(s),'a',own),true);
 await interact('user','小雨',own.id,{kind:'comment',text:'一起去呀'});
 const m={id:100,charId:'a',role:'user',type:'text',content:'看看阿青的朋友圈',timestamp:Date.now()} as any;
 await prepareMomentsQuery('a',[m]);await prepareMomentsQuery('a',[m]);
 const cards=(await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card');expect(cards).toHaveLength(1);expect(cards[0].content).toContain('一起去呀');
});
it('queries five newest visible posts across same-person accounts, and binds results only to the latest user ID',async()=>{
 await DB.saveCharacter({id:'z',name:'张真源',memories:[]} as any);await DB.saveCharacter({id:'z2',name:'源',memories:[]} as any);
 await saveConfig(c=>{for(const id of ['z','z2'])c.participants[id]={...participantDefaults(),enabled:true};c.friends.push(['a','z']);});
 for(const text of ['早餐吃了刚烤好的面包','练琴时发现新的和弦走向','傍晚的云像一座岛','楼下小猫终于肯靠近了','刚读完一本推理小说','球赛加时看得我好紧张','咖啡还是不加糖好喝'])await publish('z','张真源',{text,theme:text,media:[],visibility:{mode:'all',ids:[]}});
 await publish('z2','源',{text:'不可见分身记录',theme:'生活',media:[],visibility:{mode:'all',ids:[]}});
 const m={id:200,charId:'a',role:'user',type:'text',content:'看看源源的朋友圈',timestamp:Date.now()} as any;
 await prepareMomentsQuery('a',[m,{...m,id:201,role:'assistant',content:'小雨的朋友圈'}]);
 const q=JSON.parse((await DB.getAsset('moments_query:a'))!);expect(JSON.parse(q.text.split('本轮已按权限实际读取：')[1])).toHaveLength(5);expect(q.text).not.toContain('不可见分身记录');
 expect((await chatMomentsContext('a',200)).dynamic).toContain('本轮朋友圈查看结果');expect((await chatMomentsContext('a',202)).dynamic).not.toContain('本轮朋友圈查看结果');
 await prepareMomentsQuery('a',[m,{...m,id:202,content:'今天吃什么'},{...m,id:203,role:'assistant',content:'源源的朋友圈'}]);expect(JSON.parse((await DB.getAsset('moments_query:a'))!).messageId).toBe(200);
});

it('observed incoming comments and likes record factual response state, with no card for likes alone',async()=>{
 const own=await publish('a','阿青',{text:'刚练完琴',theme:'音乐',media:[],visibility:{mode:'all',ids:[]}});
 await transaction(async s=>markSeen(s,await getConfig(s),'a',own),true);
 await interact('user','小雨',own.id,{kind:'like'});await interact('user','小雨',own.id,{kind:'comment',text:'好听！'});
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[own.id],actions:[],post:null,important:[]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 const snap=(await getRow<any>('snapshot:a')).text;expect(snap).toContain('已看到的点赞：小雨');expect(snap).toContain('本轮未新增评论或回复');expect(snap).toContain('好听！');
 const cards=(await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card');expect(cards).toHaveLength(1);expect(cards[0].content).toContain('本轮未新增评论或回复');
});
it('a char may ordinary-delete its own submitted comment, but not edit or delete someone else',async()=>{
 await interact('a','阿青',post.id,{kind:'comment',text:'自己的旧评论'});const source=(await getRow<Post>(post.id))!;
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'delete_comment',postId:post.id,commentId:source.comments[0].id}],post:null,important:[]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});expect((await getRow<Post>(post.id))!.comments[0].deletedAt).toBeTruthy();
});

it('rejects a conflicting reply recipient atomically without saving a misaddressed comment',async()=>{
 await saveConfig(c=>{c.friends=[['a','b']];});await interact('b','乙',post.id,{kind:'comment',text:'先试试看'});const parent=(await getRow<Post>(post.id))!.comments[0];
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'comment',postId:post.id,replyTo:parent.id,recipientId:'user',text:'小雨我还没试过呢'}],post:null,important:[]})}}]}));
 await expect(runActivity('a',{api:global,user:{name:'小雨'} as any})).rejects.toThrow('回复人物');
 expect((await getRow<Post>(post.id))!.comments).toHaveLength(1);expect((await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card')).toHaveLength(0);expect(safeFetchJson).toHaveBeenCalledTimes(1);
});

const noSocialAction = () => vi.mocked(safeFetchJson).mockImplementation(async (_url, options) => ({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[],post:null,important:[]})}}]}));
it('consumes a first read without interaction and does not retry it or a later like', async () => {
 noSocialAction();
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 expect(await getRow(`seen:a:${post.id}`)).toBeDefined();
 await saveConfig(c=>{c.participants.a.post=false;});
 expect(await reserveActivity('a',false)).toBeUndefined();
 await interact('user','小雨',post.id,{kind:'like'});
 // Drain old-version like-only pending events too.
 await transaction(async s=>{s.put({id:'legacy-like',kind:'event',owner:'a',at:Date.now(),postId:post.id,status:'pending',eventType:'like'});},true);
 expect(await reserveActivity('a',false)).toBeUndefined();
 expect((await getRow<any>('legacy-like')).status).toBe('done');
 expect(safeFetchJson).toHaveBeenCalledTimes(1);
});
it('lets the character consider both new comments, while committing at most one per non-owner round',async()=>{
 await interact('a','阿青',post.id,{kind:'comment',text:'我也喜欢海风'});
 let current=(await getRow<Post>(post.id))!;
 const own=current.comments[0];
 await transaction(async s=>markSeen(s,await getConfig(s),'a',current),true);
 await interact('user','小雨',post.id,{kind:'comment',replyTo:own.id,text:'下次一起？'});
 await interact('user','小雨',post.id,{kind:'comment',text:'这边还有贝壳'});
 current=(await getRow<Post>(post.id))!;
 const fresh=current.comments.filter(x=>x.id!==own.id);
 const allowed=momentsEngagement(current,'a',habitDefaults(),false,fresh.map(x=>x.id)).replyableCommentIds;
 expect(allowed).toEqual(fresh.map(x=>x.id));
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>{
  const request=promptRequest(options);
  expect(request.text).toContain('"firstView":false');
  expect(request.text).toContain('"directCommentIds":["'+fresh[0].id+'"]');
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:request.id,browsed:[post.id],actions:fresh.map((x,i)=>({kind:'comment',postId:post.id,replyTo:x.id,recipientId:'user',text:i?'贝壳也好看':'好呀，一起'})),post:null,important:[]})}}]};
 });
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 current=(await getRow<Post>(post.id))!;
 const ownComments=current.comments.filter(x=>x.authorId==='a');
 expect(ownComments).toHaveLength(2);
 expect(ownComments[1].replyTo).toBe(fresh[0].id);
 const seen=(await getRow<Seen>(`seen:a:${post.id}`))!;
 expect(seen.projection.comments.filter(x=>x.authorId==='a')).toHaveLength(ownComments.length);
 const cards=(await DB.getMessagesByCharId('a')).filter(x=>x.type==='moments_card');
 expect(cards.at(-1)?.content).toContain('好呀，一起');
 expect(cards.at(-1)?.content).not.toContain('贝壳也好看');
});
it('rejects reconsidering an old root comment when only a new comment arrived',async()=>{
 await transaction(async s=>markSeen(s,await getConfig(s),'a',post),true);
 await interact('user','小雨',post.id,{kind:'comment',text:'新内容'});
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'comment',postId:post.id,recipientId:'user',text:'重复考虑旧帖'}],post:null,important:[]})}}]}));
 await expect(runActivity('a',{api:global,user:{name:'小雨'} as any})).rejects.toThrow('已读动态只能回应本次新增评论');
 expect((await getRow<Post>(post.id))!.comments).toHaveLength(1);
});
it('preserves the shared thread cap when multiple new replies are submitted',async()=>{
 await interact('user','小雨',post.id,{kind:'comment',text:'根话题'});
 let p=(await getRow<Post>(post.id))!;const root=p.comments[0].id;
 for(let i=0;i<5;i++) await interact('user','小雨',post.id,{kind:'comment',text:'话题进展'+i,replyTo:root});
 p=(await getRow<Post>(post.id))!;
 const targets=p.comments.slice(-2);
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:targets.map(x=>({kind:'comment',postId:post.id,replyTo:x.id,recipientId:'user',text:'继续'})),post:null,important:[]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 const current=(await getRow<Post>(post.id))!;
 expect(current.comments.length).toBeGreaterThanOrEqual(6);
 expect(current.comments.length).toBeLessThanOrEqual(7); // six user replies may exhaust the topic
 expect((await getRow<Seen>(`seen:a:${post.id}`))!.projection.comments).toHaveLength(current.comments.length);
});
it('consumes closed-thread events without forcing the model to answer an unrelated root',async()=>{
 await interact('user','小雨',post.id,{kind:'comment',text:'旧话题'});
 let p=(await getRow<Post>(post.id))!; const root=p.comments[0].id;
 for(let i=0;i<6;i++) await interact('user','小雨',post.id,{kind:'comment',text:'旧回复'+i,replyTo:root});
 await interact('user','小雨',post.id,{kind:'comment',text:'新话题'});
 p=(await getRow<Post>(post.id))!; const fresh=p.comments.at(-1)!.id;
 const newTopicAllowed=momentsEngagement(p,'a',habitDefaults(),true,p.comments.map(x=>x.id)).replyableCommentIds.includes(fresh);
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:[{kind:'comment',postId:post.id,replyTo:root,recipientId:'user',text:'不应保存'},{kind:'comment',postId:post.id,replyTo:fresh,recipientId:'user',text:'新话题回应'}],post:null,important:[]})}}]}));
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 p=(await getRow<Post>(post.id))!;
 expect(p.comments.some(x=>x.text==='不应保存')).toBe(false);
 // A new unrelated root is not guaranteed an answer, even when the model asks to respond.
 expect(p.comments.some(x=>x.text==='新话题回应')).toBe(newTopicAllowed);
 expect((await getRow<Seen>(`seen:a:${post.id}`))!.projection.comments).toHaveLength(p.comments.length);
 expect((await rows('event','a')).filter(x=>(x as any).status==='pending')).toHaveLength(0);
 expect((await rows('log','a')).map(x=>(x as any).text).join('\n')).toContain('跳过已收束话题'+(newTopicAllowed?'1':'2')+'条');
});

it("a post owner may select only two replies from a busy new-comment batch", async () => {
  await saveConfig(c => { c.friends.push(["a", "b"]); });
  const ownPost = await publish("a", "阿青", {
    text: "刚下班，今天有点忙", theme: "晚间",
    media: [], visibility: { mode: "all", ids: [] },
  });
  for (let i=0;i<3;i++)
    await interact("b", "乙", ownPost.id, {kind:"comment",text:"我有件不同的事想聊"+i});
  const roots = (await getRow<Post>(ownPost.id))!.comments;
  vi.mocked(safeFetchJson).mockImplementation(async (_url, options) => ({
    choices: [{finish_reason:"stop",message:{content:JSON.stringify({
      requestId:promptRequest(options).id,
      browsed:[ownPost.id],
      actions:roots.map((row,i)=>({kind:"comment",postId:ownPost.id,
        replyTo:row.id,recipientId:"b",text:"第"+i+"件我听见了"})),
      post:null,important:[],
    })}}],
  }));
  await runActivity("a",{api:global,user:{name:"小雨"} as any});
  const actual=(await getRow<Post>(ownPost.id))!.comments;
  expect(actual.filter(c=>c.authorId==="a")).toHaveLength(2);
  expect(actual.filter(c=>c.authorId==="a").map(c=>c.replyTo)).toEqual([roots[0].id,roots[1].id]);
  expect(safeFetchJson).toHaveBeenCalledTimes(1);
});

it('new activity cards retain only the replied ancestor chain while snapshots retain the full witnessed discussion',async()=>{
 await saveConfig(c=>{c.friends=[['a','b']];});
 await transaction(async s=>{
  const p=(await getRow<Post>(post.id,s))!;
  const root=(id:string,text:string)=>({id,authorId:'b',name:'E或其他好友',text,at:Date.now()});
  const answer=(id:string,replyTo:string)=>({id,authorId:'user',name:'帖主A',text:'A-reply-'+replyTo,replyTo,at:Date.now()});
  p.comments=[root('chain-b','unrelated-B'),root('chain-c','unrelated-C'),root('chain-d','unrelated-D'),root('chain-e','E-comment'),answer('chain-ab','chain-b'),answer('chain-ac','chain-c'),answer('chain-ad','chain-d'),answer('chain-ae','chain-e')];
  p.revision++;s.put(p);
 },true);
 vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>{
  const request=promptRequest(options);
  return {choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:request.id,browsed:[post.id],actions:[{kind:'comment',postId:post.id,replyTo:'chain-ae',recipientId:'user',text:'F-reply-A'}],post:null,important:[]})}}]};
 });
 await runActivity('a',{api:global,user:{name:'小雨'} as any});
 const cards=(await DB.getMessagesByCharId('a')).filter(x=>x.type==='moments_card');
 expect(cards).toHaveLength(1);
 const part=(cards[0].metadata as any).momentsActivityParts[0];
 expect(part.post.comments.map((x:any)=>x.text)).toEqual(['E-comment','A-reply-chain-e','F-reply-A']);
 for(const x of ['unrelated-B','unrelated-C','unrelated-D','A-reply-chain-b'])expect(cards[0].content).not.toContain(x);
 const snapshot=await getRow<any>('snapshot:a');expect(snapshot.text).toContain('unrelated-B');
});

it('a model important flag cannot turn a plain browse or like into a new private-chat activity card',async()=>{
 for(const liked of [false,true]){
  vi.mocked(safeFetchJson).mockImplementation(async(_url,options)=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify({requestId:promptRequest(options).id,browsed:[post.id],actions:liked?[{kind:'like',postId:post.id}]:[],post:null,important:[{postId:post.id,summary:'模型把普通见闻再次标为重要'}]})}}]}));
  if(liked)await interact('user','小雨',post.id,{kind:'comment',text:'只有别人之间的讨论'});
  await runActivity('a',{api:global,user:{name:'小雨'} as any});
  expect((await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card')).toHaveLength(0);
 }
 expect(await getRow(`seen:a:${post.id}`)).toBeTruthy();expect((await getRow<any>('snapshot:a')).text).toContain('今天去海边');
});
it('importance does not resurrect an already-read reply on a later posting opportunity',async()=>{
 const own=await publish('a','阿青',{text:'新买了一盆小绿植',media:[],visibility:{mode:'all',ids:[]},theme:'绿植'});
 await interact('user','小雨',own.id,{kind:'comment',text:'记得浇水呀'});
 const {markCallSent,applyActivity}=await import('../features/moments/runtime');
 const first=(await reserveActivity('a',false))!;await markCallSent(first.call.id);await applyActivity(first,{requestId:first.call.id,browsed:[own.id],actions:[],post:null,important:[{postId:own.id,summary:'第一次实际读到提醒'}]},actor);
 const before=(await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card');expect(before).toHaveLength(1);
 const second=(await reserveActivity('a',false))!;await markCallSent(second.call.id);
 // Re-read the same witnessed material in a valid reserved round: no new comment was created.
 second.posts=first.posts;
 await applyActivity(second,{requestId:second.call.id,browsed:[own.id],actions:[],post:null,important:[{postId:own.id,summary:'又觉得这件事重要'}]},actor);
 expect((await DB.getMessagesByCharId('a')).filter(m=>m.type==='moments_card')).toHaveLength(1);
});
