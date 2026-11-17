import React from 'react';
export default function PlaybackIcon({paused=false,loading=false}:{paused?:boolean;loading?:boolean}){
 return loading?<span className="sw-loading" aria-hidden="true">◌</span>:<svg aria-hidden="true" viewBox="0 0 24 24" width="18" height="18" fill="currentColor">{paused?<path d="M6 4h4v16H6zm8 0h4v16h-4z"/>:<path d="M7 3.8v16.4L20 12z"/>}</svg>;
}
