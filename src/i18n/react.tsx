import { useSyncExternalStore } from 'react';
import { getLocale, setLocale, subscribeLocale, t } from './index';

export function useLocale() {
  return useSyncExternalStore(subscribeLocale, getLocale, () => 'en' as const);
}

export function LanguagePicker({ compact = false }: { compact?: boolean }) {
  const locale = useLocale();
  return <label className={`language-picker ${compact ? 'language-picker-compact' : ''}`}>
    <span aria-hidden="true">◎</span>
    {!compact && <span>{t('语言')}</span>}
    <select aria-label="Language / 语言" value={locale} onChange={event => setLocale(event.target.value === 'zh-CN' ? 'zh-CN' : 'en')}>
      <option value="en" lang="en">English</option>
      <option value="zh-CN" lang="zh-CN">中文</option>
    </select>
  </label>;
}
