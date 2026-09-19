/**
 * شريط الخطوات.
 *
 * الغرض منه أن يعرف الموظف أين هو وكم بقي — الاستمارة الطويلة تُربك من ليس
 * تقنياً، أما ثلاث خطوات معلومة العدد فتُطمئن. الأرقام عربية لأن الشاشة عربية.
 */
export function Steps({ labels, current }: { labels: string[]; current: number }) {
  return (
    <div className="mb-5 flex items-center gap-1.5">
      {labels.map((label, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <div key={label} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex w-full items-center gap-1.5">
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                  done
                    ? "bg-brand-600 text-white"
                    : active
                      ? "bg-gold-600 text-white ring-4 ring-gold-200"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? <span className="pop-check">✓</span> : ["١", "٢", "٣", "٤"][index]}
              </span>
              {index < labels.length - 1 && (
                <span className={`h-1 flex-1 rounded-full ${done ? "bg-brand-600" : "bg-slate-200"}`} />
              )}
            </div>
            <span
              className={`w-full text-center text-[11px] font-medium ${
                active ? "text-gold-700" : done ? "text-brand-700" : "text-slate-400"
              }`}
            >
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
