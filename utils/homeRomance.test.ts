import {afterEach,expect,it,vi} from 'vitest';
import {Group,OrthographicCamera,Vector3} from 'three';
import {hasRomanticPair,homeSocialActionAllowed,homePhotoActionAllowed,isRomanticMotion,normalizeRomanticPairs,normalizeUserRomanceDisabledIds,updateRomanticPair,updateHomeRomanticRelation} from '../apps/room3d/homeRomance';
import {createSocialScene} from '../apps/room3d/chibi/selectedSocial';
// @ts-expect-error Runtime JS module.
import {createPhotoSession} from '../apps/room3d/photoSession.js';
import {createHome,validateHome} from '../apps/room3d/model.js';
import catalog from '../public/room3d/catalog.json';
import motions from '../apps/room3d/chibi/selectedMotionCatalog.json';
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('denies every intimate clip by default, including old homes and apparent high affinity',()=>{
 const home={affinity:100,relationship:'情侣',socialMemberIds:['A','B']} as any;
 const ids=motions.filter(m=>m.category==='close').map(m=>m.id).concat(['cmu-20_10','cmu-22_09']);
 for(const id of ids){expect(isRomanticMotion(id)).toBe(true);expect(homeSocialActionAllowed(home,id,'A','B')).toBe(false);}
 expect(homeSocialActionAllowed({},'cmu-18_08','A','B')).toBe(true);expect(homeSocialActionAllowed({},'cmu-22_13','A','B')).toBe(true);
});
it('authorizes only the exact declared pair, symmetrically, with no transitive permission',()=>{
 const home={romanticPairs:updateRomanticPair({},'A','B',true)};
 expect(homeSocialActionAllowed(home,'home-hug','A','B')).toBe(true);expect(homeSocialActionAllowed(home,'home-hug','B','A')).toBe(true);
 for(const [a,b]of [['A','C'],['B','C'],['A','A']])expect(homeSocialActionAllowed(home,'home-hug',a,b)).toBe(false);
 home.romanticPairs=updateRomanticPair(home,'B','A',false);expect(hasRomanticPair(home,'A','B')).toBe(false);
});
it('persists explicit pairs, rejects malformed imports, and leaves old homes unapproved',()=>{
 const home=createHome(catalog as any);expect(validateHome(home,catalog as any).romanticPairs).toBeUndefined();
 home.romanticPairs=[['B','A'],['A','B']];expect(validateHome(home,catalog as any).romanticPairs).toEqual([['A','B']]);
 expect(()=>normalizeRomanticPairs([['A','A']])).toThrow();expect(()=>normalizeRomanticPairs([['A','B','C']])).toThrow();
});
const residents=()=>['A','B'].map(id=>({id,visitor:{root:new Group(),animate:vi.fn(),finishPose:vi.fn()} as any}));
it('blocks animation before loading a clip even if the caller supplies an intimate ID directly',async()=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);const scene=createSocialScene(residents(),{canInteract:(id,a,b)=>homeSocialActionAllowed({},id,a,b)});
 await expect(scene.start('home-hug','A','B')).rejects.toThrow('浪漫关系');expect(fetch).not.toHaveBeenCalled();expect(scene.active).toBe(false);
});
it('rechecks relationship after asynchronous motion loading before staging either person',async()=>{
 let allowed=true,resolve!:(value:any)=>void;vi.stubGlobal('fetch',vi.fn(()=>new Promise(r=>{resolve=r;})));
 const scene=createSocialScene(residents(),{canInteract:()=>allowed}),pending=scene.start('home-hug','A','B');allowed=false;
 resolve({ok:true,json:async()=>({version:1,id:'home-hug',actors:[{},{}]})});await expect(pending).rejects.toThrow('浪漫关系');expect(scene.active).toBe(false);
});
it('applies the same restriction to photo interactions without changing actor transforms',async()=>{
 const actors=residents().map(r=>({id:r.id,label:r.id,root:r.visitor.root,person:r.visitor}));actors[1].root.position.x=2;
 const session=createPhotoSession({actors,camera:new OrthographicCamera(),controls:{target:new Vector3()},invalidate:vi.fn(),canInteract:(id:string,a:string,b:string)=>homeSocialActionAllowed({},id,a,b)});
 await expect(session.interaction('home-hug','A','B')).rejects.toThrow('浪漫关系');expect(actors[1].root.position.x).toBe(2);session.restore();
});

it('user with each character is enabled by default even in legacy homes, but characters remain unpaired',()=>{
 for(const home of [{},{romanticPairs:[]},{romanticPairs:[['A','B']]},createHome(catalog as any)]){
  expect(hasRomanticPair(home,'user','A')).toBe(true);
  expect(hasRomanticPair(home,'B','user')).toBe(true);
  expect(homeSocialActionAllowed(home,'home-hug','user','A')).toBe(true);
  expect(homeSocialActionAllowed(home,'home-hug','A','user')).toBe(true);
  expect(homePhotoActionAllowed(home,'home-hug','user','A')).toBe(true);
 }
 expect(hasRomanticPair({},'A','B')).toBe(false);
 expect(hasRomanticPair({},'user','user')).toBe(false);
 expect(hasRomanticPair({},'A',undefined)).toBe(false);
 expect(homeSocialActionAllowed({},'home-hug','A','B')).toBe(false);
});

it('user opt-outs survive save/import, remain local to exact character, and re-enable independently',()=>{
 const base=createHome(catalog as any);
 const disabled={...base,...updateHomeRomanticRelation(base,'A','user',false)};
 const recovered=validateHome(JSON.parse(JSON.stringify(disabled)),catalog as any);
 expect(recovered.userRomanceDisabledIds).toEqual(['A']);
 expect(hasRomanticPair(recovered,'user','A')).toBe(false);
 expect(hasRomanticPair(recovered,'A','user')).toBe(false);
 expect(homeSocialActionAllowed(recovered,'home-hug','user','A')).toBe(false);
 expect(homePhotoActionAllowed(recovered,'home-hug','user','A')).toBe(false);
 expect(hasRomanticPair(recovered,'user','B')).toBe(true);
 expect(hasRomanticPair(recovered,'A','B')).toBe(false);
 const restored=updateHomeRomanticRelation(recovered,'user','A',true);
 expect(hasRomanticPair(restored,'A','user')).toBe(true);
 expect(restored.userRomanceDisabledIds).toEqual([]);
 // No redundant synthetic-user pairs in the character-character relationship data.
 expect(restored.romanticPairs).toEqual([]);
 expect(validateHome({...recovered,userRomanceDisabledIds:['A','A','B']},catalog as any).userRomanceDisabledIds).toEqual(['A','B']);
});

it('user opt-out wins over explicit legacy user pair; character-character permission remains explicit',()=>{
 const legacy={romanticPairs:[['user','A'],['B','C']] as [string,string][]};
 expect(hasRomanticPair(legacy,'user','A')).toBe(true);
 const disabled=updateHomeRomanticRelation(legacy,'user','A',false);
 expect(hasRomanticPair(disabled,'user','A')).toBe(false);
 expect(hasRomanticPair(disabled,'B','C')).toBe(true);
 expect(disabled.romanticPairs).toEqual([['B','C']]);
 const other=updateHomeRomanticRelation(disabled,'B','C',false);
 expect(hasRomanticPair(other,'B','C')).toBe(false);
 expect(hasRomanticPair(other,'user','A')).toBe(false);
 const enabled=updateHomeRomanticRelation(other,'C','B',true);
 expect(hasRomanticPair(enabled,'B','C')).toBe(true);
 expect(hasRomanticPair(enabled,'user','A')).toBe(false);
});

it('fails closed on malformed saved opt-out lists and invalid relation edits',()=>{
 expect(()=>normalizeUserRomanceDisabledIds(['user'])).toThrow();
 expect(()=>normalizeUserRomanceDisabledIds([123])).toThrow();
 expect(()=>normalizeUserRomanceDisabledIds(Array.from({length:101},(_,i)=>'A'+i))).toThrow();
 expect(()=>validateHome({...createHome(catalog as any),userRomanceDisabledIds:['user']},catalog as any)).toThrow();
 expect(()=>updateHomeRomanticRelation({},'user','user',false)).toThrow();
 expect(()=>updateHomeRomanticRelation({},'','A',true)).toThrow();
});
