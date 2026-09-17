import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type BranchOption = { id: string; name: string; code: string | null };

/** الفروع الفعّالة، مرتّبة بالكود — نفس ترتيب أرقام التذاكر. */
export function useBranches(): BranchOption[] {
  const [branches, setBranches] = useState<BranchOption[]>([]);
  useEffect(() => {
    supabase
      .from("branches")
      .select("id, name, code")
      .eq("is_active", true)
      .order("code")
      .then(({ data }) => setBranches(data ?? []));
  }, []);
  return branches;
}

/**
 * مبدّل الفروع.
 *
 * يختفي تماماً حين يوجد فرع واحد: خيار بلا بديل ضوضاء على شاشة هاتف ضيّقة.
 */
export function BranchPicker({
  branches,
  value,
  onChange,
}: {
  branches: BranchOption[];
  value: string | "all";
  onChange: (value: string | "all") => void;
}) {
  if (branches.length < 2) return null;

  const options: { key: string; label: string }[] = [
    { key: "all", label: "كل الفروع" },
    ...branches.map((b) => ({ key: b.id, label: b.name })),
  ];

  return (
    <div className="-mx-4 mb-4 overflow-x-auto px-4">
      <div className="flex w-max gap-2">
        {options.map((option) => {
          const active = option.key === value;
          return (
            <button
              key={option.key}
              type="button"
              onClick={() => onChange(option.key)}
              className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-sm transition ${
                active
                  ? "border-brand-700 bg-brand-700 font-semibold text-gold-100"
                  : "border-slate-300 bg-white text-slate-600 hover:border-brand-300"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
