import React,{lazy,Suspense,useEffect,useState} from 'react';
const CHANGED='tapnest-config-changed';
import {connection,STATE} from './session';
const Runtime=lazy(()=>import('./Runtime'));
export default function Gate(){const [state,setState]=useState({active:!!connection.token,revision:0});useEffect(()=>{const start=()=>setState(s=>({active:!!connection.token,revision:s.revision+1}));const update=()=>{if(!connection.token)setState(s=>({...s,active:false}));};window.addEventListener('tapnest-runtime-start',start);window.addEventListener(CHANGED,start);window.addEventListener(STATE,update);return()=>{window.removeEventListener('tapnest-runtime-start',start);window.removeEventListener(CHANGED,start);window.removeEventListener(STATE,update);};},[]);return state.active?<Suspense fallback={null}><Runtime key={state.revision}/></Suspense>:null;}
