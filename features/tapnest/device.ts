// This browser/device only. Never put the host credential into role settings or backups.
const KEY='sully-tapnest-device-v1';
export function rememberedDevice(){try{const key=localStorage.getItem(KEY)||'';return /^[a-f0-9]{48}$/.test(key)?key:'';}catch{return '';}}
export function rememberDevice(key:unknown){if(typeof key!=='string'||!/^[a-f0-9]{48}$/.test(key))return false;try{localStorage.setItem(KEY,key);return localStorage.getItem(KEY)===key;}catch{return false;}}
export function forgetDevice(){try{localStorage.removeItem(KEY);}catch{}}
