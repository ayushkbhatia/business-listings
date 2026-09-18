"use client";

import { useFormStatus } from "react-dom";
import { Button } from "@/components/primitives";

/** The accept or send-for-approval button, holding itself while the server decides. */
export function SubmitDecision({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" loading={pending}>
      {label}
    </Button>
  );
}
