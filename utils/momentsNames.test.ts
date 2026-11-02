import {expect,it} from 'vitest';
import {resolveMomentsNames} from '../features/moments/names';
const chars=['马嘉祺','丁程鑫','宋亚轩','刘耀文','张真源','严浩翔','贺峻霖','源','claude'].map((name,i)=>({id:String(i),name}));
it('matches addressed nicknames without treating ordinary single characters as names',()=>{
 expect(resolveMomentsNames('丁哥朋友圈',chars).map(x=>x.name)).toEqual(['丁程鑫']);
 expect(resolveMomentsNames('小贺的朋友圈',chars).map(x=>x.name)).toEqual(['贺峻霖']);
 expect(resolveMomentsNames('今天真累，朋友圈',chars)).toEqual([]);
 expect(resolveMomentsNames('小宋和小贺朋友圈',chars)).toEqual([]);
 expect(resolveMomentsNames('丁程鑫和小贺朋友圈',chars)).toEqual([]);
});
it('treats a unique single-character account variant as the same identity',()=>{
 for(const address of ['源源','张真源','小源','源的'])expect(resolveMomentsNames(address+'朋友圈',chars).map(x=>x.name)).toEqual(['张真源','源']);
});
it('does not resolve ambiguous shared-character nicknames',()=>{
 expect(resolveMomentsNames('小贺朋友圈',[...chars,{id:'other',name:'贺小明'}])).toEqual([]);
});
