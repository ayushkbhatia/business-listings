import { promises as dns } from "node:dns";
import { VERIFY_PREFIX, type RecordStatus } from "./state";

/**
 * The two things domain verification needs from outside this codebase.
 *
 * Both are ports with fakes, in the shape of `lib/billing/provider.ts`, and for
 * the same reason: a stub that silently pretends to succeed is how a staging
 * environment convinces somebody a feature works.
 *
 * ## What is not built, and is marked as not built
 *
 * `CertificateIssuer.live` is false until there is a Vercel project-domains
 * token in the environment. Step 4 of board 5e's flow — *"certificate issued
 * automatically"* — is a platform operation, not application code: this repo
 * has no token, no SDK and no outbound call to vercel.com anywhere.
 *
 * So the five DNS states are real and provable today, and the certificate half
 * says what it is. A screen that showed "certificate issued" against a fake
 * would be the exact failure the payment port exists to avoid.
 */

export interface DnsResolver {
  readonly name: string;
  /** The CNAME target for a hostname, or null where there is no CNAME. */
  cname(hostname: string): Promise<string | null>;
  /** Every TXT value at `_bl-verify.<label>`, joined per record. */
  txt(hostname: string): Promise<string[]>;
}

/**
 * The real one.
 *
 * `resolveCname` rather than `lookup`: a lookup follows the chain and returns
 * an address, which would tell us the domain resolves somewhere without telling
 * us it resolves to us. The record itself is what the seller was asked to
 * create and the record itself is what is checked.
 */
export const nodeResolver: DnsResolver = {
  name: "node",

  async cname(hostname) {
    try {
      const records = await dns.resolveCname(hostname);
      return records[0] ?? null;
    } catch {
      // NXDOMAIN and NODATA are both "not there yet", which is the normal case
      // for the first hour and not an error worth surfacing.
      return null;
    }
  },

  async txt(hostname) {
    const label = hostname.split(".")[0] ?? hostname;
    const zone = hostname.split(".").slice(1).join(".");
    try {
      const records = await dns.resolveTxt(`${VERIFY_PREFIX}.${label}.${zone}`);
      // A TXT record arrives as chunks that have to be joined before comparing:
      // anything over 255 characters is split, and ours is not, but a resolver
      // may still return it as one-element arrays.
      return records.map((chunks) => chunks.join(""));
    } catch {
      return [];
    }
  },
};

/** What the poller found, compared against what we asked for. */
export async function checkRecords(
  resolver: DnsResolver,
  hostname: string,
  token: string,
  target: string,
): Promise<{ cname: RecordStatus; txt: RecordStatus }> {
  const [cname, txt] = await Promise.all([resolver.cname(hostname), resolver.txt(hostname)]);

  const wanted = `bl-verify=${token}`;
  return {
    cname:
      cname === null
        ? "waiting"
        : // Trailing dots are how a resolver returns a fully qualified name,
          // and comparing without stripping them fails on a correct record.
          cname.replace(/\.$/, "") === target.replace(/\.$/, "")
          ? "found"
          : "wrong_value",
    txt: txt.length === 0 ? "waiting" : txt.includes(wanted) ? "found" : "wrong_value",
  };
}

export interface IssuedCertificate {
  ok: boolean;
  /** Whatever the platform calls it, so a later revocation can find it. */
  reference?: string;
  error?: string;
}

export interface CertificateIssuer {
  readonly name: string;
  /**
   * True when this issuer can actually get a certificate.
   *
   * Load-bearing: the screens read it and say "the records are correct and the
   * certificate is not issued yet" rather than showing a padlock that means
   * nothing.
   */
  readonly live: boolean;
  issue(hostname: string): Promise<IssuedCertificate>;
  revoke(reference: string): Promise<{ ok: boolean }>;
}

/**
 * The development issuer. Records the intent and issues nothing.
 *
 * There is no `VERCEL_TOKEN` in this repo, in `.env.example`, or in CI. Until
 * there is, this is what runs, and `live: false` is what stops a screen
 * claiming a domain is served over TLS when nothing has been asked to serve it.
 */
export const consoleIssuer: CertificateIssuer = {
  name: "console",
  live: false,

  async issue(hostname) {
    console.info("[domains] would ask for a certificate", { hostname });
    return {
      ok: false,
      error: "No certificate provider is configured. The records are correct; nothing was issued.",
    };
  },

  async revoke(reference) {
    console.info("[domains] would revoke", { reference });
    return { ok: true };
  },
};

let currentResolver: DnsResolver = nodeResolver;
let currentIssuer: CertificateIssuer = consoleIssuer;

export function setDnsResolver(resolver: DnsResolver): void {
  currentResolver = resolver;
}
export function dnsResolver(): DnsResolver {
  return currentResolver;
}
export function setCertificateIssuer(issuer: CertificateIssuer): void {
  currentIssuer = issuer;
}
export function certificateIssuer(): CertificateIssuer {
  return currentIssuer;
}
