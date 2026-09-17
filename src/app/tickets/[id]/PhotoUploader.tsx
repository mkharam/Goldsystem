"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { addPhotosAction } from "@/app/actions/tickets";
import { PHOTO_STAGE } from "@/lib/constants";

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="btn-ghost w-full" disabled={disabled || pending}>
      {pending ? "جارٍ الرفع…" : "رفع الصور"}
    </button>
  );
}

export function PhotoUploader({ ticketId }: { ticketId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [count, setCount] = useState(0);

  return (
    <form action={addPhotosAction} className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <input type="hidden" name="ticket_id" value={ticketId} />

      <select name="stage" className="field" defaultValue="progress">
        {(Object.keys(PHOTO_STAGE) as (keyof typeof PHOTO_STAGE)[]).map((stage) => (
          <option key={stage} value={stage}>
            {PHOTO_STAGE[stage]}
          </option>
        ))}
      </select>

      <input
        ref={input}
        name="photos"
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        className="hidden"
        onChange={(e) => setCount(e.target.files?.length ?? 0)}
      />

      <button type="button" onClick={() => input.current?.click()} className="btn-ghost w-full">
        {count > 0 ? `${count} صورة محدّدة` : "اختيار صور"}
      </button>

      <SubmitButton disabled={count === 0} />
    </form>
  );
}
