import { afterEach, expect, it, vi } from 'vitest';
import { musicApi } from '../context/MusicContext';
import { buildSongSearchGuide, searchNeteaseSong } from './songSearch';
afterEach(() => vi.restoreAllMocks());
it('searches Netease beyond local playlists and selects the requested artist', async () => {
  const search = vi.spyOn(musicApi, 'search').mockResolvedValue({result:{songs:[
    {id:1,name:'测试歌',artists:[{name:'同名歌手'}]},
    {id:2,name:'测试歌',ar:[{name:'目标歌手'}],al:{name:'专辑',picUrl:'http://cover'},dt:180000},
  ]}});
  expect(await searchNeteaseSong('测试歌 | 目标歌手')).toMatchObject({id:2,artists:'目标歌手',duration:180,albumPic:'https://cover'});
  expect(search.mock.calls[0][1]).toBe('测试歌 目标歌手');
});
it('does not play an unrelated first result or a wrong artist', async () => {
  vi.spyOn(musicApi, 'search').mockResolvedValue({result:{songs:[{id:3,name:'其他歌',artists:[{name:'目标歌手'}]}]}});
  expect(await searchNeteaseSong('测试歌 | 目标歌手')).toBeNull();
});
it('does not invent a result on empty search', async () => {
  vi.spyOn(musicApi, 'search').mockResolvedValue({result:{songs:[]}});
  expect(await searchNeteaseSong('测试歌')).toBeNull();
});
it('provides an action without injecting any library songs as current playback', () => {
  const guide=buildSongSearchGuide();
  expect(guide).toContain('搜索结果和收藏均不代表用户正在听歌');
  expect(guide).toContain('真实音频分析另由用户开关控制');
});
