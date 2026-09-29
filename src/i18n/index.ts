import english from './en.json';

export type Locale = 'en' | 'zh-CN';
export const LANGUAGE_KEY = 'guan.international.language.v1';
const catalog: Readonly<Record<string, string>> = english;
const listeners = new Set<() => void>();
let locale: Locale = 'en';
try { if (typeof localStorage !== 'undefined' && localStorage.getItem(LANGUAGE_KEY) === 'zh-CN') locale = 'zh-CN'; } catch { /* Language switching still works when storage is blocked. */ }

export const getLocale = (): Locale => locale;
export const subscribeLocale = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export function setLocale(next: Locale): void {
  if (next !== 'en' && next !== 'zh-CN') return;
  locale = next;
  try { localStorage.setItem(LANGUAGE_KEY, next); } catch { /* Keep the in-memory preference. */ }
  syncDocumentLanguage();
  listeners.forEach(listener => listener());
}
export function syncDocumentLanguage(): void {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = locale;
  document.title = locale === 'en' ? 'GUAN · International Edition' : 'GUAN · 国际分享版';
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Historical journals keep their original messages. Translate these only at the
// presentation boundary, with the same catalog used for newly rendered text.
const patterns = Object.entries(catalog).filter(([key]) => /\{\d+\}/.test(key)).map(([key, value]) => {
  const parts = key.split(/(\{\d+\})/);
  const order = parts.filter(part => /^\{\d+\}$/.test(part)).map(part => Number(part.slice(1, -1)));
  const fixed = parts.filter(part => !/^\{\d+\}$/.test(part)).join('');
  return { value, order, weight: fixed.length, regex: new RegExp('^' + parts.map(part => /^\{\d+\}$/.test(part) ? '([\\s\\S]*?)' : escape(part)).join('') + '$') };
}).filter(pattern => pattern.weight > 0).sort((a, b) => b.weight - a.weight);
const cache = new Map<string, string>();
function toEnglish(source: string, depth = 0): string {
  if (!/[\u3400-\u9fff]/.test(source) || depth > 8) return source;
  if (catalog[source] !== undefined && !/\{\d+\}/.test(source)) return catalog[source];
  const trimmed = source.trim();
  if (catalog[trimmed] !== undefined && !/\{\d+\}/.test(trimmed)) return catalog[trimmed];
  const cached = cache.get(source);
  if (cached !== undefined) return cached;
  let translated = source;
  for (const pattern of patterns) {
    const match = pattern.regex.exec(source);
    if (!match) continue;
    const values = new Map(pattern.order.map((key, index) => [key, toEnglish(match[index + 1], depth + 1)]));
    translated = pattern.value.replace(/\{(\d+)\}/g, (_, index: string) => values.get(Number(index)) ?? '');
    break;
  }
  // Compound labels in engine journals join already-known labels and ranks.
  // Do not rewrite unknown prose or identifiers with word-by-word substitutions.
  if (translated === source) {
    const pieces = source.split(/( · |；|。|\n|、| \/ )/);
    if (pieces.length > 1) translated = pieces.map(part => part === '。' ? '. ' : part === '；' ? '; ' : part === '、' ? ', ' : toEnglish(part, depth + 1)).join('');
  }
  if (cache.size >= 4096) cache.clear();
  cache.set(source, translated);
  return translated;
}

/** Source keys stay Chinese so old persisted labels remain readable in either
 * language. IDs, rules, actions, strategy inputs and saved data never pass here. */
export function t(source: string, values?: readonly (string | number)[]): string {
  const template = locale === 'en' ? catalog[source] ?? toEnglish(source) : source;
  return values ? template.replace(/\{(\d+)\}/g, (token, index: string) => {
    const value = values[Number(index)];
    return value === undefined ? token : String(value);
  }) : template;
}

/** Localize textual render values without traversing elements, changing props,
 * or touching the DOM. Numbers, booleans, refs and React elements are retained. */
export function tx<T>(value: T): T {
  if (typeof value === 'string') return t(value) as T;
  if (Array.isArray(value)) return value.map(item => tx(item)) as T;
  return value;
}

export const dateLocale = () => locale === 'en' ? 'en-US' : 'zh-CN';
