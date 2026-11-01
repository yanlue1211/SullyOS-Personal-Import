import React from 'react';
import TokenImg from '../../components/os/TokenImg';
import {readRealMedia} from './format';
import type {ExperienceMessage} from './media';
/** Prepared locally, but not a message until the user presses Send. */
export default function MediaDraft({message,onRemove,disabled=false}:{message:ExperienceMessage;onRemove:()=>void;disabled?:boolean}){
 const media=readRealMedia(message.metadata?.realMedia);if(!media)return null;
 return <div className="flex items-center gap-2 p-2 rounded-xl bg-white/90 text-stone-700 text-xs" aria-label="待发送附件"><TokenImg value={media.frames[0].image} className="w-12 h-12 rounded-lg object-cover"/><span className="min-w-0 flex-1 truncate">{media.name}<small className="block opacity-60">可配文字后一起发送</small></span><button type="button" aria-label="移除待发送附件" disabled={disabled} onClick={onRemove} className="px-2 py-1">×</button></div>;
}
