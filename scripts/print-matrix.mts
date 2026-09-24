// Prints the permission matrix as markdown, for diffing against design-system §07.
// Generated on demand rather than committed, so it cannot drift from the code.
import { CAPABILITIES, CAPABILITY_LIST, type CapabilitySpec } from "../lib/auth/capabilities.js";
import { ROLES } from "../lib/auth/roles.js";

const SHORT: Record<string, string> = {
  buyer: "buy",
  seller_owner: "s.own",
  seller_manager: "s.mgr",
  seller_sales: "s.sal",
  seller_finance: "s.fin",
  staff_moderator: "mod",
  staff_finance: "fin",
  staff_ops_lead: "ops",
};

// `prov` is the provisional identity: a buyer with no account, who holds no role
// and is answered from `CapabilitySpec.provisional` instead.
const head = ["capability", ...ROLES.map((r) => SHORT[r]), "prov", "audit", "src"];
console.log(`| ${head.join(" | ")} |`);
console.log(`|${head.map(() => "---").join("|")}|`);

for (const capability of CAPABILITY_LIST) {
  const spec: CapabilitySpec = CAPABILITIES[capability];
  const cells = ROLES.map((r) => ((spec.roles as readonly string[]).includes(r) ? "×" : ""));
  console.log(
    `| \`${capability}\` | ${cells.join(" | ")} | ${spec.provisional ? "×" : ""} | ${spec.audited ? "yes" : ""} | ${spec.source} |`,
  );
}

console.log("");
console.log("Inferred rows, with the reasoning:");
console.log("");
for (const capability of CAPABILITY_LIST) {
  const spec = CAPABILITIES[capability];
  if (spec.source !== "inferred") continue;
  console.log(`- \`${capability}\` → ${spec.roles.join(", ")}`);
  console.log(`  ${spec.why}`);
}
