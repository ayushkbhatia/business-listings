import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertLocalTarget,
  NonLocalTargetError,
  OVERRIDE_VAR,
  readTarget,
  resolveTarget,
} from "@/lib/db/target";

const LOCAL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const REMOTE = "postgresql://postgres.abcd:secret@aws-0-eu-central-1.pooler.supabase.com:6543/postgres";

/** A directory with no dotenv files in it, so the override reads from env only. */
function emptyDir(): string {
  return mkdtempSync(join(tmpdir(), "db-target-"));
}

const made: string[] = [];
function dirWith(contents: string): string {
  const dir = emptyDir();
  writeFileSync(join(dir, ".env.local"), contents);
  made.push(dir);
  return dir;
}

afterEach(() => {
  while (made.length > 0) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("readTarget", () => {
  it("names host, port and database without the password", () => {
    const target = readTarget(REMOTE);
    expect(target.description).toBe("aws-0-eu-central-1.pooler.supabase.com:6543/postgres");
    expect(target.description).not.toContain("secret");
    expect(target.isLoopback).toBe(false);
  });

  it("defaults the port the way Postgres does", () => {
    expect(readTarget("postgresql://u@example.com/db").description).toBe("example.com:5432/db");
  });

  it("treats each loopback spelling as local", () => {
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0"]) {
      expect(readTarget(`postgresql://u@${host}:5432/db`).isLoopback, host).toBe(true);
    }
  });

  it("strips the brackets Node keeps on an IPv6 literal", () => {
    const target = readTarget("postgresql://u@[::1]:5432/db");
    expect(target.host).toBe("::1");
    expect(target.isLoopback).toBe(true);
  });

  /*
     The one that matters most. A guard that fails open on input it could not
     parse is not a guard, and a hand-edited production URL is exactly the shape
     of string that fails to parse.
  */
  it("does not call an unparseable string local", () => {
    const target = readTarget("not a url");
    expect(target.isLoopback).toBe(false);
    expect(target.description).toBe("an unparseable connection string");
  });

  it("is not fooled by a remote host that merely contains a loopback spelling", () => {
    expect(readTarget("postgresql://u@localhost.evil.com:5432/db").isLoopback).toBe(false);
    expect(readTarget("postgresql://u@db-127.0.0.1.example.com/db").isLoopback).toBe(false);
  });
});

describe("resolveTarget", () => {
  it("prefers DIRECT_URL, which is what the CLI uses", () => {
    const target = resolveTarget({ DIRECT_URL: LOCAL, DATABASE_URL: REMOTE });
    expect(target?.host).toBe("127.0.0.1");
  });

  it("falls back to DATABASE_URL", () => {
    expect(resolveTarget({ DATABASE_URL: REMOTE })?.host).toBe(
      "aws-0-eu-central-1.pooler.supabase.com",
    );
  });

  it("is null when neither is set", () => {
    expect(resolveTarget({})).toBeNull();
  });
});

describe("assertLocalTarget", () => {
  it("returns the target for a local database", () => {
    const target = assertLocalTarget("wipe it", { env: { DIRECT_URL: LOCAL }, cwd: emptyDir() });
    expect(target.description).toBe("127.0.0.1:54322/postgres");
  });

  it("refuses a remote database", () => {
    expect(() =>
      assertLocalTarget("truncate every table and reseed", {
        env: { DIRECT_URL: REMOTE },
        cwd: emptyDir(),
      }),
    ).toThrow(NonLocalTargetError);
  });

  it("quotes the operation and names the host, never the password", () => {
    try {
      assertLocalTarget("truncate every table and reseed", {
        env: { DIRECT_URL: REMOTE },
        cwd: emptyDir(),
      });
      expect.unreachable("should have refused");
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("truncate every table and reseed");
      expect(message).toContain("aws-0-eu-central-1.pooler.supabase.com");
      expect(message).not.toContain("secret");
    }
  });

  it("refuses when neither URL is set rather than assuming local", () => {
    expect(() => assertLocalTarget("wipe it", { env: {}, cwd: emptyDir() })).toThrow(
      NonLocalTargetError,
    );
  });

  it("accepts an override that names the exact host", () => {
    const warnings: string[] = [];
    const target = assertLocalTarget("apply migrations", {
      env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "aws-0-eu-central-1.pooler.supabase.com" },
      cwd: emptyDir(),
      warn: (message) => warnings.push(message),
    });
    expect(target.isLoopback).toBe(false);
    expect(warnings.join(" ")).toContain("not local");
  });

  /*
     The property the override exists for: unlocking one host must not unlock
     another. A boolean flag would fail this, which is why it is not one.
  */
  it("refuses an override that names a different host", () => {
    expect(() =>
      assertLocalTarget("apply migrations", {
        env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "staging.example.com" },
        cwd: emptyDir(),
      }),
    ).toThrow(/staging\.example\.com, but the database is/);
  });

  it("refuses an empty override", () => {
    expect(() =>
      assertLocalTarget("wipe it", {
        env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "" },
        cwd: emptyDir(),
      }),
    ).toThrow(NonLocalTargetError);
  });

  describe("an override written into a dotenv file", () => {
    /*
       .env.local is the file that points at production. An override living in
       it is a guard that has been removed, not one that was passed — and it
       would be removed once and inherited by every command afterwards.
    */
    it("is refused even when it names the right host", () => {
      const cwd = dirWith(`${OVERRIDE_VAR}=aws-0-eu-central-1.pooler.supabase.com\n`);
      expect(() =>
        assertLocalTarget("truncate every table and reseed", {
          env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "aws-0-eu-central-1.pooler.supabase.com" },
          cwd,
        }),
      ).toThrow(/only honoured from the command\s*\n?\s*line/);
    });

    it("is refused when quoted or exported", () => {
      for (const line of [
        `${OVERRIDE_VAR}="aws-0-eu-central-1.pooler.supabase.com"`,
        `export ${OVERRIDE_VAR}='aws-0-eu-central-1.pooler.supabase.com'`,
        `  ${OVERRIDE_VAR}=aws-0-eu-central-1.pooler.supabase.com  `,
      ]) {
        const cwd = dirWith(`${line}\n`);
        expect(() =>
          assertLocalTarget("wipe it", {
            env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "aws-0-eu-central-1.pooler.supabase.com" },
            cwd,
          }),
          line,
        ).toThrow(/dotenv file/);
      }
    });

    it("ignores it in a comment, which is documentation rather than a setting", () => {
      const cwd = dirWith(`# ${OVERRIDE_VAR}=aws-0-eu-central-1.pooler.supabase.com\n`);
      const warnings: string[] = [];
      expect(
        assertLocalTarget("apply migrations", {
          env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "aws-0-eu-central-1.pooler.supabase.com" },
          cwd,
          warn: (m) => warnings.push(m),
        }).isLoopback,
      ).toBe(false);
    });

    it("ignores an empty assignment", () => {
      const cwd = dirWith(`${OVERRIDE_VAR}=\n`);
      expect(
        assertLocalTarget("apply migrations", {
          env: { DIRECT_URL: REMOTE, [OVERRIDE_VAR]: "aws-0-eu-central-1.pooler.supabase.com" },
          cwd,
          warn: () => {},
        }).host,
      ).toBe("aws-0-eu-central-1.pooler.supabase.com");
    });

    it("does not block a local target", () => {
      const cwd = dirWith(`${OVERRIDE_VAR}=anything\n`);
      expect(assertLocalTarget("wipe it", { env: { DIRECT_URL: LOCAL }, cwd }).isLoopback).toBe(
        true,
      );
    });
  });

  /*
     CI is the one caller that must never need the override — it runs against
     the `supabase start` container. If this fails, every job fails.
  */
  it("passes on the connection string .github/workflows/ci.yml sets", () => {
    expect(
      assertLocalTarget("truncate every table and reseed", {
        env: { DATABASE_URL: LOCAL, DIRECT_URL: LOCAL },
        cwd: emptyDir(),
      }).isLoopback,
    ).toBe(true);
  });
});
