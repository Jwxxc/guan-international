import { tx } from '../i18n';
import { LanguagePicker } from '../i18n/react';
import { Brand } from '../components/Brand';
import { RoomAtmosphere } from '../components/RoomAtmosphere';
import { ArrowRight, Ban, BarChart3, BookOpen, Eye, History, Music2, Settings2, VolumeX } from 'lucide-react';
import { rankName, RANKS } from '../engine/rules';
import type { ReactNode } from 'react';
import '../styles/home-settings.css';
export function Home({ levelRank, onLevel, canContinue, canReplay, onStart, onContinue, onReplay, onRules, onSettings, onStatistics, onSpectate, musicEnabled, onMusicToggle, mode = 'practice', onMode, continueMode, continueComplete = false, continueDetails = [], aiControl, newGameDisabled = false, onPrivate }: {
  levelRank: number; onLevel: (rank: number) => void; canContinue: boolean; canReplay: boolean;
  onStart: () => void; onContinue: () => void; onReplay: () => void; onRules: () => void; onSettings: () => void;
  musicEnabled?: boolean; onMusicToggle?: () => void;
  onPrivate?: () => void; onStatistics?: () => void; onSpectate?: () => void;
  mode?: 'match' | 'practice'; onMode?: (mode: 'match' | 'practice') => void; continueMode?: string; continueComplete?: boolean;
  continueDetails?: string[]; aiControl?: ReactNode; newGameDisabled?: boolean;
}) {
  const resumePrimary = canContinue && !continueComplete;
  return <main className="home-screen room-home home-refined">
    <RoomAtmosphere/>
    <header className="home-header">
      <a className="brand with-image home-brand" href="#" aria-label={tx("GUAN 首页 · by Zhuzhu")}><Brand/><small className="home-brand-credit">by Zhuzhu</small></a>
      <nav className="home-nav" aria-label={tx("牌室菜单")}>
        <LanguagePicker compact/>
        <button className="quiet-button" onClick={onRules}><BookOpen size={16} />{tx("玩法说明")}</button>
        {tx(onStatistics && <button className="quiet-button" onClick={onStatistics}><BarChart3 size={16}/>{tx("个人战绩")}</button>)}
        {tx(onSpectate && <button className="quiet-button home-study-button" onClick={onSpectate}><Eye size={16}/>{tx("观战研习")}</button>)}
        <button className={`quiet-button music-toggle ${musicEnabled ? 'is-on' : ''}`} onClick={onMusicToggle} aria-label={tx(musicEnabled ? '关闭背景音乐' : '开启背景音乐')}>{tx(musicEnabled ? <Music2 size={16}/> : <VolumeX size={16}/>)}<span>{tx("背景音乐")}</span><i className="music-status-light" /></button>
        <button className="quiet-button" onClick={onSettings} aria-label={tx("设置")}><Settings2 size={17}/>{tx("设置")}</button>
      </nav>
    </header>
    <div className="home-content">
      <div className="home-copy">
        <div className="start-zone">
          {tx(onMode && <div className="mode-picker" role="group" aria-label={tx("选择对局模式")}><button type="button" aria-pressed={mode === 'match'} onClick={() => onMode('match')}>{tx("经典升级")}</button><button type="button" aria-pressed={mode === 'practice'} onClick={() => onMode('practice')}>{tx("单副练习")}</button>{tx(onPrivate && <button type="button" className="private-mode-disabled" aria-pressed={false} disabled title={tx("暂未开放")}><Ban size={13} aria-hidden="true"/>{tx("私人牌局")}</button>)}</div>)}
          {tx(canContinue && <button className={`${resumePrimary ? 'primary-button' : 'secondary-button'} home-resume-button`} onClick={onContinue} data-testid="home-continue" aria-label={tx(continueComplete ? '查看整场结算' : '继续对局')} aria-describedby="home-continue-details">
            <span className="home-resume-heading"><strong>{tx(continueComplete ? '查看整场结算' : '继续对局')}</strong><ArrowRight size={21}/></span>
            <span id="home-continue-details" className="home-resume-meta"><span className="home-resume-mode">{tx(continueMode)}</span>{tx(continueDetails.map((detail, index) => <small key={index}>{tx(detail)}</small>))}</span>
          </button>)}
          {tx(canContinue && <div className="home-new-heading">{tx(mode === 'match' ? '新开一场升级赛' : '新开一副练习')}</div>)}
          <div className="practice-config"><div><span className="section-caption">{tx("对局规则")}</span><p>{tx(mode === 'match' ? '两队独立升级 · 进贡还贡 · 过 A 通关' : '两副纸牌 · 四人两队')}</p></div>{tx(mode === 'practice' ? <label className="level-picker">{tx("级牌")}<select aria-label={tx("选择练习级牌")} value={levelRank} onChange={e => onLevel(Number(e.target.value))}>{tx(RANKS.map(rank => <option key={rank} value={rank}>{tx(rankName(rank))}</option>))}</select></label> : <span className="match-start-rank" aria-label={tx("两队均从 2 开始")}>2 <span>→</span> A</span>)}</div>
          {tx(aiControl)}
          <button className={`${resumePrimary ? 'secondary-button' : 'primary-button'} start-button`} disabled={newGameDisabled} onClick={onStart}>{tx(mode === 'match' ? '开始升级赛' : '开始练习')} <ArrowRight size={21}/></button>
          <div className="home-secondary">{tx(canReplay && <button className="text-button" onClick={onReplay}><History size={14}/>{tx("最近回放")}</button>)}<span>{tx(mode === 'match' ? '逐副保存进度' : `♥${rankName(levelRank)} 为逢人配`)}</span></div>
        </div>
      </div>
    </div>
  </main>;
}
