// Static checks on the hot reload override (R3.13, O-237, O-265, S24 security review M1): the
// checkout root is never bind-mounted into the dev containers (so .git, .env, .guard-private and
// .claude stay outside them), each service mounts only the directories it runs, and the edge Caddy
// publishes 80 and 443 on 127.0.0.1 while the override runs. These read the YAML text, so they run
// without Docker. Run with: pnpm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const HOT_OVERRIDE = readFileSync(resolve(REPO_ROOT, 'infra/compose/compose.hot.yaml'), 'utf8');
const BIND_SOURCES = [...HOT_OVERRIDE.matchAll(/^\s*-\s+(?:&[\w-]+\s+)?(\.[^:\s]*):\/app/gm)].map((match) => match[1]);
const PRIVATE_PATHS = ['.git', '.env', '.guard-private', '.claude', 'crates'];

describe('hot reload override mounts (M1)', () => {
  it('r3_13 never bind-mounts the checkout root', () => {
    assert.ok(BIND_SOURCES.length > 0, 'the override has bind mounts');
    assert.ok(!BIND_SOURCES.includes('.'), `the checkout root is mounted: ${BIND_SOURCES.join(', ')}`);
    assert.ok(!BIND_SOURCES.includes('./'), 'the checkout root is mounted as ./');
  });

  it('r3_13 mounts no private path and only the workspace parts the dev servers need', () => {
    for (const source of BIND_SOURCES) {
      for (const privatePath of PRIVATE_PATHS) {
        assert.ok(!source.startsWith(`./${privatePath}`), `${source} mounts ${privatePath}`);
      }
    }
    assert.ok(BIND_SOURCES.includes('./web'), 'web mounts web/');
    assert.ok(BIND_SOURCES.includes('./services/api'), 'api mounts services/api/');
    assert.ok(BIND_SOURCES.includes('./packages'), 'both mount packages/');
  });

  it('r3_13 the edge Caddy publishes 80 and 443 on 127.0.0.1 only', () => {
    // The caddy block runs until the next line indented by two spaces or less.
    const caddy = /^ {2}caddy:\n((?: {3,}.*\n|\s*\n)*)/m.exec(HOT_OVERRIDE);
    assert.ok(caddy, 'the override has a caddy service');
    assert.match(caddy[1], /ports: !override/);
    assert.match(caddy[1], /"127\.0\.0\.1:80:80"/);
    assert.match(caddy[1], /"127\.0\.0\.1:443:443"/);
  });
});
