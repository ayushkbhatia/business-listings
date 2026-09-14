"use client";

import { useId, useState } from "react";
import { Input } from "@/components/primitives";
import { cn } from "@/lib/cn";
import { assessPassword, MIN_PASSWORD_LENGTH, type PasswordAssessment } from "@/lib/auth/password-policy";
import { t } from "@/lib/i18n";
import { strengthLabel } from "./password-copy";

/**
 * A new password, with board 7a's four-bar meter under it.
 *
 * The meter runs the same `assessPassword` the server runs before it saves, so
 * "Strong — 12 characters" above a password the server then refuses cannot
 * happen. The bars say how strong; the words say why, and the words are what a
 * screen reader gets — through `aria-describedby`, read when the field is
 * focused rather than announced on every keystroke.
 *
 * Status never rides on colour alone (design-system §Accessibility floor): a
 * refused password lights one bar in the bad tone *and* says what is wrong.
 */
export function NewPasswordField({
  identifiers = [],
  invalid = false,
  autoFocus = false,
}: {
  /** The account's own mobile and email, so the meter refuses what the server refuses. */
  identifiers?: readonly string[];
  invalid?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  const meterId = `${id}-meter`;
  const [password, setPassword] = useState("");
  const assessment = assessPassword(password, { identifiers });

  return (
    <div>
      <label htmlFor={id} className="mb-1.5 block text-body-sm text-ink">
        {t("auth.reset.new_password")}
      </label>
      <Input
        id={id}
        name="password"
        type="password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_LENGTH}
        required
        autoFocus={autoFocus}
        value={password}
        onChange={(event) => setPassword(event.target.value)}
        aria-describedby={meterId}
        invalid={invalid}
      />
      <PasswordMeter id={meterId} assessment={assessment} />
    </div>
  );
}

/**
 * The four bars and the sentence under them. Its own component so the gallery
 * can draw every state without typing into a field.
 */
export function PasswordMeter({ id, assessment }: { id?: string; assessment: PasswordAssessment }) {
  const refused = assessment.length > 0 && assessment.problem !== null;
  const tone = refused ? (assessment.strength <= 1 ? "bg-bad" : "bg-warn") : "bg-ok";

  return (
    <>
      <div className="mt-2 grid grid-cols-4 gap-1.5" aria-hidden="true">
        {[1, 2, 3, 4].map((bar) => (
          <span
            key={bar}
            className={cn(
              "h-1 rounded-pill transition-colors duration-120 ease-out",
              assessment.strength >= bar ? tone : "bg-line",
            )}
          />
        ))}
      </div>
      <p id={id} className={cn("mt-1.5 text-caption", refused ? "text-bad-ink" : "text-body")}>
        {strengthLabel(assessment)}
      </p>
    </>
  );
}
