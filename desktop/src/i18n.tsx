import { createContext, useContext, useEffect, useMemo, useState } from "react";

export type Locale = "zh-CN" | "en";

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

const STORAGE_KEY = "singright-locale-v1";
const I18nContext = createContext<I18nContextValue | null>(null);

function normalizeLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  return value.toLowerCase().startsWith("zh") ? "zh-CN" : value.toLowerCase().startsWith("en") ? "en" : null;
}

function initialLocale(): Locale {
  const saved = normalizeLocale(localStorage.getItem(STORAGE_KEY));
  if (saved) return saved;
  const buildDefault = normalizeLocale(import.meta.env.VITE_DEFAULT_LOCALE);
  if (buildDefault) return buildDefault;
  return normalizeLocale(navigator.languages?.[0] || navigator.language) ?? "en";
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const value = useMemo<I18nContextValue>(() => ({
    locale,
    setLocale(nextLocale) {
      localStorage.setItem(STORAGE_KEY, nextLocale);
      document.documentElement.lang = nextLocale;
      setLocaleState(nextLocale);
    },
  }), [locale]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = locale === "zh-CN" ? "SingRight 准唱" : "SingRight Pitch Trainer";
  }, [locale]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error("useI18n must be used inside I18nProvider");
  return context;
}

export function localize(locale: Locale, zh: string, en: string): string {
  return locale === "zh-CN" ? zh : en;
}
