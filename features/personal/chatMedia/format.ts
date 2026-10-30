export type VirtualMediaKind = '图片' | '视频' | '语音';
export const VIRTUAL_MEDIA_GUIDE = '\n【虚拟媒体】你可以按情境发送虚拟图片或视频：用 [[虚拟图片:画面描述]] 或 [[虚拟视频:视频内容描述]]，每张卡片独占一行。描述具体内容，不要填写图片链接；这是文字模拟媒体，无需生成真实文件。用户发送的同格式内容也代表一张图片或一段视频。';
export function virtualMedia(kind: VirtualMediaKind, description: string): string {
  return `[[虚拟${kind}:${description.trim().replace(/\]\]/g, '］］')}]]`;
}
export function parseVirtualMedia(content: string): { kind: VirtualMediaKind; description: string } | null {
  const match = content.trim().match(/^\[\[虚拟(图片|视频|语音)[:：]([\s\S]+?)\]\]$/);
  return match && match[2].trim() ? { kind: match[1] as VirtualMediaKind, description: match[2].trim() } : null;
}
