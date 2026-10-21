"use client";

import { useFormStatus } from "react-dom";
import { ui } from "@/lib/copy/wording";

/** A submit button disabled while its form is pending (QA fix round: no double submit). */
export function SubmitButton({ children, className }: { children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className={className} disabled={pending} aria-disabled={pending}>
      {pending ? ui.pending : children}
    </button>
  );
}
