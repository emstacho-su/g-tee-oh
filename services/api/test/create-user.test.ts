/**
 * Tests of the owner account path (R3.1, O-233): createUser against the Postgres test container,
 * and the create-user command's argument, stdin and failure-message handling as pure functions.
 * A5 has no sign-up route, so this command is the only way an account comes to exist.
 */
import { Readable } from "node:stream";

import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";

import { verifyPassword } from "../src/auth/password.js";
import {
  CreateUserError,
  createUser,
  MIN_NEW_PASSWORD_LENGTH,
  normalizeEmail,
} from "../src/auth/users.js";
import {
  CreateUserUsageError,
  describeFailure,
  parseCreateUserArgs,
  readFirstLine,
} from "../src/cli/create-user-args.js";
import { ADMIN_DATABASE_URL_VARIABLE, runCreateUser } from "../src/cli/create-user-run.js";
import { createDatabaseFromUrl, type Database } from "../src/db.js";
import { MAX_PASSWORD_LENGTH } from "../src/schemas/auth.js";
import { appDatabase, uniqueEmail } from "./support/database.js";

const INSUFFICIENT_PRIVILEGE = "42501";

/** The PG* variables the api reads, pointing at the test container as the app login. */
function appEnvironment(): Record<string, string> {
  const url = new URL(inject("appDatabaseUrl"));
  return {
    PGHOST: url.hostname,
    PGPORT: url.port,
    PGDATABASE: url.pathname.slice(1),
    PGUSER: decodeURIComponent(url.username),
    APP_DB_PASSWORD: decodeURIComponent(url.password),
  };
}

function passwordInput(password: string): Readable {
  return Readable.from([`${password}\n`]);
}

async function isAdminFlag(database: Database, id: string): Promise<boolean> {
  const row = await database.selectFrom("app_user").select("is_admin").where("id", "=", id).executeTakeFirstOrThrow();
  return row.is_admin;
}

const GOOD_PASSWORD = "a long enough passphrase";

describe("R3.1 createUser (O-233)", () => {
  let database: Database;

  beforeAll(() => {
    database = appDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it("R3.1 createUser stores a normalized email and an argon2id hash the password verifies against", async () => {
    const email = uniqueEmail("owner");

    const created = await createUser(database, { email: `  ${email.toUpperCase()} `, password: GOOD_PASSWORD });

    expect(created.email).toBe(email);
    const row = await database
      .selectFrom("app_user")
      .select(["id", "email", "password_hash"])
      .where("id", "=", created.id)
      .executeTakeFirstOrThrow();
    expect(row.email).toBe(email);
    expect(row.password_hash).toMatch(/^\$argon2id\$/);
    expect(row.password_hash).not.toContain(GOOD_PASSWORD);
    await expect(verifyPassword(row.password_hash, GOOD_PASSWORD)).resolves.toBe(true);
  });

  it("R3.1 createUser rejects a password shorter than the minimum for new accounts", async () => {
    const short = "x".repeat(MIN_NEW_PASSWORD_LENGTH - 1);

    expect(MIN_NEW_PASSWORD_LENGTH).toBe(12);
    await expect(createUser(database, { email: uniqueEmail(), password: short })).rejects.toMatchObject({
      name: "CreateUserError",
      reason: "password-too-short",
    });
  });

  it("R3.1 createUser rejects a password longer than login accepts", async () => {
    const long = "x".repeat(MAX_PASSWORD_LENGTH + 1);

    await expect(createUser(database, { email: uniqueEmail(), password: long })).rejects.toMatchObject({
      reason: "password-too-long",
    });
  });

  it("R3.1 createUser rejects a malformed email", async () => {
    for (const email of ["", "not-an-email", "two@@example.test", "spaces in@example.test"]) {
      await expect(createUser(database, { email, password: GOOD_PASSWORD }), email).rejects.toMatchObject({
        reason: "invalid-email",
      });
    }
  });

  it("R3.1 createUser turns a duplicate email, in any letter case, into a clear error", async () => {
    const email = uniqueEmail("dup");
    await createUser(database, { email, password: GOOD_PASSWORD });

    const duplicate = createUser(database, { email: email.toUpperCase(), password: GOOD_PASSWORD });

    await expect(duplicate).rejects.toBeInstanceOf(CreateUserError);
    await expect(duplicate).rejects.toMatchObject({
      reason: "duplicate-email",
      message: expect.stringContaining(email) as unknown,
    });
  });

  it("R3.5 createUser as the app role makes a plain account without naming is_admin (PR #25 L1)", async () => {
    const plain = await createUser(database, { email: uniqueEmail("plain"), password: GOOD_PASSWORD });

    expect(await isAdminFlag(database, plain.id)).toBe(false);
    expect(plain.isAdmin).toBe(false);
  });

  it("R3.5 the app role can never set is_admin: createUser with isAdmin on the app connection is refused (PR #25 L1)", async () => {
    const email = uniqueEmail("self-admin");

    await expect(createUser(database, { email, password: GOOD_PASSWORD, isAdmin: true })).rejects.toMatchObject({
      code: INSUFFICIENT_PRIVILEGE,
    });
    expect(await database.selectFrom("app_user").select("id").where("email", "=", email).execute()).toEqual([]);
  });

  it("R3.5 createUser with isAdmin sets the flag through the owner connection (O-242, PR #25 L1)", async () => {
    const owner = createDatabaseFromUrl(inject("adminDatabaseUrl"));
    try {
      const admin = await createUser(owner, { email: uniqueEmail("admin"), password: GOOD_PASSWORD, isAdmin: true });

      expect(await isAdminFlag(database, admin.id)).toBe(true);
      expect(admin.isAdmin).toBe(true);
    } finally {
      await owner.destroy();
    }
  });

  it("R3.1 normalizeEmail trims and lowercases", () => {
    expect(normalizeEmail("  Owner@Example.COM\t")).toBe("owner@example.com");
  });
});

describe("R3.1 create-user command arguments (O-233)", () => {
  it("R3.1 parseCreateUserArgs reads --email VALUE and --email=VALUE", () => {
    expect(parseCreateUserArgs(["--email", "owner@example.com"])).toEqual({ email: "owner@example.com", admin: false });
    expect(parseCreateUserArgs(["--email=owner@example.com"])).toEqual({ email: "owner@example.com", admin: false });
  });

  it("R3.5 parseCreateUserArgs reads the --admin flag before or after the email (O-242)", () => {
    expect(parseCreateUserArgs(["--admin", "--email", "owner@example.com"])).toEqual({
      email: "owner@example.com",
      admin: true,
    });
    expect(parseCreateUserArgs(["--email=owner@example.com", "--admin"])).toEqual({
      email: "owner@example.com",
      admin: true,
    });
  });

  it("R3.1 parseCreateUserArgs rejects a missing, empty, repeated or unknown argument", () => {
    const bad = [
      [],
      ["--email"],
      ["--email="],
      ["--email", "--password"],
      ["--email", "--admin"],
      ["--email", "a@example.com", "--email", "b@example.com"],
      ["--email", "a@example.com", "--admin", "--admin"],
      ["--email", "a@example.com", "--admin=yes"],
      ["--email", "a@example.com", "--password", "secret"],
      ["--admin"],
      ["a@example.com"],
    ];
    for (const argv of bad) {
      expect(() => parseCreateUserArgs(argv), argv.join(" ")).toThrow(CreateUserUsageError);
    }
  });

  it("R3.1 readFirstLine returns the first line without its line ending", async () => {
    await expect(readFirstLine(Readable.from(["correct horse\r\nsecond line\n"]))).resolves.toBe("correct horse");
    await expect(readFirstLine(Readable.from(["split ", "across chunks\n"]))).resolves.toBe("split across chunks");
    await expect(readFirstLine(Readable.from([Buffer.from("bytes too\n")]))).resolves.toBe("bytes too");
    await expect(readFirstLine(Readable.from(["no newline at the end"]))).resolves.toBe("no newline at the end");
  });

  it("R3.1 readFirstLine keeps a multibyte character whose bytes are split across chunks (M6)", async () => {
    const bytes = Buffer.from("pässwörd-€-🂡\n", "utf8");
    const euro = bytes.indexOf(Buffer.from("€", "utf8"));
    const chunks = [bytes.subarray(0, euro + 1), bytes.subarray(euro + 1, euro + 2), bytes.subarray(euro + 2)];

    await expect(readFirstLine(Readable.from(chunks))).resolves.toBe("pässwörd-€-🂡");
  });

  it("R3.1 readFirstLine rejects empty input and an overlong line", async () => {
    await expect(readFirstLine(Readable.from([]))).rejects.toThrow(CreateUserUsageError);
    await expect(readFirstLine(Readable.from(["\n"]))).rejects.toThrow(CreateUserUsageError);
    await expect(readFirstLine(Readable.from(["x".repeat(MAX_PASSWORD_LENGTH * 8)]))).rejects.toThrow(
      CreateUserUsageError,
    );
  });

  it("R3.1 describeFailure gives one line and never the password", () => {
    const password = "hunter2hunter2-secret";
    const multiLine = new Error(`first line\nsecond line mentions ${password}`);

    expect(describeFailure(new CreateUserError("invalid-email", "bad email"), password)).toBe(
      "create-user failed: bad email",
    );
    const described = describeFailure(multiLine, password);
    expect(described).not.toContain("\n");
    expect(described).not.toContain(password);
    expect(describeFailure("a thrown string", password)).toBe("create-user failed: a thrown string");
  });

  it("R3.5 describeFailure cuts out every secret it is given", () => {
    const described = describeFailure(new Error("url postgres://u:pw-one@h/db and pw-two"), "pw-two", "pw-one", undefined);

    expect(described).not.toContain("pw-one");
    expect(described).not.toContain("pw-two");
  });
});

describe("R3.5 create-user connections (O-242, PR #25 L1)", () => {
  let database: Database;

  beforeAll(() => {
    database = appDatabase();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it("R3.5 create-user without --admin runs as the app login and never reads the owner variable", async () => {
    const env = { ...appEnvironment(), [ADMIN_DATABASE_URL_VARIABLE]: "not a url" };

    const outcome = await runCreateUser(["--email", uniqueEmail("cli-plain")], passwordInput(GOOD_PASSWORD), env);

    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    expect(await isAdminFlag(database, outcome.userId)).toBe(false);
  });

  it("R3.5 create-user --admin runs through the owner connection and sets is_admin", async () => {
    const env = { [ADMIN_DATABASE_URL_VARIABLE]: inject("adminDatabaseUrl") };

    const outcome = await runCreateUser(["--email", uniqueEmail("cli-admin"), "--admin"], passwordInput(GOOD_PASSWORD), env);

    if (!outcome.ok) {
      throw new Error(outcome.message);
    }
    expect(await isAdminFlag(database, outcome.userId)).toBe(true);
  });

  it("R3.5 create-user --admin without the owner variable fails naming it and creates nothing", async () => {
    const email = uniqueEmail("cli-no-owner");

    const outcome = await runCreateUser(["--email", email, "--admin"], passwordInput(GOOD_PASSWORD), appEnvironment());

    expect(outcome).toEqual({ ok: false, message: expect.stringContaining(ADMIN_DATABASE_URL_VARIABLE) as unknown });
    expect(await database.selectFrom("app_user").select("id").where("email", "=", email).execute()).toEqual([]);
  });

  it("R3.5 create-user --admin refuses an owner URL that is not postgres without echoing it", async () => {
    const secret = "owner-secret-value";
    const env = { [ADMIN_DATABASE_URL_VARIABLE]: `mysql://root:${secret}@db/gto` };

    const outcome = await runCreateUser(["--email", uniqueEmail(), "--admin"], passwordInput(GOOD_PASSWORD), env);

    expect(outcome).toEqual({ ok: false, message: expect.stringContaining(ADMIN_DATABASE_URL_VARIABLE) as unknown });
    expect(JSON.stringify(outcome)).not.toContain(secret);
  });

  it("R3.5 a failure on the owner connection shows neither the owner URL nor the password", async () => {
    const secret = "unreachable-owner-secret";
    const env = { [ADMIN_DATABASE_URL_VARIABLE]: `postgres://postgres:${secret}@127.0.0.1:1/gto` };

    const outcome = await runCreateUser(["--email", uniqueEmail(), "--admin"], passwordInput(GOOD_PASSWORD), env);

    expect(outcome.ok).toBe(false);
    const text = JSON.stringify(outcome);
    expect(text).toContain("create-user failed: ");
    expect(text).not.toContain(secret);
    expect(text).not.toContain(GOOD_PASSWORD);
  });

  it("R3.1 a usage error is one failure line", async () => {
    const outcome = await runCreateUser(["--bogus"], passwordInput(GOOD_PASSWORD), appEnvironment());

    expect(outcome).toEqual({
      ok: false,
      message: expect.stringMatching(/^create-user failed: unexpected argument/) as unknown,
    });
  });
});
