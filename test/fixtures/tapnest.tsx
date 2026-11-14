import React from 'react';
import {createRoot} from 'react-dom/client';
import {OSPreviewProvider} from '../../context/OSContext';
import TapNestApp from '../../apps/TapNestApp';
import {DB} from '../../utils/db';
import {putImageBlob} from '../../utils/blobRef';
import {defaultBinding,emptyConfig,saveConfig} from '../../features/tapnest/model';
import {Icons} from '../../constants';
// Localhost/CI fixture only. Synthetic characters and PNG; no credentials or model requests.
const chars=[{id:'pet-ui-a',name:'小伙伴',avatar:'',memories:[],mountedWorldbooks:[]},{id:'pet-ui-b',name:'薄荷',avatar:'',memories:[],mountedWorldbooks:[]}];
for(const c of chars)await DB.saveCharacter(c as any);
if(new URLSearchParams(location.search).has('model')&&!await DB.getAsset('tapnest_models_v2')){
 const canvas=document.createElement('canvas');canvas.width=180;canvas.height=180;const x=canvas.getContext('2d')!;x.fillStyle='#9fb993';x.beginPath();x.roundRect(32,32,116,116,45);x.fill();x.fillStyle='#f6f8ed';for(const [a,b]of [[66,67],[91,56],[116,67]]){x.beginPath();x.ellipse(a,b,9,12,0,0,Math.PI*2);x.fill();}x.beginPath();x.ellipse(91,105,25,22,0,0,Math.PI*2);x.fill();
 const blob=await new Promise<Blob>(r=>canvas.toBlob(b=>r(b!),'image/png'));const image=await putImageBlob(blob);
 const rig={canvasWidth:180,canvasHeight:180,layers:[{id:'body',image:'body.png'}]};const m={id:'pet-ui-model',name:'薄荷小伙伴',forms:[{id:'chat',name:'日常',rig},{id:'work',name:'工作',rig}],activeFormId:'chat',assets:{'body.png':image},tapDialogues:['在这里陪你。'],warnings:[],zipRef:'',importedAt:Date.now()};
 await DB.saveAsset('tapnest_models_v2',JSON.stringify([m.id]));await DB.saveAsset('tapnest:model:'+m.id,JSON.stringify(m));const c=emptyConfig();c.activeCharId=chars[0].id;c.bindings[chars[0].id]=defaultBinding(m);await saveConfig(c);
}
const params=new URLSearchParams(location.search);
createRoot(document.getElementById('root')!).render(params.has('icon')?<div style={{display:'grid',placeItems:'center',height:'100%',background:'#f0f6ed'}}><div><div data-testid="desktop-icon" style={{width:60,height:60,display:'grid',placeItems:'center',background:'white',borderRadius:19,boxShadow:'0 5px 20px #49603a18',color:'#557b5e'}}><Icons.TapNest className="fixture-paw"/></div><p style={{textAlign:'center',fontSize:12,color:'#557b5e'}}>桌宠</p><style>{`.fixture-paw{width:32px;height:32px;display:block}`}</style></div></div>:<OSPreviewProvider value={{characters:chars,activeCharacterId:chars[0].id,userProfile:{name:'示例用户'},apiConfig:{},realtimeConfig:{},closeApp(){},openApp(){},addToast(){}} as any}><TapNestApp/></OSPreviewProvider>);
