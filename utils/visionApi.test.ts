import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Message, UserProfile, VisionApiConfig } from '../types';
import { ChatPrompts } from './chatPrompts';
import { DB } from './db';
import { materializeVisionDescriptions, visionApiConfigFromPreset } from './visionApi';

const config: VisionApiConfig = {
  enabled: true,
  baseUrl: 'https://vision.example.com/v1',
  apiKey: 'vision-key',
  model: 'vision-model',
};

const image = 'data:image/jpeg;base64,AAAA';

const message = (id: number): Message => ({
  id,
  charId: 'char-1',
  role: 'user',
  type: 'image',
  content: image,
  timestamp: 1_700_000_000_000 + id,
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('independent vision API', () => {
  it('can load a generic model preset into vision without carrying unrelated main-model options', () => {
    expect(visionApiConfigFromPreset({
      id: 'preset-1',
      name: '视觉模型',
      config: {
        baseUrl: ' https://vision.example.com/v1/// ',
        apiKey: '\u200Bvision-key\u2060',
        model: ' vision-model ',
        stream: true,
        temperature: 1.2,
      },
    })).toEqual(config);
  });

  it('recognizes identical image data once, writes both message caches, then reuses them', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '一只黑猫坐在窗边，窗外正在下雨。' } }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const updateSpy = vi.spyOn(DB, 'updateMessageMetadata').mockResolvedValue(undefined);

    const prepared = await materializeVisionDescriptions([message(1), message(2)], config);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledTimes(2);
    expect(prepared.map(item => item.metadata?.visionDescription)).toEqual([
      '一只黑猫坐在窗边，窗外正在下雨。',
      '一只黑猫坐在窗边，窗外正在下雨。',
    ]);

    await materializeVisionDescriptions(prepared, config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('feeds the main model a text placeholder instead of image_url when enabled', () => {
    const described = {
      ...message(3),
      metadata: { visionDescription: '一张写着「周五见」的聊天截图。' },
    };
    const { apiMessages } = ChatPrompts.buildMessageHistory(
      [described],
      10,
      { id: 'char-1', name: 'Sully' } as CharacterProfile,
      { name: 'User' } as UserProfile,
      [],
      undefined,
      { useVisionDescriptions: true },
    );

    expect(typeof apiMessages[0].content).toBe('string');
    expect(apiMessages[0].content).toContain('[图片：一张写着「周五见」的聊天截图。]');
    expect(JSON.stringify(apiMessages)).not.toContain('image_url');
    expect(JSON.stringify(apiMessages)).not.toContain('data:image');
  });

  it('keeps the legacy multimodal payload when vision API is not selected', () => {
    const described = {
      ...message(4),
      metadata: { visionDescription: '旧缓存不应在关闭时改变原逻辑' },
    };
    const { apiMessages } = ChatPrompts.buildMessageHistory(
      [described],
      10,
      { id: 'char-1', name: 'Sully' } as CharacterProfile,
      { name: 'User' } as UserProfile,
      [],
    );

    expect(Array.isArray(apiMessages[0].content)).toBe(true);
    expect(JSON.stringify(apiMessages)).toContain('image_url');
    expect(JSON.stringify(apiMessages)).toContain(image);
  });
});

it('recognizes stickers through the independent vision API only when the chat switch is enabled',async()=>{
 const fetchMock=vi.fn().mockResolvedValue(new Response(JSON.stringify({choices:[{message:{content:'一只小狗举着加油牌'}}]}),{status:200}));vi.stubGlobal('fetch',fetchMock);vi.spyOn(DB,'updateMessageMetadata').mockResolvedValue(undefined);
 const sticker={...message(88),type:'emoji'} as Message;
 await materializeVisionDescriptions([sticker],config);expect(fetchMock).not.toHaveBeenCalled();
 const [prepared]=await materializeVisionDescriptions([sticker],config,{includeEmojis:true});expect(fetchMock).toHaveBeenCalledTimes(1);
 const char={id:'char-1',name:'角色',stickerVisionEnabled:true} as CharacterProfile;
 const history=ChatPrompts.buildMessageHistory([prepared],10,char,{name:'我'} as UserProfile,[],undefined,{useVisionDescriptions:true});
 expect(JSON.stringify(history.apiMessages)).toContain('一只小狗举着加油牌');expect(JSON.stringify(history.apiMessages)).not.toContain('image_url');
 const closed=ChatPrompts.buildMessageHistory([prepared],10,{...char,stickerVisionEnabled:false},{name:'我'} as UserProfile,[],undefined,{useVisionDescriptions:true});expect(JSON.stringify(closed.apiMessages)).not.toContain('一只小狗举着加油牌');
});
