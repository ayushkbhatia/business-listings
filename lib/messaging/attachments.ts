import { DOCUMENT_TYPES, MAX_LICENCE_BYTES, safeName } from "@/lib/storage/buckets";

/**
 * Files sent in a thread — board `10h` Q5, answered.
 *
 * *"Are attachments scanned, and are they visible to the other three sellers?"*
 *
 * **Visible to the other sellers: no, by construction.** A thread attachment is
 * a `Document` of kind `thread_attachment` joined to one message and to nothing
 * else — no `enquiryId`, which would put it in the set every recipient can open,
 * and no `businessId`, which would list a buyer's BOQ among the supplier's own
 * documents. The only ways in are the two download routes, each of which proves
 * the reader is one side of that thread.
 *
 * **Scanned: not for content.** What is checked is what the private bucket
 * allows — PDF, JPEG or PNG, ten megabytes — read back from storage rather than
 * trusted from the form. The composer says which types go and who sees them, and
 * says nothing about scanning, because nothing scans.
 *
 * Pure: path conventions and limits, so a test and the seed can use them without
 * a network.
 */

export type ThreadSide = "buyer" | "seller";

/** PDF, JPEG or PNG — the private bucket's own allow-list. */
export const THREAD_ATTACHMENT_TYPES = DOCUMENT_TYPES;

/**
 * Ten megabytes, the ceiling the enquiry composer and the licence step state.
 * A drawing or a BOQ is a handful of pages; anything larger is a scan nobody
 * has resized.
 */
export const THREAD_ATTACHMENT_BYTES = MAX_LICENCE_BYTES;

/** Per message. A datasheet set for three lines is three files, rarely more. */
export const MAX_THREAD_ATTACHMENTS = 5;

export type ThreadAttachmentRefusal = "type" | "size" | "count";

/** Why a file cannot go, or null when it can. */
export function checkThreadAttachment(type: string, bytes: number): ThreadAttachmentRefusal | null {
  if (!(THREAD_ATTACHMENT_TYPES as readonly string[]).includes(type)) return "type";
  if (!Number.isFinite(bytes) || bytes <= 0 || bytes > THREAD_ATTACHMENT_BYTES) return "size";
  return null;
}

/**
 * Where one file sent by one side of one thread lives.
 *
 * The side is in the path so a path the buyer's signed upload wrote cannot be
 * attached to a message the seller sends, and the other way round.
 */
export function threadAttachmentPath(
  enquiryId: string,
  businessId: string,
  side: ThreadSide,
  filename: string,
): string {
  return `threads/${enquiryId}/${businessId}/${side}/${safeName(filename)}`;
}

/** Whether a posted path is one this side of this thread could have been signed for. */
export function isThreadAttachmentPath(
  enquiryId: string,
  businessId: string,
  side: ThreadSide,
  path: string,
): boolean {
  const prefix = `threads/${enquiryId}/${businessId}/${side}/`;
  return path.startsWith(prefix) && /^[a-z0-9.-]+$/.test(path.slice(prefix.length)) && !path.includes("..");
}
