import { createContext, useContext } from "react";
import { en } from "./en";
import { zhCN } from "./zh-CN";
import { zhTW } from "./zh-TW";
import type { Translations } from "./en";

export type Locale = "en" | "zh-CN" | "zh-TW";

export const LOCALE_LABELS: Record<Locale, string> = {
  "en":    "English",
  "zh-CN": "简体中文",
  "zh-TW": "繁體中文",
};

export const LOCALES = Object.keys(LOCALE_LABELS) as Locale[];

const TRANSLATIONS: Record<Locale, Translations> = { en, "zh-CN": zhCN, "zh-TW": zhTW };

export function getTranslations(locale: Locale): Translations {
  return TRANSLATIONS[locale] ?? en;
}

export const I18nContext = createContext<Translations>(en);

export function useT(): Translations {
  return useContext(I18nContext);
}

export type { Translations };
