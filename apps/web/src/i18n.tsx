// i18n module.
//
// Adding a new language is a two-step change:
//   1. Drop `src/locales/<code>.json` alongside the existing catalogs.
//   2. Register it in `catalogs` below and add a `lang.<code>` key to
//      every catalog (it's the label shown in the language switcher).
// No other file needs to change.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import en from './locales/en.json';
import hi from './locales/hi.json';

const catalogs = { en, hi } as const;

export type Lang = keyof typeof catalogs;
export const LANGS: readonly Lang[] = Object.keys(catalogs) as Lang[];

const STORAGE_KEY = 'nsf.lang';

function readInitial(): Lang {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored && stored in catalogs) return stored as Lang;
  const nav = window.navigator.language.slice(0, 2).toLowerCase();
  return (nav in catalogs ? nav : 'en') as Lang;
}

function lookup(lang: Lang, key: string): string {
  const catalog = catalogs[lang] as Record<string, string>;
  const fallback = catalogs.en as Record<string, string>;
  return catalog[key] ?? fallback[key] ?? key;
}

function interpolate(
  template: string,
  params?: Record<string, string | number>,
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) =>
    k in params ? String(params[k]) : `{${k}}`,
  );
}

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
  tPlural: (
    baseKey: string,
    count: number,
    params?: Record<string, string | number>,
  ) => string;
};

const Ctx = createContext<Ctx | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(() => readInitial());

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, lang);
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = useCallback((l: Lang) => setLangState(l), []);

  const t = useCallback(
    (key: string, params?: Record<string, string | number>) =>
      interpolate(lookup(lang, key), params),
    [lang],
  );

  const tPlural = useCallback(
    (
      baseKey: string,
      count: number,
      params?: Record<string, string | number>,
    ) => {
      const k = count === 1 ? `${baseKey}_one` : `${baseKey}_other`;
      return interpolate(lookup(lang, k), { ...params, n: count });
    },
    [lang],
  );

  const value = useMemo(
    () => ({ lang, setLang, t, tPlural }),
    [lang, setLang, t, tPlural],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): Ctx {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside LanguageProvider');
  return v;
}
