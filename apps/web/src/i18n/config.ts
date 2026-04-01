import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import enCommon from "../locales/en/common.json";
import ruCommon from "../locales/ru/common.json";
import zhCommon from "../locales/zh/common.json";

void i18n.use(initReactI18next).init({
  resources: {
    en: { common: enCommon },
    zh: { common: zhCommon },
    ru: { common: ruCommon },
  },
  lng: localStorage.getItem("lang") ?? "zh",
  fallbackLng: "en",
  defaultNS: "common",
  ns: ["common"],
  interpolation: { escapeValue: false },
});

export default i18n;
