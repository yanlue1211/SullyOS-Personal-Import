/**
 * 网易云「我的」主页
 * - 未登录: 扫码登录 / 手机验证码登录
 * - 已登录: 昵称 + 头像 + 签名 + VIP + 签到 + 我的歌单 + 播放记录 + 云盘
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import { useMusic, musicApi, toHttps, Song } from '../../context/MusicContext';
import {
  C, Sparkle, MizuHeader, BokehBg, MiniPlayer,
} from './MusicUI';
import { MagnifyingGlass, Gear, User as UserIcon } from '@phosphor-icons/react';
import NeteaseLoginPanel from './NeteaseLoginPanel';
import TokenImg from '../../components/os/TokenImg';
import { isBlobRef } from '../../utils/blobRef';
import PersonalPlaylistsPanel from './PersonalPlaylistsPanel';
import {DB} from '../../utils/db';
import {loadNeteasePlaylistSongs,importNeteasePlaylist} from '../../utils/personalMusicLibrary';
import { trackEvent } from '../../utils/analytics';

interface Playlist {
  id: number;
  name: string;
  coverImgUrl: string;
  trackCount: number;
  subscribed: boolean;
  creatorNickname?: string;
}

interface RecordItem {
  song: Song;
  score: number;
  playCount: number;
}

interface Props {
  onBack: () => void;
  onOpenPlayer: () => void;
  onOpenSearch?: () => void;
  onOpenSettings?: () => void;
  onVisitChar?: (charId: string) => void;
  onManage?: (playlistId?:string) => void;
}

// ─── 「一起写的歌」本地专辑卡 — 写歌 App 同步过来的 ACE-Step / MiniMax 出歌 ───
interface LocalAlbumCardProps {
  songs: Song[];
  expanded: boolean;
  setExpanded: (next: ((v: boolean) => boolean) | boolean) => void;
  currentId: number | null;
  playing: boolean;
  onPlay: (song: Song, idx: number) => void;
  onRemove: (id: number) => void;
}
const LocalAlbumCard: React.FC<LocalAlbumCardProps> = ({ songs, expanded, setExpanded, currentId, playing, onPlay, onRemove }) => (
  <div
    className="rounded-2xl overflow-hidden relative"
    style={{
      background: `linear-gradient(135deg, ${C.sakura}25, ${C.lavender}22, ${C.glow}20)`,
      border: `1px solid ${C.sakura}50`,
      boxShadow: `0 4px 18px ${C.sakura}25, inset 0 1px 0 rgba(255,255,255,0.5)`,
    }}
  >
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 opacity-50"
      style={{ background: `radial-gradient(ellipse at 80% 20%, ${C.sakura}40 0%, transparent 50%)` }}
    />
    <button
      onClick={() => setExpanded((v: boolean) => !v)}
      className="relative w-full flex items-center gap-3 p-2.5 text-left"
    >
      <div className="relative w-12 h-12 shrink-0">
        <div className="absolute inset-0 rounded-xl flex items-center justify-center overflow-hidden"
          style={{
            background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`,
            border: `1.5px solid ${C.glow}80`,
            boxShadow: `0 2px 8px ${C.glow}40`,
          }}
        >
          <Sparkle size={20} color="white" delay={0} />
        </div>
        <Sparkle size={9} className="absolute -top-1 -right-1" color={C.sakura} delay={0.5} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium tracking-wider"
            style={{ color: C.primary, fontFamily: `'Georgia', 'Noto Serif SC', serif` }}>
            我的歌曲
          </span>
          <span className="text-[8px] px-1.5 py-[1px] rounded-full font-bold"
            style={{
              background: `linear-gradient(135deg, ${C.sakura}, ${C.lavender})`,
              color: 'white',
              letterSpacing: '0.1em',
            }}>
            OURS
          </span>
        </div>
        <div className="text-[10px] truncate mt-0.5" style={{ color: C.muted }}>
          {songs.length} 首 · 创作与导入
        </div>
      </div>
      <div className="text-[10px] shrink-0" style={{ color: C.sakura }}>
        {expanded ? '收起' : '展开'}
      </div>
    </button>
    {expanded && (
      <div className="relative border-t px-1 py-1" style={{ borderColor: `${C.sakura}30` }}>
        {songs.map((s, idx) => {
          const active = currentId === s.id;
          return (
            <div key={s.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-white/30 transition-colors">
              <button
                onClick={() => onPlay(s, idx)}
                className="flex-1 flex items-center gap-2 min-w-0 text-left"
              >
                <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                  style={{ background: active ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : `${C.faint}25` }}>
                  {active && playing ? (
                    <span className="flex gap-0.5">
                      <span className="w-0.5 h-2 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.6s ease-in-out infinite' }} />
                      <span className="w-0.5 h-3 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.8s ease-in-out 0.15s infinite' }} />
                      <span className="w-0.5 h-2 bg-white rounded-full" style={{ animation: 'shizuku-twinkle 0.7s ease-in-out 0.3s infinite' }} />
                    </span>
                  ) : (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill={active ? 'white' : C.muted}>
                      <path d="M8 5v14l11-7L8 5z" />
                    </svg>
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-[12px] truncate" style={{ color: active ? C.primary : C.text, fontWeight: active ? 600 : 400 }}>
                    {s.name}
                  </div>
                  <div className="text-[9.5px] truncate" style={{ color: C.muted }}>
                    {s.artists}
                  </div>
                </div>
              </button>
              <button
                onClick={() => {
                  if (typeof window !== 'undefined' && window.confirm(`从专辑移除《${s.name}》？`)) {
                    onRemove(s.id);
                    trackEvent('从本地专辑移除一首歌');
                  }
                }}
                className="text-[10px] px-1.5 py-0.5 rounded shrink-0 transition-colors"
                style={{ color: C.faint }}
                title="移除"
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
    )}
  </div>
);

const NeteaseProfilePage: React.FC<Props> = ({ onBack, onOpenPlayer, onOpenSearch, onOpenSettings, onVisitChar, onManage }) => {
  const { addToast, characters, userProfile } = useOS();
  const {
    cfg, setCfg, profile, refreshProfile, playSong,
    current, playing, togglePlay, nextSong, prevSong,
    listeningTogetherWith, removeListeningPartner,
    localAlbumSongs, removeLocalSong,
    regeneratingId, regeneratingStatus,
  } = useMusic();
  const [localAlbumExpanded, setLocalAlbumExpanded] = useState(false);
  const [showNeteaseLogin, setShowNeteaseLogin] = useState(false);

  // 伴听 char 名单（MiniPlayer 徽章用）—— 带头像
  const companions = useMemo(() => {
    return listeningTogetherWith
      .map(id => characters.find(c => c.id === id))
      .filter((c): c is typeof characters[number] => !!c)
      .map(c => ({ id: c.id, name: c.name, avatar: c.avatar }));
  }, [listeningTogetherWith, characters]);

  const [tab, setTab] = useState<'playlist' | 'record' | 'cloud'>('playlist');
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [cloud, setCloud] = useState<Song[]>([]);
  const [loading, setLoading] = useState(false);
  const [signedIn, setSignedIn] = useState(false);

  const uid = profile?.userId;

  // 把不稳定的引用（每秒重建的 addToast 和 cfg 对象）收到 ref 里，
  // 否则 reload 的 deps 会爆炸 → useEffect 循环触发。
  const toastRef = useRef(addToast);
  toastRef.current = addToast;
  const cfgRef = useRef(cfg);
  cfgRef.current = cfg;

  // VIP 标签 —— 无论登录与否都必须先算（hooks 必须恒定顺序，不能放到 early-return 后）
  const vipLabel = useMemo(() => {
    const v = profile?.vipType || 0;
    if (v >= 110) return '黑胶 SVIP';
    if (v >= 10) return '黑胶 VIP';
    if (v > 0) return 'VIP';
    return '普通用户';
  }, [profile]);

  // 加载歌单 / 播放记录 / 云盘
  // 重点：deps 只含 uid —— 其他依赖通过 ref 读取，避免 OSContext 每秒 tick 触发循环刷新
  const reload = useCallback(async (force=false) => {
    const curCfg = cfgRef.current;
    if (!uid || !curCfg.cookie) return;
    setLoading(true);
    try {
      const [plRes, recRes, clRes] = await Promise.allSettled([
        (async()=>{
          const key='music-netease-index:'+uid;
          if(!force){const saved=await DB.getAsset(key);if(saved){const cached=JSON.parse(saved);if(Array.isArray(cached))return {playlist:cached};}}
          let result=force?await musicApi._raw(curCfg,'/user/playlist',{uid,limit:60,offset:0}):await musicApi.userPlaylist(curCfg,uid);
          if(force&&Array.isArray(result?.playlist)){
            const all=[...result.playlist];let offset=all.length;
            while(result.more===true || result.playlist.length===60){
              const page=await musicApi._raw(curCfg,'/user/playlist',{uid,limit:60,offset});
              if(!Array.isArray(page?.playlist))throw Error('歌单分页读取失败');
              const fresh=page.playlist.filter((p:any)=>!all.some((x:any)=>x.id===p.id));
              if(!fresh.length){if(page.more)throw Error('网易云歌单分页未完成');break;}
              all.push(...fresh);offset+=page.playlist.length;result=page;
              if(offset>10000)throw Error('歌单数量过多，请稍后重试');
            }
            result={...result,playlist:all};
          }
          if(!Array.isArray(result?.playlist))throw Error(result?.message||'歌单读取失败');
          await DB.saveAsset(key,JSON.stringify(result.playlist));
          return result;
        })(),
        musicApi.userRecord(curCfg, uid, 1),
        musicApi.userCloud(curCfg),
      ]);

      if (plRes.status === 'fulfilled') {
        const arr = (plRes.value?.playlist || []).map((p: any): Playlist => ({
          id: p.id,
          name: p.name,
          coverImgUrl: toHttps(p.coverImgUrl || ''),
          trackCount: p.trackCount || 0,
          subscribed: !!p.subscribed,
          creatorNickname: p.creator?.nickname,
        }));
        setPlaylists(arr);
      } else if(force)throw plRes.reason;

      if (recRes.status === 'fulfilled') {
        const weekly = recRes.value?.weekData || recRes.value?.allData || [];
        const mapped: RecordItem[] = weekly.map((r: any): RecordItem => ({
          score: r.score || 0,
          playCount: r.playCount || 0,
          song: {
            id: r.song?.id,
            name: r.song?.name || '',
            artists: (r.song?.ar || []).map((a: any) => a.name).join(' / '),
            album: r.song?.al?.name || '',
            albumPic: toHttps(r.song?.al?.picUrl || ''),
            duration: (r.song?.dt || 0) / 1000,
            fee: r.song?.fee ?? 0,
          },
        }));
        setRecords(mapped);
      }

      if (clRes.status === 'fulfilled') {
        const clData = clRes.value?.data || [];
        const mapped: Song[] = clData.map((c: any): Song => ({
          id: c.songId || c.simpleSong?.id,
          name: c.songName || c.simpleSong?.name || '',
          artists: c.artist || (c.simpleSong?.ar || []).map((a: any) => a.name).join(' / '),
          album: c.album || c.simpleSong?.al?.name || '',
          albumPic: toHttps(c.simpleSong?.al?.picUrl || ''),
          duration: (c.simpleSong?.dt || 0) / 1000,
          fee: 0,
        }));
        setCloud(mapped);
      }
    } catch (e: any) {
      toastRef.current(`加载失败：${e.message}`, 'error');
      if(force)throw e;
    } finally {
      setLoading(false);
    }
  }, [uid]);

  useEffect(() => { reload(); }, [reload]);

  const [syncing,setSyncing]=useState(false);
  const syncLock=useRef(false);
  const loadImportTracks = async (source:{id:number;trackCount:number},force=false) => {
    return loadNeteasePlaylistSongs(source,(limit,offset)=>force?musicApi._raw(cfgRef.current,'/playlist/track/all',{id:source.id,limit,offset}):musicApi.playlistTrackAll(cfgRef.current,source.id,limit,offset));
  };

  const syncAll = async () => {
    if(syncLock.current)return;syncLock.current=true;setSyncing(true);
    try {
      await reload(true);
      const raw=await DB.getAsset('music-netease-index:'+uid);
      if(!raw)throw Error('没有读取到网易云歌单');
      const sources=JSON.parse(raw);let failed=0;
      for(const source of sources){try{await importNeteasePlaylist({...source,coverImgUrl:toHttps(source.coverImgUrl||'')},await loadImportTracks(source,true));}catch{failed++;}}
      toastRef.current(failed?`已完成同步，${failed} 个歌单未完成，可再次同步重试`:`已同步并保存 ${sources.length} 个歌单`,failed?'info':'success');
    }catch(e){toastRef.current('同步失败：'+String(e),'error');}finally{syncLock.current=false;setSyncing(false);}
  };

  // 签到
  const doSignIn = useCallback(async () => {
    trackEvent('做一次网易云每日签到');
    try {
      await musicApi.dailySignin(cfgRef.current, 1);
      setSignedIn(true);
      toastRef.current('签到成功 +5', 'success');
    } catch (e: any) {
      if (String(e.message).includes('重复')) {
        setSignedIn(true);
        toastRef.current('今天已经签过了', 'info');
      } else {
        toastRef.current(`签到失败：${e.message}`, 'error');
      }
    }
  }, []);

  // 登出
  const doLogout = useCallback(async () => {
    const curCfg = cfgRef.current;
    try { await musicApi.logout(curCfg); } catch {}
    setCfg({ ...curCfg, cookie: '' });
    toastRef.current('已退出', 'success');
    trackEvent('退出网易云登录');
    await refreshProfile();
  }, [setCfg, refreshProfile]);

  // 未登录也保留本地歌单与音乐管理入口，登录面板由用户主动打开。
  // ⚠️ 所有 hooks 必须在这个 early-return **之前** 声明完。
  if (!cfg.cookie || !profile) {
    if (showNeteaseLogin) {
      return (
        <NeteaseLoginPanel
          onBack={() => setShowNeteaseLogin(false)}
          onLoggedIn={async (cookie) => {
            setCfg({ ...cfgRef.current, cookie });
            await new Promise(r => setTimeout(r, 300));
            await refreshProfile();
            toastRef.current('登录成功', 'success');
            setShowNeteaseLogin(false);
          }}
        />
      );
    }
    // 有本地专辑 → 简洁单页：仅 album + 一个登录入口卡
    return (
      <div className="flex flex-col h-full relative"
        style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
        <BokehBg />
        <MizuHeader title="My Cloud" onBack={onBack} right={<button type="button" className="text-[11px] px-2 py-1" onClick={()=>onManage?.()}>音乐管理</button>}/>
        <div className="relative z-10 flex-1 overflow-y-auto pb-24 px-3 pt-3 shizuku-scrollbar">
          {/* 本地专辑卡 */}
          <PersonalPlaylistsPanel onManage={onManage} onOpenPlayer={onOpenPlayer}/>
          {localAlbumSongs.length>0&&<LocalAlbumCard
            songs={localAlbumSongs}
            expanded={localAlbumExpanded}
            setExpanded={setLocalAlbumExpanded}
            currentId={current?.id ?? null}
            playing={playing}
            onPlay={(s, idx) => {
              playSong(s, { alsoSetQueue: true, replaceQueue: localAlbumSongs, startIdx: idx });
              trackEvent('播放「我的」页列表里的一首歌', { source: 'local' });
            }}
            onRemove={removeLocalSong}
          />}
          {/* 登录入口卡 */}
          <button
            onClick={() => setShowNeteaseLogin(true)}
            className="mt-3 w-full rounded-2xl shizuku-glass p-4 flex items-center gap-3 transition-all active:scale-[0.99]"
          >
            <div className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{ background: `linear-gradient(135deg, ${C.faint}40, ${C.muted}30)`, border: `1px solid ${C.faint}40` }}>
              <UserIcon size={18} color={C.muted} weight="duotone" />
            </div>
            <div className="flex-1 text-left">
              <div className="text-sm" style={{ color: C.text }}>登录网易云</div>
              <div className="text-[10.5px]" style={{ color: C.muted }}>解锁海量曲库 · 自己的歌单 · 一起听</div>
            </div>
            <span className="text-[12px]" style={{ color: C.accent }}>→</span>
          </button>
        </div>
        {current && (
          <MiniPlayer
            name={current.name}
            artists={current.artists}
            albumPic={current.albumPic}
            playing={playing}
            onTap={onOpenPlayer}
            onPrev={prevSong}
            onToggle={togglePlay}
            onNext={nextSong}
            userAvatar={userProfile?.avatar}
            userName={userProfile?.name}
            companions={companions}
            onKickCompanion={removeListeningPartner}
            regenStatus={current.id === regeneratingId ? regeneratingStatus : undefined}
          />
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full relative"
      style={{ background: `linear-gradient(180deg, #ffffff 0%, ${C.bg} 50%, ${C.bgDeep} 100%)` }}>
      <BokehBg />
      <MizuHeader
        title="My Cloud"
        onBack={onBack}
        right={
          <div className="flex items-center gap-1">
            {onOpenSearch && (
              <button
                onClick={onOpenSearch}
                className="p-1.5 rounded-full transition-all"
                style={{ color: C.primary }}
                title="搜索"
              >
                <MagnifyingGlass size={16} weight="bold" />
              </button>
            )}
            {onOpenSettings && (
              <button
                onClick={onOpenSettings}
                className="p-1.5 rounded-full transition-all"
                style={{ color: C.primary }}
                title="设置"
              >
                <Gear size={16} weight="bold" />
              </button>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto relative z-10 shizuku-scrollbar pb-20">
        {/* Banner 头图 */}
        <div className="relative h-32 overflow-hidden">
          {profile.backgroundUrl ? (
            <img src={profile.backgroundUrl} className="absolute inset-0 w-full h-full object-cover" alt="" />
          ) : (
            <div className="absolute inset-0" style={{ background: `linear-gradient(135deg, ${C.accent}40, ${C.sakura}40, ${C.lavender}40)` }} />
          )}
          <div className="absolute inset-0" style={{ background: `linear-gradient(180deg, transparent 0%, ${C.bg}CC 100%)` }} />
        </div>

        {/* 用户卡 */}
        <div className="-mt-12 mx-4 rounded-3xl p-4 shizuku-glass-strong relative z-10"
          style={{ boxShadow: `0 10px 40px ${C.glow}15` }}>
          <div className="flex items-center gap-3">
            <div className="relative shrink-0">
              <img
                src={profile.avatarUrl || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                alt=""
                className="w-16 h-16 rounded-2xl object-cover"
                style={{ border: `2px solid ${C.glow}60`, boxShadow: `0 4px 20px ${C.glow}30` }}
              />
              <div className="absolute -bottom-1 -right-1">
                <Sparkle size={10} color={C.sakura} delay={0.3} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-base font-semibold truncate" style={{ color: C.text, fontFamily: `'Noto Serif', serif` }}>
                {profile.nickname}
              </div>
              <div className="text-[10px] mt-0.5 truncate" style={{ color: C.muted }}>
                {profile.signature || '—'}
              </div>
              <div className="flex items-center gap-1.5 mt-1.5">
                <span className="text-[9px] px-2 py-0.5 rounded-full text-white font-medium"
                  style={{ background: `linear-gradient(135deg, ${C.vip}, #e0b88a)`, letterSpacing: '0.05em' }}>
                  {vipLabel}
                </span>
                <span className="text-[9px] px-2 py-0.5 rounded-full" style={{ color: C.muted, border: `1px solid ${C.faint}40` }}>
                  UID · {profile.userId}
                </span>
              </div>
            </div>
          </div>

          {/* 统计行 */}
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            <StatCell label="歌单" value={playlists.length || profile.playlistCount || 0} />
            <StatCell label="关注" value={profile.follows ?? 0} />
            <StatCell label="粉丝" value={profile.followeds ?? 0} />
          </div>

          {/* 快捷按钮 */}
          <div className="grid grid-cols-4 gap-2 mt-3" aria-label="音乐快捷操作">
            <button
              onClick={doSignIn}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all shizuku-glass"
              style={{ color: signedIn ? C.muted : C.primary, border: `1px solid ${signedIn ? C.faint : C.primary}30` }}
            >
              {signedIn ? '已签到 ✓' : '每日签到'}
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await musicApi.recommendSongs(cfg);
                  const songs: Song[] = (r?.data?.dailySongs || r?.recommend || []).map((s: any): Song => ({
                    id: s.id, name: s.name,
                    artists: (s.ar || s.artists || []).map((a: any) => a.name).join(' / '),
                    album: s.al?.name || s.album?.name || '',
                    albumPic: toHttps(s.al?.picUrl || s.album?.picUrl || ''),
                    duration: (s.dt || s.duration || 0) / 1000,
                    fee: s.fee ?? 0,
                  }));
                  if (!songs.length) { addToast('还没有每日推荐', 'info'); return; }
                  playSong(songs[0], { replaceQueue: songs, startIdx: 0 });
                  onOpenPlayer();
                  trackEvent('播放每日推荐');
                } catch (e: any) { addToast(`获取失败：${e.message}`, 'error'); }
              }}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all text-white"
              style={{ background: `linear-gradient(135deg, ${C.primary}, ${C.accent})`, boxShadow: `0 2px 10px ${C.glow}30` }}
            >
              每日推荐
            </button>
            <button
              onClick={async () => {
                try {
                  const r = await musicApi.personalFm(cfg);
                  const songs: Song[] = (r?.data || []).map((s: any): Song => ({
                    id: s.id, name: s.name,
                    artists: (s.artists || s.ar || []).map((a: any) => a.name).join(' / '),
                    album: s.album?.name || s.al?.name || '',
                    albumPic: toHttps(s.album?.picUrl || s.al?.picUrl || ''),
                    duration: (s.duration || s.dt || 0) / 1000,
                    fee: s.fee ?? 0,
                  }));
                  if (!songs.length) { addToast('FM 暂无歌曲', 'info'); return; }
                  playSong(songs[0], { replaceQueue: songs, startIdx: 0 });
                  onOpenPlayer();
                  trackEvent('播放私人 FM');
                } catch (e: any) { addToast(`FM 失败：${e.message}`, 'error'); }
              }}
              className="flex-1 py-2 rounded-xl text-[11px] transition-all shizuku-glass"
              style={{ color: C.accent, border: `1px solid ${C.accent}30` }}
            >
              私人 FM
            </button>
            <button type="button" onClick={()=>onManage?.()} className="py-2 rounded-xl text-[11px] transition-all shizuku-glass whitespace-nowrap" style={{color:C.primary,border:`1px solid ${C.primary}30`}}>音乐管理</button>
          </div>

          <button
            onClick={doLogout}
            className="w-full mt-2 py-1.5 rounded-xl text-[10px] transition-all"
            style={{ color: C.faint }}
          >
            退出登录
          </button>
        </div>

        {/* 拜访 · 其他人的音乐角落 */}
        {onVisitChar && characters.length > 0 && (
          <div className="mx-4 mt-4">
            <div className="flex items-center gap-2 mb-2 px-1">
              <Sparkle size={6} color={C.lavender} delay={0.4} />
              <span className="text-[10px] tracking-[0.2em] uppercase" style={{ color: C.muted }}>
                去拜访 · 他们的音乐角落
              </span>
            </div>
            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 shizuku-scrollbar">
              {characters.map(ch => {
                const initialized = !!ch.musicProfile?.initializedAt;
                const avatar = ch.avatar || '';
                // 头像可能是 base64 / 图床直链 / blobref 令牌，三种都算图；其余当 emoji 或首字兜底。
                const isImage = avatar.startsWith('data:') || avatar.startsWith('http') || isBlobRef(avatar);
                return (
                  <button
                    key={ch.id}
                    onClick={() => onVisitChar(ch.id)}
                    className="shrink-0 text-center group"
                    title={initialized ? `拜访 ${ch.name} 的音乐角落` : `${ch.name} 还没开启音乐角落`}
                  >
                    <div className="relative w-14 h-14 mx-auto">
                      {isImage ? (
                        <TokenImg
                          value={avatar}
                          alt=""
                          className="w-14 h-14 rounded-full object-cover transition-transform group-active:scale-95"
                          style={{
                            border: `2px solid ${initialized ? C.accent : C.faint}60`,
                            boxShadow: initialized ? `0 2px 12px ${C.glow}40` : 'none',
                            opacity: initialized ? 1 : 0.55,
                          }}
                        />
                      ) : (
                        <div
                          className="w-14 h-14 rounded-full flex items-center justify-center text-white text-lg font-semibold transition-transform group-active:scale-95"
                          style={{
                            background: initialized
                              ? `linear-gradient(135deg, ${C.primary}, ${C.lavender})`
                              : `linear-gradient(135deg, ${C.faint}, ${C.muted})`,
                            border: `2px solid ${initialized ? C.accent : C.faint}60`,
                            boxShadow: initialized ? `0 2px 12px ${C.glow}40` : 'none',
                            opacity: initialized ? 1 : 0.7,
                            fontFamily: `'Noto Serif', serif`,
                          }}
                        >
                          {avatar || ch.name.slice(0, 1)}
                        </div>
                      )}
                      {!initialized && (
                        <div className="absolute -bottom-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold"
                          style={{ background: C.bg, color: C.muted, border: `1px solid ${C.faint}60` }}>
                          +
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] mt-1 max-w-[60px] truncate"
                      style={{ color: initialized ? C.text : C.faint }}>
                      {ch.name}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Tabs */}
        <div className="mx-4 mt-5 flex items-center gap-1 shizuku-glass rounded-full p-1">
          {([
            { k: 'playlist', label: '歌单' },
            { k: 'record', label: '最近' },
            { k: 'cloud', label: '云盘' },
          ] as const).map(t => (
            <button
              key={t.k}
              onClick={() => { setTab(t.k); trackEvent('切换我的云音乐标签', { tab: t.k }); }}
              className="flex-1 py-1.5 rounded-full text-[11px] tracking-wider transition-all"
              style={{
                background: tab === t.k ? `linear-gradient(135deg, ${C.primary}, ${C.accent})` : 'transparent',
                color: tab === t.k ? 'white' : C.muted,
              }}
            >
              {t.label}
            </button>
          ))}
          <button type="button" aria-label="同步网易云歌单" disabled={syncing||loading} onClick={()=>void syncAll()} className="flex-1 py-1.5 rounded-full text-[11px] tracking-wider disabled:opacity-40" style={{color:C.muted}}>{syncing?'同步中…':'同步'}</button>
        </div>

        {loading && (
          <div className="text-center text-[10px] mt-6" style={{ color: C.faint }}>
            <span className="inline-block w-3 h-3 border-2 rounded-full animate-spin"
              style={{ borderColor: `${C.faint}40`, borderTopColor: C.primary }} />
            <span className="ml-2">loading...</span>
          </div>
        )}

        {tab==='playlist'&&<>
          <PersonalPlaylistsPanel sources={playlists} loadTracks={loadImportTracks} onManage={onManage} onOpenPlayer={onOpenPlayer}/>
          {localAlbumSongs.length>0&&<div className="px-3 mt-3"><LocalAlbumCard songs={localAlbumSongs} expanded={localAlbumExpanded} setExpanded={setLocalAlbumExpanded} currentId={current?.id??null} playing={playing} onPlay={(song,index)=>{playSong(song,{replaceQueue:localAlbumSongs,startIdx:index});onOpenPlayer();}} onRemove={removeLocalSong}/></div>}
        </>}

        {tab === 'record' && (
          <div className="px-3 mt-3 space-y-1">
            {records.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>最近一周还没有播放记录</div>
            )}
            {records.map((r, i) => (
              <button key={r.song.id + '-' + i}
                onClick={() => {
                  const q = records.map(x => x.song);
                  playSong(r.song, { replaceQueue: q, startIdx: i });
                  onOpenPlayer();
                  trackEvent('播放「我的」页列表里的一首歌', { source: 'record' });
                }}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <div className="text-[10px] w-5 text-center shrink-0" style={{ color: C.faint }}>{i + 1}</div>
                <TokenImg value={r.song.albumPic} alt="" className="w-10 h-10 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: C.text }}>{r.song.name}</div>
                  <div className="text-[10px] truncate" style={{ color: C.muted }}>{r.song.artists}</div>
                </div>
                <div className="text-[9px] shrink-0 text-right" style={{ color: C.accent }}>
                  <div>×{r.playCount}</div>
                  <div className="opacity-60">{Math.round(r.score)}°</div>
                </div>
              </button>
            ))}
          </div>
        )}

        {tab === 'cloud' && (
          <div className="px-3 mt-3 space-y-1">
            {cloud.length === 0 && !loading && (
              <div className="text-center text-[11px] py-10" style={{ color: C.faint }}>云盘里还没有歌曲</div>
            )}
            {cloud.map((s, i) => (
              <button key={s.id + '-' + i}
                onClick={() => {
                  playSong(s, { replaceQueue: cloud, startIdx: i });
                  onOpenPlayer();
                  trackEvent('播放「我的」页列表里的一首歌', { source: 'cloud' });
                }}
                className="w-full flex items-center gap-3 p-2 rounded-2xl text-left transition-all"
                style={{ background: 'rgba(255,255,255,0.06)' }}
              >
                <TokenImg value={s.albumPic || 'https://p1.music.126.net/y19E5SadGUmSR8SZxkrNtw==/109951163965029180.jpg'}
                  alt="" className="w-10 h-10 rounded-lg object-cover" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: C.text }}>{s.name}</div>
                  <div className="text-[10px] truncate" style={{ color: C.muted }}>{s.artists} · {s.album}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {current && (
        <MiniPlayer
          name={current.name}
          artists={current.artists}
          albumPic={current.albumPic}
          playing={playing}
          onTap={onOpenPlayer}
          onPrev={prevSong}
          onToggle={togglePlay}
          onNext={nextSong}
          userAvatar={userProfile?.avatar}
          userName={userProfile?.name}
          companions={companions}
          onKickCompanion={removeListeningPartner}
          regenStatus={current.id === regeneratingId ? regeneratingStatus : undefined}
        />
      )}
    </div>
  );
};

const StatCell: React.FC<{ label: string; value: number }> = ({ label, value }) => (
  <div className="rounded-xl py-1.5 shizuku-glass">
    <div className="text-base font-light" style={{ color: C.primary, fontFamily: `'Noto Serif', serif` }}>{value}</div>
    <div className="text-[9px] tracking-wider" style={{ color: C.muted }}>{label}</div>
  </div>
);

export default NeteaseProfilePage;
