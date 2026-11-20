import React,{useEffect,useState} from 'react';
import {CheckCircle,Info,UsersThree} from '@phosphor-icons/react';
import {useOS} from '../context/OSContext';
import {readFriendFeed,savePublicFigureSettings,type FriendFeedState} from '../utils/friendFeed';
import {resolveFriendFeedSettings} from '../utils/friendFeedSettings';
import {activeFriendAccounts,friendAccountName} from '../utils/friendFeedGraph';

/** A regular settings page, not an absolute-positioned overlay inside a form. */
export default function FriendFeedPublicFigureSettings(){
  const {characters,userProfile}=useOS();
  const [feed,setFeed]=useState<FriendFeedState>();
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[status,setStatus]=useState('');
  useEffect(()=>{let alive=true;void readFriendFeed().then(f=>{if(alive)setFeed(f);}).catch(e=>{if(alive)setError(e instanceof Error?e.message:'读取设置失败');});return()=>{alive=false;};},[]);
  const settings=resolveFriendFeedSettings(feed?.settings);
  const peers=feed?activeFriendAccounts(feed,characters).filter(a=>a.ownerId!=='user'):[];
  const change=async(kind:'figure'|'peer',id:string,checked:boolean)=>{
    if(busy||!feed)return;
    setBusy(true);setError('');setStatus('');
    try{
      // Read fresh policy first: concurrent changes in other settings pages stay intact.
      const current=await readFriendFeed(),s=resolveFriendFeedSettings(current.settings);
      if(kind==='figure')s.publicFigures={...s.publicFigures,[id]:checked};
      else s.publicPeers={...s.publicPeers,[id]:checked};
      await savePublicFigureSettings(s.publicFigures,s.publicPeers);
      setFeed(await readFriendFeed());
      setStatus(checked?'已开启并保存':'已关闭并保存');
    }catch(e){setError(e instanceof Error?e.message:'保存失败，请重试');}
    finally{setBusy(false);}
  };
  return <div className="ff-public-settings" aria-label="公众人物账号与公开互动许可">
    <div className="ff-public-intro"><span className="ff-settings-kicker">ACCOUNT · PUBLIC</span>
      <h2>公开互动设置</h2><p>让公众人物主号保持合适的公开社交边界，私人朋友圈完全独立。</p></div>
    {!!error&&<p className="ff-public-error" role="alert">{error}</p>}
    {!!status&&<p className="ff-public-saved" role="status"><CheckCircle size={16}/>{status}</p>}
    {!feed&&<p className="ff-setting-status">正在读取角色与互动权限…</p>}
    {feed&&<><section className="ff-public-section">
      <div className="ff-public-section-heading"><h3>公众人物账号</h3><small>仅主号</small></div>
      <p>勾选后，角色的主号遵循公众人物公开互动规则。小号仍可以正常发帖和评论，不自动公开与主号的关联。</p>
      <div className="ff-public-options">{characters.map(c=><label key={c.id} className="ff-toggle-row ff-public-row">
        <span>{c.name}<small>{settings.publicFigures[c.id]?'主号已开启公开互动限制':'主号按普通账号互动'}</small></span>
        <input type="checkbox" checked={!!settings.publicFigures[c.id]} disabled={busy} onChange={e=>void change('figure',c.id,e.target.checked)} aria-label={`公众人物模式：${c.name}`}/>
      </label>)}{!characters.length&&<p>暂无角色，请先在神经链接添加角色。</p>}</div>
    </section>
    <section className="ff-public-section">
      <div className="ff-public-section-heading"><h3>允许互动的同行账号</h3><UsersThree size={20}/></div>
      <p>这里选择可以与公众人物主号主动互动的同行账号。还须已经确认对方身份；不勾选不影响小号的普通发言。</p>
      <div className="ff-public-options">{peers.map(a=><label key={a.id} className="ff-toggle-row ff-public-row">
        <span>{friendAccountName(feed,a,characters,userProfile.name)}<small>{a.accountId==='main'?'主号':'小号'} · {settings.publicPeers[a.id]?'已允许公开互动':'未允许公开互动'}</small></span>
        <input type="checkbox" checked={!!settings.publicPeers[a.id]} disabled={busy} onChange={e=>void change('peer',a.id,e.target.checked)} aria-label={`允许同行互动：${friendAccountName(feed,a,characters,userProfile.name)}`}/>
      </label>)}{!peers.length&&<p>暂无可选择的角色账号。</p>}</div>
    </section><div className="ff-public-footnote"><Info size={17}/><span>同行许可和身份确认必须同时满足。普通粉丝、未知身份与用户私密关系不会因勾选而公开。</span></div></>}
  </div>;
}
