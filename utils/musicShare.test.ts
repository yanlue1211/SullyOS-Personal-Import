import {it,expect,vi} from 'vitest';
import {shareSongToCharacter} from './musicShare';
import {DB} from './db';
const m=vi.hoisted(()=>({analyze:vi.fn()}));
vi.mock('./songListening',()=>({isSongListeningAvailable:()=>true,getOrAnalyzeSongSound:m.analyze}));
const song={id:123,name:'这首歌',artists:'歌手',album:'',albumPic:'',fee:0,duration:10};
it('shares objective audio analysis to only the selected character as a normal user message',async()=>{
 const save=vi.spyOn(DB,'saveMessage').mockResolvedValue(1);m.analyze.mockResolvedValue(JSON.stringify({description:'轻快吉他',isTrial:true}));await shareSongToCharacter('selected',song,'去听听',true);expect(save.mock.calls[0][0]).toMatchObject({charId:'selected',role:'user',type:'text'});expect(save.mock.calls[0][0].content).toContain('轻快吉他');expect(save.mock.calls[0][0].content).toContain('试听片段');save.mockRestore();
});
it('analysis failure does not pretend the song was heard or call a chat model',async()=>{
 const save=vi.spyOn(DB,'saveMessage').mockResolvedValue(2);m.analyze.mockRejectedValue(Error('bad'));await shareSongToCharacter('selected',song,'去听听',true);expect(save.mock.calls[0][0].content).toContain('音频识别失败');save.mockRestore();
});
