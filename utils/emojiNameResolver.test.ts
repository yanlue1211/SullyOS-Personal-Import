import {it,expect} from 'vitest';
import {resolveEmojiForSend} from './emojiNameResolver';
const library=[{name:'小狗 懵逼',url:'dog'},{name:'“叹气”',url:'sigh'},{name:'OK',url:'ok'},{name:'不开心',url:'sad'}];
it('accepts only real visible entries, tolerating wrapping quotes, spacing and width differences',()=>{
 expect(resolveEmojiForSend('「小狗　懵逼」',library)?.url).toBe('dog');
 expect(resolveEmojiForSend('叹气',library)?.url).toBe('sigh');
 expect(resolveEmojiForSend('ｏｋ',library)?.url).toBe('ok');
 expect(resolveEmojiForSend('有点懵逼',library)).toBeUndefined();
 expect(resolveEmojiForSend('开心',library)).toBeUndefined();
});
it('preserves exact names and rejects normalized collisions, duplicate URLs aside',()=>{
 const entries=[{name:'A B',url:'one'},{name:'ab',url:'two'}];
 expect(resolveEmojiForSend('A B',entries)?.url).toBe('one');
 expect(resolveEmojiForSend('「AB」',entries)).toBeUndefined();
 expect(resolveEmojiForSend('笑', [{name:'笑',url:'one'},{name:'笑',url:'two'}])).toBeUndefined();
 expect(resolveEmojiForSend('笑', [{name:'笑',url:'one'},{name:'笑',url:'one'}])?.url).toBe('one');
});
it('keeps category scoping and exact punctuation-containing names intact',()=>{
 const categories=[{id:'cat',name:'呆猫'}];
 const entries=[{name:'亲亲',url:'cat',categoryId:'cat'},{name:'亲亲',url:'dog',categoryId:'dog'},{name:'呆猫: 亲亲',url:'exact'}];
 expect(resolveEmojiForSend('呆猫: 亲亲',entries,categories)?.url).toBe('exact');
 expect(resolveEmojiForSend('呆猫：「亲亲」',entries,categories)?.url).toBe('cat');
 expect(resolveEmojiForSend('不存在: 亲亲',entries,categories)).toBeUndefined();
 expect(resolveEmojiForSend('挥手', [{name:'隐藏的挥手',url:'hidden'}],categories)).toBeUndefined();
});
