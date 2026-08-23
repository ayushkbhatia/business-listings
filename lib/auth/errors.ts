import type { Capability } from "./capabilities";

/**
 * Errors carry a mono reference code, per design-system §08 — a buyer or a
 * seller on the phone to support reads the code, not the sentence.
 *
 * The code is derived from the capability, so the same denial always produces
 * the same code and support can look it up. It carries no user id and no
 * business id: it is safe to render on screen.
 */
function referenceCode(capability: string): string {
  let hash = 5381;
  for (let i = 0; i < capability.length; i += 1) {
    hash = ((hash << 5) + hash + capability.charCodeAt(i)) >>> 0;
  }
  return `PERM-${hash.toString(36).toUpperCase().padStart(7, "0").slice(-7)}`;
}

export class PermissionError extends Error {
  readonly capability: Capability;
  readonly actorId: string;
  readonly code: string;

  constructor(capability: Capability, actorId: string) {
    // The message is for the log. The screen shows t("error.permission").
    super(`Actor ${actorId} is not permitted to ${capability}`);
    this.name = "PermissionError";
    this.capability = capability;
    this.actorId = actorId;
    this.code = referenceCode(capability);
  }
}

export class AuditReasonError extends Error {
  readonly action: string;

  constructor(action: string, detail: string) {
    super(`Audit reason rejected for ${action}: ${detail}`);
    this.name = "AuditReasonError";
    this.action = action;
  }
}
