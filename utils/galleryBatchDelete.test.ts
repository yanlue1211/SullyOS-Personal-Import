import {expect,it} from 'vitest';
import {DB} from './db';
import {saveGalleryImageContentFavorite,resolveContentFavorite,getContentFavoriteById} from './contentFavorites';
it('deletes exactly the selected images and preserves a favorite of a deleted image',async()=>{
 const a:any={id:'batch-a',charId:'batch-char',url:'data:image/png;base64,YQ==',timestamp:1};
 const b:any={...a,id:'batch-b'},c:any={...a,id:'batch-c',charId:'other-char'};
 for(const i of [a,b,c])await DB.saveGalleryImage(i);
 const favorite=await saveGalleryImageContentFavorite(a,'角色');
 await DB.deleteGalleryImages([a.id,a.id,b.id]);
 expect(await DB.getGalleryImages('batch-char')).toEqual([]);
 expect((await DB.getGalleryImages('other-char')).some(i=>i.id===c.id)).toBe(true);
 expect(await resolveContentFavorite((await getContentFavoriteById(favorite.id))!)).toBeTruthy();
});
