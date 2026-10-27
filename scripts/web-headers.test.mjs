// Tests for the security headers of the web image (R3.13, O-261): the Caddyfile written inline in
// infra/docker/web.Dockerfile sends a Content Security Policy (CSP), nosniff and Referrer-Policy on
// every response. These read the Dockerfile text, so a policy that loosens script-src or drops a
// header fails here without building the image. Run with: pnpm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DOCKERFILE = resolve(REPO_ROOT, 'infra/docker/web.Dockerfile');
const CADDYFILE_BLOCK = /COPY <<'CADDYFILE' \/etc\/caddy\/Caddyfile\n([\s\S]*?)\nCADDYFILE/;
const HEADER_LINE = (name) => new RegExp(`^\\s*${name}\\s+"([^"]*)"\\s*$`, 'm');

function caddyfile() {
  const match = CADDYFILE_BLOCK.exec(readFileSync(DOCKERFILE, 'utf8'));
  assert.ok(match, 'web.Dockerfile writes its Caddyfile through a CADDYFILE heredoc');
  return match[1];
}

function headerValue(name) {
  const match = HEADER_LINE(name).exec(caddyfile());
  assert.ok(match, `the Caddyfile sets ${name}`);
  return match[1];
}

/** The policy as a map from directive name to its source list. */
function cspDirectives() {
  return new Map(
    headerValue('Content-Security-Policy')
      .split(';')
      .map((directive) => directive.trim().split(/\s+/))
      .filter((parts) => parts[0] !== '')
      .map(([name, ...sources]) => [name, sources]),
  );
}

describe('web image security headers', () => {
  it('r3_13 the headers sit in a header block of the :8080 site', () => {
    assert.match(caddyfile(), /:8080 \{[\s\S]*\n\theader \{[\s\S]*?\n\t\}/);
  });

  it('r3_13 scripts load from this origin only: no inline script, no eval', () => {
    const directives = cspDirectives();
    assert.deepEqual(directives.get('script-src'), ["'self'"]);
    assert.deepEqual(directives.get('default-src'), ["'self'"]);
  });

  it("r3_13 'unsafe-inline' appears in style-src and nowhere else", () => {
    for (const [name, sources] of cspDirectives()) {
      const inline = sources.includes("'unsafe-inline'");
      assert.equal(inline, name === 'style-src', `${name}: ${sources.join(' ')}`);
      assert.ok(!sources.includes("'unsafe-eval'"), `${name} allows eval`);
    }
  });

  it('r3_13 the policy blocks framing, base and form hijacks and plugins', () => {
    const directives = cspDirectives();
    assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
    assert.deepEqual(directives.get('base-uri'), ["'self'"]);
    assert.deepEqual(directives.get('form-action'), ["'self'"]);
    assert.deepEqual(directives.get('object-src'), ["'none'"]);
    assert.deepEqual(directives.get('connect-src'), ["'self'"]);
    assert.deepEqual(directives.get('img-src'), ["'self'", 'data:']);
    assert.deepEqual(directives.get('font-src'), ["'self'"]);
  });

  it('r3_13 nosniff and a same-origin referrer policy', () => {
    assert.equal(headerValue('X-Content-Type-Options'), 'nosniff');
    assert.equal(headerValue('Referrer-Policy'), 'same-origin');
  });
});

describe('edge Caddy HSTS', () => {
  const EDGE_CADDYFILE = resolve(REPO_ROOT, 'infra/compose/Caddyfile');
  const HTTPS_SITE = /^https:\/\/\{\$CADDY_SITE:localhost\} \{\n([\s\S]*?)\n\}/m;

  it('r3_13 the https site of the edge Caddyfile sends Strict-Transport-Security for a year (A9 section 3)', () => {
    const site = HTTPS_SITE.exec(readFileSync(EDGE_CADDYFILE, 'utf8'));
    assert.ok(site, 'the edge Caddyfile has the https CADDY_SITE block');
    assert.match(site[1], /^\s*header Strict-Transport-Security "max-age=31536000"\s*$/m);
  });
});
