"use client";

import { ApprovalQueue } from "@/app/(admin)/admin/queue/ApprovalQueue";
import type { ActionResult } from "@/app/(admin)/admin/queue/actions";
import type { BoardRow } from "@/app/(admin)/admin/queue/board";
import { t } from "@/lib/i18n";
import { Section, States } from "../_kit";

/**
 * Board `4b` — the approval queue's rows, in the states its spec lists.
 *
 * The render draws seven rows and two selected. What regresses quietly is
 * everything around them: a conflict that must open its own screen, a row a
 * moderator cannot open, a document already asked for, an empty queue that
 * still says how fast it is cleared, and `Assigned to me` with nothing in it.
 * Selection is interactive here — pick a row whose check failed and `Approve
 * all` disables and says why.
 */

const inert = async (): Promise<ActionResult> => ({ ok: false, error: "The gallery does not decide submissions." });

const row = (over: Partial<BoardRow> & Pick<BoardRow, "ref" | "businessName">): BoardRow => ({
  kind: "claim",
  summary: "",
  typeLabel: "Claim",
  checks: [],
  worst: "pass",
  allPassed: false,
  action: "review",
  actionHref: "#approval-queue",
  waiting: "2 h",
  late: false,
  docsWaiting: null,
  owner: null,
  href: "#approval-queue",
  canOpen: true,
  ...over,
});

const ROWS: BoardRow[] = [
  row({
    ref: "conflict:gallery-cool-breeze",
    businessName: "Cool Breeze Technical Services",
    kind: "conflict",
    typeLabel: "Conflict",
    summary: "Imran Sheikh and Yusuf Rahman both claim this listing",
    checks: [
      { outcome: "fail", text: "2 claims on one listing" },
      { outcome: "pass", text: "Both claims uploaded a licence" },
    ],
    worst: "fail",
    waiting: "3 d 6 h",
    late: true,
    owner: "R. Haddad",
  }),
  row({
    ref: "claim:gallery-zayed",
    businessName: "Zayed Facilities Management",
    summary: "Claim by Hamdan Al Zaabi · licence uploaded",
    checks: [
      { outcome: "pass", text: "Licence current" },
      { outcome: "pass", text: "Trade licence uploaded" },
      { outcome: "pass", text: "Licence matches the register" },
    ],
    allPassed: true,
    action: "approve",
    waiting: "1 d 2 h",
  }),
  row({
    ref: "change_request:gallery-al-waha",
    businessName: "Al Waha Industrial Supplies",
    kind: "category_change",
    typeLabel: "Category",
    summary: "New additional category: Pipes & tubing",
    checks: [{ outcome: "pass", text: "Category fits licence" }],
    allPassed: true,
    action: "approve",
    owner: "S. Iqbal",
  }),
  row({
    ref: "claim:gallery-gulf-star",
    businessName: "Gulf Star Auto Spare Parts",
    summary: "Claim by Rashid Mahmood · licence uploaded",
    checks: [
      { outcome: "warn", text: "Licence expires in 21 days" },
      { outcome: "pass", text: "Trade licence uploaded" },
    ],
    worst: "warn",
    waiting: "9 h",
  }),
  row({
    ref: "claim:gallery-bright-smile",
    businessName: "Bright Smile Dental Clinic",
    summary: "Claim by Dr. Meera Pillai · licence uploaded",
    checks: [{ outcome: "fail", text: "Wrong document type detected: health authority licence" }],
    worst: "fail",
    action: "request_doc",
    waiting: "4 h",
    owner: "R. Haddad",
    docsWaiting: "Document asked for 2 h ago",
  }),
  row({
    ref: "location:gallery-nexa",
    businessName: "Nexa Freight & Logistics",
    kind: "locations",
    typeLabel: "Locations",
    summary: "Warehouse in Al Ghail Industrial, Ras Al Khaimah",
    checks: [{ outcome: "fail", text: "Ras Al Khaimah branch not on DMCC licence" }],
    worst: "fail",
    waiting: "6 h",
    owner: "S. Iqbal",
  }),
  row({
    ref: "change_request:gallery-aster",
    businessName: "Aster Beauty Lounge",
    kind: "category_change",
    typeLabel: "Category",
    summary: "Category change: Beauty → Healthcare clinics",
    checks: [{ outcome: "fail", text: "Licence activity doesn't cover Healthcare clinics" }],
    worst: "fail",
    action: "reject",
    waiting: "1 h",
  }),
];

const STAFF = [
  { id: "gallery-ops", name: "R. Haddad" },
  { id: "gallery-mod", name: "S. Iqbal" },
];

export function ApprovalQueueGallery() {
  return (
    <Section id="approval-queue" title="4b · approval queue" note="Rows carry their checks; the bulk bar is bounded by them">
      <States label="typical" stack>
        <div className="w-full">
          <ApprovalQueue rows={ROWS} staff={STAFF} empty={null} decide={inert} bulk={inert} />
        </div>
      </States>

      <States label="moderator on a conflict" stack>
        <div className="w-full">
          <ApprovalQueue
            rows={[{ ...ROWS[0]!, ref: "conflict:gallery-moderator", actionHref: null, canOpen: false }]}
            staff={STAFF}
            empty={null}
            decide={inert}
            bulk={inert}
          />
        </div>
      </States>

      <States label="queue empty" stack>
        <div className="w-full">
          <ApprovalQueue
            rows={[]}
            staff={STAFF}
            decide={inert}
            bulk={inert}
            empty={
              <div className="text-center">
                <p className="text-body-sm text-body">{t("admin.queue.empty.title")}</p>
                <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
                  {t("admin.queue.empty_board.body", { time: "2 h 14 min", when: "12 min ago" })}
                </p>
              </div>
            }
          />
        </div>
      </States>

      <States label="assigned to me, empty" stack>
        <div className="w-full">
          <ApprovalQueue
            rows={[]}
            staff={STAFF}
            decide={inert}
            bulk={inert}
            empty={
              <div className="text-center">
                <p className="text-body-sm text-body">{t("admin.queue.mine_empty.title")}</p>
                <p className="mx-auto mt-1 max-w-prose text-caption text-muted">
                  {t("admin.queue.mine_empty.body", { count: 318, n: "318" })}
                </p>
                <a href="#approval-queue" className="mt-2 inline-block text-caption text-moss underline underline-offset-2">
                  {t("admin.queue.mine_empty.back")}
                </a>
              </div>
            }
          />
        </div>
      </States>
    </Section>
  );
}
