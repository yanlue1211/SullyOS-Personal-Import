import React from 'react';
/** A centered vector glyph, independent of platform emoji metrics. */
export default function PetMark({className}:{className?:string}){
 return <svg className={className} viewBox="0 0 32 32" fill="none" aria-hidden="true" focusable="false" style={{display:'block',flexShrink:0}}>
  <ellipse cx="7.5" cy="14" rx="2.6" ry="3.6" transform="rotate(-25 7.5 14)" fill="currentColor"/>
  <ellipse cx="12.7" cy="8.5" rx="2.6" ry="3.5" transform="rotate(-10 12.7 8.5)" fill="currentColor"/>
  <ellipse cx="19.3" cy="8.5" rx="2.6" ry="3.5" transform="rotate(10 19.3 8.5)" fill="currentColor"/>
  <ellipse cx="24.5" cy="14" rx="2.6" ry="3.6" transform="rotate(25 24.5 14)" fill="currentColor"/>
  <path d="M16 15.5c-3.1 0-3.8 3.4-6.3 5.7-2.5 2.4-1.4 6.2 1.8 6.2 1.8 0 2.7-1.1 4.5-1.1s2.7 1.1 4.5 1.1c3.2 0 4.3-3.8 1.8-6.2-2.5-2.3-3.2-5.7-6.3-5.7Z" fill="currentColor"/>
 </svg>;
}
