import React,{useState} from 'react';
import {useBlobRefUrl} from '../../utils/blobRef';

const svg='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" fill="#eef3f4"/><g fill="none" stroke="#8b9fa3" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"><path d="M53 84V39l39-8v45M53 49l39-8"/><ellipse cx="43" cy="86" rx="10" ry="7"/><ellipse cx="82" cy="78" rx="10" ry="7"/></g></svg>';
export const MUSIC_COVER_PLACEHOLDER='data:image/svg+xml,'+encodeURIComponent(svg);
/** Album-only fallback. Never rewrites the stored cover or affects other image types. */
export default function MusicCover({value,alt='',onError,...props}:{value?:string|null}&Omit<React.ImgHTMLAttributes<HTMLImageElement>,'src'>){
 const resolved=useBlobRefUrl(value?.trim()||undefined);
 const [failed,setFailed]=useState<string>();
 const src=resolved&&resolved!==failed?resolved:MUSIC_COVER_PLACEHOLDER;
 return <img {...props} alt={alt} src={src} onError={event=>{if(src!==MUSIC_COVER_PLACEHOLDER)setFailed(resolved);onError?.(event);}}/>;
}
