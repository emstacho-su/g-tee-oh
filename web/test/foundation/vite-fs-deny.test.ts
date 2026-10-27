// @vitest-environment node
/**
 * The Vite dev server must never serve the private-data guard's inputs or the Claude Code settings
 * (S24 security review M1, R3.13). Under just dev-hot the dev server sits behind the edge Caddy,
 * and /@fs/<path> serves any file inside server.fs.allow that server.fs.deny does not match.
 *
 * Proofs: the web config's deny list keeps Vite's defaults and adds .guard-private and .claude (all
 * of .claude except its worktrees directory, where Claude Code keeps checkouts like this one); a
 * dev server with Vite's defaults alone does serve a .guard-private file (the gap the review
 * found); and a dev server built from the web list refuses /@fs/ for both directories while still
 * serving a plain file. Both servers are rooted in a temporary copy holding synthetic files, never
 * the real .guard-private directory.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createServer, type ViteDevServer } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DEV_SERVER_FS_DENY } from "../../vite.config.js";

const VITE_DEFAULT_DENY = [".env", ".env.*", "*.{crt,pem}", "**/.git/**"];
const HTTP_OK = 200;
const HTTP_FORBIDDEN = 403;

interface RunningServer {
  server: ViteDevServer;
  base: string;
}

async function startServer(root: string, deny: readonly string[]): Promise<RunningServer> {
  const server = await createServer({
    configFile: false,
    root,
    logLevel: "silent",
    server: { port: 0, host: "127.0.0.1", fs: { allow: [root], deny: [...deny] } },
  });
  await server.listen();
  const address = server.httpServer?.address();
  if (address === null || address === undefined || typeof address === "string") throw new Error("no port");
  return { server, base: `http://127.0.0.1:${address.port}` };
}

describe("R3.13 dev server fs.deny", () => {
  it("R3.13 keeps Vite's default deny patterns and adds .guard-private and .claude", () => {
    for (const pattern of VITE_DEFAULT_DENY) expect(DEV_SERVER_FS_DENY).toContain(pattern);
    expect(DEV_SERVER_FS_DENY).toContain("**/.guard-private/**");
    expect(DEV_SERVER_FS_DENY).toContain("**/.claude/*");
    expect(DEV_SERVER_FS_DENY).toContain("**/.claude/!(worktrees)/**");
  });

  describe("R3.13 dev servers over a temporary copy with synthetic files", () => {
    let root = "";
    let hardened: RunningServer | undefined;
    let defaults: RunningServer | undefined;

    beforeAll(async () => {
      root = mkdtempSync(join(tmpdir(), "s24-fs-deny-"));
      mkdirSync(join(root, ".guard-private"));
      mkdirSync(join(root, ".claude", "agents"), { recursive: true });
      mkdirSync(join(root, ".claude", "worktrees", "lane", "web"), { recursive: true });
      writeFileSync(join(root, ".claude", "agents", "synthetic-agent.md"), "synthetic\n");
      writeFileSync(join(root, ".claude", "worktrees", "lane", "web", "source.ts"), "export {};\n");
      writeFileSync(join(root, ".guard-private", "synthetic-salt.txt"), "synthetic, not a real salt\n");
      writeFileSync(join(root, ".claude", "synthetic-settings.json"), "{}\n");
      writeFileSync(join(root, "plain.txt"), "plain\n");
      hardened = await startServer(root, DEV_SERVER_FS_DENY);
      defaults = await startServer(root, VITE_DEFAULT_DENY);
    });

    afterAll(async () => {
      await hardened?.server.close();
      await defaults?.server.close();
      rmSync(root, { recursive: true, force: true });
    });

    function fsUrl(running: RunningServer | undefined, ...parts: string[]): string {
      if (running === undefined) throw new Error("server not started");
      return `${running.base}/@fs/${join(root, ...parts).replace(/\\/g, "/").replace(/^\//, "")}`;
    }

    it("R3.13 with Vite's defaults alone a .guard-private file is served (the gap)", async () => {
      expect((await fetch(fsUrl(defaults, ".guard-private", "synthetic-salt.txt"))).status).toBe(HTTP_OK);
    });

    it("R3.13 the web list still serves a plain file under /@fs/", async () => {
      expect((await fetch(fsUrl(hardened, "plain.txt"))).status).toBe(HTTP_OK);
    });

    it("R3.13 the web list refuses a file under .guard-private", async () => {
      expect((await fetch(fsUrl(hardened, ".guard-private", "synthetic-salt.txt"))).status).toBe(HTTP_FORBIDDEN);
    });

    it("R3.13 the web list refuses .claude settings files and .claude subdirectories", async () => {
      expect((await fetch(fsUrl(hardened, ".claude", "synthetic-settings.json"))).status).toBe(HTTP_FORBIDDEN);
      expect((await fetch(fsUrl(hardened, ".claude", "agents", "synthetic-agent.md"))).status).toBe(HTTP_FORBIDDEN);
    });

    it("R3.13 the web list still serves sources of a checkout under .claude/worktrees", async () => {
      expect((await fetch(fsUrl(hardened, ".claude", "worktrees", "lane", "web", "source.ts"))).status).toBe(HTTP_OK);
    });
  });
});
