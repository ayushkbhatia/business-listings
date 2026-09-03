"use client";

import { useState } from "react";
import { Button, Label, Textarea } from "@/components/primitives";
import { Alert } from "@/components/display";
import { postAnswer } from "./actions";

/**
 * One question, and the box that answers it.
 *
 * The answer is a plain form post rather than an optimistic update: a supplier
 * who types an answer needs to know it saved, and this page is the only place
 * they will look. The card keeps the question visible above the box, because
 * the answer is rendered next to it on the product page and reads badly when
 * written without it in view.
 */

export interface SellerQuestion {
  id: string;
  body: string;
  answer: string | null;
  answeredLabel: string | null;
  askedLabel: string;
  productName: string;
  productHref: string;
}

export function QuestionCard({
  question,
  labels,
}: {
  question: SellerQuestion;
  labels: {
    about: string;
    answerLabel: string;
    answerHint: string;
    submit: string;
    viewProduct: string;
  };
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  return (
    <article className="rounded-card border border-line bg-card p-4">
      <p className="font-mono text-eyebrow uppercase tracking-eyebrow text-faint">
        {labels.about}
      </p>
      <p className="mt-1.5 text-body text-ink">{question.body}</p>
      <p className="mt-1 text-caption text-body">{question.askedLabel}</p>

      {question.answer ? (
        <div className="mt-3 border-t border-line pt-3">
          <p className="text-body-sm text-ink">{question.answer}</p>
          {question.answeredLabel && (
            <p className="mt-1 font-mono text-eyebrow uppercase text-faint">
              {question.answeredLabel}
            </p>
          )}
        </div>
      ) : (
        <form
          className="mt-3 border-t border-line pt-3"
          action={async (formData) => {
            setPending(true);
            setError(null);
            const result = await postAnswer(formData);
            setPending(false);
            if (!result.ok) setError(result.error);
          }}
        >
          <input type="hidden" name="questionId" value={question.id} />
          <Label htmlFor={`answer-${question.id}`}>{labels.answerLabel}</Label>
          <p className="mb-1.5 text-caption text-body">{labels.answerHint}</p>
          <Textarea id={`answer-${question.id}`} name="answer" rows={3} limit={1000} required />
          {error && (
            <div className="mt-2">
              <Alert tone="bad" live="assertive">
                {error}
              </Alert>
            </div>
          )}
          <div className="mt-2 flex items-center gap-3">
            <Button type="submit" size="sm" loading={pending}>
              {labels.submit}
            </Button>
            <a
              href={question.productHref}
              className="rounded-tag text-caption text-moss underline-offset-2 hover:underline focus-visible:outline-none focus-visible:shadow-focus"
            >
              {labels.viewProduct}
            </a>
          </div>
        </form>
      )}
    </article>
  );
}
