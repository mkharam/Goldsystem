import "server-only";
import { db } from "./db";

const DEFAULTS = {
  weight_tolerance_grams: "0.05",
  default_turnaround_days: "3",
  shop_name: "مجوهرات",
  receipt_footer: "يرجى الاحتفاظ بهذا الإيصال لاستلام القطعة",
} as const;

export type SettingKey = keyof typeof DEFAULTS;

export async function getSettings(): Promise<Record<SettingKey, string>> {
  const { data } = await db().from("settings").select("key, value");
  const out = { ...DEFAULTS } as Record<SettingKey, string>;
  for (const row of data ?? []) {
    if (row.key in out) out[row.key as SettingKey] = row.value;
  }
  return out;
}

export async function getWeightTolerance(): Promise<number> {
  const settings = await getSettings();
  const parsed = Number(settings.weight_tolerance_grams);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0.05;
}
