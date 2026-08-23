"use client";

import { useId, useRef, useState } from "react";
import { cn } from "@/lib/cn";
import { Close, File, Upload, Warning } from "./icons";

/**
 * Four states: idle, uploading, done, error.
 *
 * Idle is the only one with a dashed border, because a dashed border means
 * "empty, add or drop something here" and nothing else. The moment a file
 * exists the border goes solid — the box is no longer a place to put something,
 * it is a thing.
 *
 * Drag is an enhancement, never the only route: the whole box is a button, so
 * the keyboard path is Tab then Enter. Anyone on a phone gets the file picker,
 * which is the only path that works there anyway.
 */
export type FileDropState = "idle" | "uploading" | "done" | "error";

export interface FileDropProps {
  state?: FileDropState;
  /** 0..100. Only read while uploading. */
  progress?: number;
  /** The file's name, once one exists. */
  filename?: string;
  /** Already formatted by formatBytes. */
  filesize?: string;
  /** What is wrong and what correct looks like. */
  errorMessage?: string;
  /** Copy, all through t(). */
  idleLabel: string;
  idleHint?: string;
  uploadingLabel?: string;
  removeLabel?: string;
  retryLabel?: string;
  accept?: string;
  multiple?: boolean;
  disabled?: boolean;
  onSelect?: (files: FileList) => void;
  onRemove?: () => void;
  onRetry?: () => void;
}

export function FileDrop({
  state = "idle",
  progress = 0,
  filename,
  filesize,
  errorMessage,
  idleLabel,
  idleHint,
  uploadingLabel,
  removeLabel,
  retryLabel,
  accept,
  multiple = false,
  disabled = false,
  onSelect,
  onRemove,
  onRetry,
}: FileDropProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const open = () => {
    if (!disabled) inputRef.current?.click();
  };

  const frame = cn(
    "flex w-full items-center gap-3 rounded-card px-4 py-3 text-left",
    "transition-colors duration-120 ease-out",
    "focus-visible:outline-none focus-visible:shadow-focus",
  );

  if (state === "idle") {
    return (
      <>
        {/*
          The real input is a trigger, not a control. sr-only hides it visually
          but leaves it focusable and unnamed, which puts a second, silent tab
          stop next to the button — so it leaves the accessibility tree
          entirely. The button below is the affordance, and it clicks this.
        */}
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept={accept}
          multiple={multiple}
          disabled={disabled}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
          onChange={(event) => {
            if (event.target.files?.length) onSelect?.(event.target.files);
          }}
        />
        <button
          type="button"
          disabled={disabled}
          onClick={open}
          onDragOver={(event) => {
            event.preventDefault();
            if (!disabled) setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            if (!disabled && event.dataTransfer.files.length) onSelect?.(event.dataTransfer.files);
          }}
          className={cn(
            frame,
            "justify-center border-2 border-dashed",
            dragging
              ? "border-moss bg-moss-wash"
              : "border-line-strong bg-placeholder-empty-b hover:border-moss hover:bg-fill",
            disabled && "cursor-not-allowed border-line bg-fill",
          )}
        >
          <Upload size={18} className={disabled ? "text-disabled-text" : "text-muted"} />
          <span className="flex flex-col">
            <span className={cn("text-body-sm", disabled ? "text-disabled-text" : "text-body")}>
              {idleLabel}
            </span>
            {idleHint && <span className="text-caption text-muted">{idleHint}</span>}
          </span>
        </button>
      </>
    );
  }

  if (state === "uploading") {
    return (
      <div className={cn(frame, "border border-line bg-card")} aria-busy="true">
        <File size={18} className="shrink-0 text-muted" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm text-body">{filename}</p>
          <div
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label={uploadingLabel}
            className="mt-1.5 h-1 w-full overflow-hidden rounded-pill bg-track"
          >
            <div
              className="h-full rounded-pill bg-moss transition-[width] duration-120 ease-out"
              style={{ width: `${Math.min(100, Math.max(0, progress))}%` }}
            />
          </div>
        </div>
        <span className="shrink-0 font-mono text-eyebrow tabular-nums text-muted">
          {Math.round(progress)}%
        </span>
      </div>
    );
  }

  if (state === "done") {
    return (
      <div className={cn(frame, "border border-ok-line bg-ok-surface")}>
        <File size={18} className="shrink-0 text-ok-ink" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-sm text-body">{filename}</p>
          {filesize && <p className="font-mono text-eyebrow text-muted">{filesize}</p>}
        </div>
        {removeLabel && (
          <button
            type="button"
            aria-label={removeLabel}
            title={removeLabel}
            onClick={onRemove}
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-chip text-muted",
              "transition-colors duration-120 ease-out hover:bg-fill hover:text-ink",
              "focus-visible:outline-none focus-visible:shadow-focus",
            )}
          >
            <Close size={13} />
          </button>
        )}
      </div>
    );
  }

  return (
    <div className={cn(frame, "border border-bad-line-strong bg-bad-surface")} role="alert">
      <Warning size={18} className="shrink-0 text-bad-ink" />
      <div className="min-w-0 flex-1">
        {filename && <p className="truncate text-body-sm text-body">{filename}</p>}
        <p className="text-caption text-bad-ink">{errorMessage}</p>
      </div>
      {retryLabel && (
        <button
          type="button"
          onClick={onRetry}
          className={cn(
            "shrink-0 rounded-ctl border border-bad-line-strong bg-card px-2.5 py-1",
            "text-caption text-bad-ink",
            "transition-colors duration-120 ease-out hover:bg-bad-wash",
            "focus-visible:outline-none focus-visible:shadow-focus-danger",
          )}
        >
          {retryLabel}
        </button>
      )}
    </div>
  );
}
