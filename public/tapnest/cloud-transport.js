/* ES5, native-only transport. No model/API/tenant key is accepted or persisted. */
(function(root){
 function create(deps){
  var state=deps.load()||{session:null,queue:[]},working=false,next=0,failures=0;
  if(!Array.isArray(state.queue))state.queue=[];
  function save(){deps.save(state);}
  function configure(s){if(!s||!s.enabled){state.session=null;save();return;}
   if(typeof s.workerUrl!=='string'||!/^https:\/\/[^\s?#@]+$/.test(s.workerUrl)||typeof s.capability!=='string'||!s.capability||!s.charId||!s.revision)throw Error('桌宠云端配置无效');
   var previous=state.session;state.session={workerUrl:s.workerUrl.replace(/\/+$/,''),capability:s.capability,charId:s.charId,revision:s.revision,expiresAt:s.expiresAt};
   state.queue.forEach(function(q){if(q.session.charId===s.charId&&q.session.revision===s.revision)q.session=state.session;});
   try{save();}catch(e){state.session=previous;throw e;}
  }
  function ready(e){return !!state.session&&state.session.charId===e.charId&&state.session.revision===e.revision&&state.session.expiresAt>deps.now();}
  function enqueue(e){if(!ready(e))throw Error('桌宠云端未就绪，请回网页同步设置');if(state.queue.length>=25)throw Error('待发送消息已满，请联网后再发送');
   if(state.queue.some(function(q){return q.event.id===e.id;}))return;
   state.queue.push({event:JSON.parse(JSON.stringify(e)),session:state.session,accepted:false});try{save();}catch(error){state.queue.pop();throw error;}
  }
  function step(){if(working||deps.now()<next||!state.queue.length)return;working=true;
   var index=0;for(var i=0;i<state.queue.length;i++){if(state.session&&state.queue[i].session.charId===state.session.charId&&state.queue[i].session.revision===state.session.revision){index=i;break;}}
   var q=state.queue[index];
   try{
    var data=deps.request(q.session,q.accepted?'status':'send',q.event);
    if(!data||!data.status)throw Error('桌宠云端响应不完整');
    if(data.status==='done'||data.status==='failed'||data.status==='expired'){
     // Persist consumption before displaying; restart never replays a stale bubble.
     state.queue.splice(index,1);try{save();}catch(error){state.queue.splice(index,0,q);throw error;}deps.result(q.event,data);
    }else if(data.status==='queued'){q.accepted=true;save();}
    else if(data.status==='missing'){q.accepted=false;save();}
    failures=0;next=deps.now()+1500;
   }catch(e){if(!q.accepted){q.accepted=true;try{save();}catch(_){}}failures++;next=deps.now()+Math.min(30000,1000*Math.pow(2,Math.min(5,failures-1)));deps.error(String(e));}
   finally{working=false;}
  }
  return {configure:configure,ready:ready,enqueue:enqueue,step:step,pending:function(){return state.queue.length>0;},configured:function(){return !!state.session;}};
 }
 root.PetCloudTransport={create:create};
})(this);
