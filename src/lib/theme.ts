// الوضع الداكن — ألوان الشعار نفسها: زمرّدي عميق كخلفية، ذهبي للإبراز، وكريمي للنص.
// داكن افتراضياً، ويُحفظ اختيار الموظف على جهازه. الإيصال (طباعة) وصفحة متابعة الزبون
// لهما تصميمهما الخاص ولا يتأثران.
import { useEffect, useState } from "react";

export type Theme = "dark" | "light";
const KEY = "repair.theme";
const EVENT = "repair-theme";

export function getTheme(): Theme {
  try {
    return localStorage.getItem(KEY) === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}

/** يطبّق الوضع على <html> (خلفية الصفحة كلها ولون شريط المتصفح). */
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("app-dark", theme === "dark");
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#06150f" : "#0c2e20");
}

export function setTheme(theme: Theme) {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* التخزين غير متاح — يبقى الاختيار لهذه الجلسة فقط */
  }
  applyTheme(theme);
  window.dispatchEvent(new Event(EVENT));
}

export function useTheme(): [Theme, () => void] {
  const [theme, set] = useState<Theme>(getTheme);
  useEffect(() => {
    const sync = () => set(getTheme());
    window.addEventListener(EVENT, sync);
    return () => window.removeEventListener(EVENT, sync);
  }, []);
  return [theme, () => setTheme(theme === "dark" ? "light" : "dark")];
}

// يُطبَّق فور تحميل التطبيق حتى لا تومض الصفحة بيضاء قبل أن تصبح داكنة.
applyTheme(getTheme());
