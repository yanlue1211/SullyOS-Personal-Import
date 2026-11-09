import {expect,it} from "vitest";
import {habitDefaults,type Post} from "../features/moments/schema";
import {
  momentsEngagement, momentsOpportunityRoll, momentsCommentDepth,
  MAX_MOMENTS_AUTO_COMMENTS,
} from "../features/moments/engagement";

const habits=habitDefaults();
const post=(id="moment"):Post=>({
  id,kind:"post",owner:"owner",name:"A",at:1,text:"日常",theme:"",
  visibility:{mode:"all",ids:[]},media:[],likes:[],comments:[],revision:0,
});
const add=(p:Post,id:string,authorId:string,replyTo?:string)=>{
  p.comments.push({id,authorId,name:authorId,text:"聊一句",at:p.comments.length+2,...(replyTo?{replyTo}:{})});
};

it("makes stable opportunities, rather than rerolling when the page is opened again",()=>{
  const p=post();
  const a=momentsEngagement(p,"b",habits,true,[]);
  const b=momentsEngagement(p,"b",habits,true,[]);
  expect(a).toEqual(b);
  expect(momentsOpportunityRoll("same")).toBe(momentsOpportunityRoll("same"));
  expect(momentsEngagement(p,"b",habits,false,[]).allowRoot).toBe(false);
});

it("honors each person's actual comment probability without an artificial commenter cap",()=>{
  const everyoneIsEager=post("crowd");
  for(let i=0;i<9;i++){
    const actor="friend-"+i;
    if(momentsEngagement(everyoneIsEager,actor,{...habits,commentChance:1},true,[]).allowRoot)
      add(everyoneIsEager,"root-"+i,actor);
  }
  // Nine commenters are possible when nine independent chances all pass.
  expect(everyoneIsEager.comments.length).toBe(9);

  const ordinary=post("crowd");
  for(let i=0;i<9;i++){
    const actor="friend-"+i;
    if(momentsEngagement(ordinary,actor,{...habits,commentChance:.28},true,[]).allowRoot)
      add(ordinary,"root-"+i,actor);
  }
  // At ordinary odds the cast is sparse and stable, not a forced group gathering.
  expect(ordinary.comments.length).toBeGreaterThan(0);
  expect(ordinary.comments.length).toBeLessThan(9);
});

it("a post owner usually replies to first comments but does not automatically prolong the chain",()=>{
  let first=0,second=0,third=0;
  for(let i=0;i<200;i++){
    const p=post("sample-"+i);
    add(p,"b-root","b");
    const option=momentsEngagement(p,"owner",habits,false,["b-root"]);
    if(option.replyableCommentIds.includes("b-root")) first++;
    add(p,"a-reply","owner","b-root");
    if(momentsEngagement(p,"b",habits,false,["a-reply"]).replyableCommentIds.includes("a-reply")) second++;
    add(p,"b-reply","b","a-reply");
    if(momentsEngagement(p,"owner",habits,false,["b-reply"]).replyableCommentIds.includes("b-reply")) third++;
  }
  expect(first).toBeGreaterThan(155);
  expect(first).toBeLessThan(195);
  expect(second).toBeGreaterThan(30);
  expect(second).toBeLessThan(70);
  expect(third).toBeGreaterThan(12);
  expect(third).toBeLessThan(40);
});

it("supports rare B-to-C replies on A's post and blocks bottomless replies",()=>{
  const p=post();
  add(p,"c","c");
  const b=momentsEngagement(p,"b",{...habits,joinChance:1},false,["c"]);
  expect(Array.isArray(b.replyableCommentIds)).toBe(true);
  add(p,"a","owner","c");
  add(p,"b","c","a");
  add(p,"d","owner","b");
  expect(momentsCommentDepth(p,"d")).toBe(3);
  expect(momentsEngagement(p,"c",habits,false,["d"]).replyableCommentIds).toEqual([]);
  for(let i=0;i<MAX_MOMENTS_AUTO_COMMENTS;i++)add(p,"extra-"+i,"someone-"+i);
  expect(momentsEngagement(p,"new-person",{...habits,commentChance:1},true,[])).toEqual({allowRoot:false,replyableCommentIds:[]});
});

it("keeps explicit user actions outside the automatic post budget",()=>{
  const p=post("user");
  for(let i=0;i<MAX_MOMENTS_AUTO_COMMENTS;i++)add(p,"auto-"+i,"friend-"+i);
  add(p,"user-extra","user");
  expect(p.comments.at(-1)?.authorId).toBe("user");
  expect(momentsEngagement(p,"owner",habits,false,["user-extra"]).replyableCommentIds).toEqual([]);
});
