// Static checks on the compose mac profile and the Deploy 1 one-shots (R2.22, S20, O-511, O-512,
// 02 section 6.2 and 6.4, A9 section 3): the services Deploy 1 runs carry their memory limits and
// restart policy and publish no Postgres or S3 port; migrate-mac and backup-mirror are pinned,
// non-root, read-only and capability-free one-shots; the mirror holds only the two bucket
// identities, never the admin keys. These read the YAML text, so they run without Docker. Run with:
// pnpm run test:scripts
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const COMPOSE = readFileSync(resolve(REPO_ROOT, 'infra/compose/compose.yaml'), 'utf8');

/** The body of one top-level service: from its name line to the next line indented by two spaces or less. */
function service(name) {
  const block = new RegExp(`^ {2}${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}:\\n((?: {3,}.*\\n|\\s*\\n)*)`, 'm').exec(COMPOSE);
  assert.ok(block, `compose.yaml has a ${name} service`);
  return block[1];
}

/** The `- source:target[:ro]` entries of a service's volumes list, as [source, target] pairs. */
function mountsOf(body) {
  const volumes = /^\s+volumes:\n((?:\s+- .*\n)+)/m.exec(body);
  assert.ok(volumes, 'the service has a volumes list');
  return [...volumes[1].matchAll(/^\s+- (.+?):(\/[^:\s]+)(?::ro)?$/gm)].map((m) => [m[1], m[2]]);
}

const PINNED_IMAGE = /^\s+image: \S+:\d+\.\d+\.\d+$/m;
const HARDENED = [/read_only: true/, /cap_drop: \[ALL\]/, /security_opt: \[no-new-privileges:true\]/, /user: "10001:10001"/, /restart: "no"/];

describe('the mac profile Deploy 1 runs (02 section 6.2, 6.4)', () => {
  it('r2_22 postgres-mac, seaweedfs-mac and the builder carry their limits and restart policy and publish no port', () => {
    const limits = { 'postgres-mac': '1g', 'seaweedfs-mac': '512m' };
    for (const [name, limit] of Object.entries(limits)) {
      const body = service(name);
      assert.match(body, /profiles: \[mac\]/);
      assert.match(body, /restart: unless-stopped/);
      assert.match(body, new RegExp(`memory: ${limit}`));
      assert.doesNotMatch(body, /^\s+ports:/m, `${name} publishes a port`);
    }
    const builder = service('library-builder');
    assert.match(builder, /profiles: \[builder, mac\]/);
    assert.match(builder, /mem_limit: 5g/);
    assert.match(builder, /memswap_limit: 5g/);
    assert.match(builder, /restart: unless-stopped/);
    assert.doesNotMatch(builder, /^\s+ports:/m, 'the builder publishes a port');
  });

  it('r2_22 no service of the mac profile publishes a port of its own (caddy-mac inherits 80 and 443 from its anchor)', () => {
    const published = [...COMPOSE.matchAll(/^ {2}([\w-]+):\n((?: {3,}.*\n|\s*\n)*)/gm)]
      .filter(([, , body]) => /profiles: \[(?:[^\]]*\b)?mac\b/.test(body) && /^\s+ports:/m.test(body))
      .map(([, name]) => name);
    assert.deepEqual(published, []);
  });
});

describe('migrate-mac, the one-shot migration (O-511)', () => {
  const body = service('migrate-mac');

  it('r2_22 is a pinned dbmate under the mac profile that runs up once postgres-mac is healthy', () => {
    assert.match(body, /image: ghcr\.io\/amacneil\/dbmate:/);
    assert.match(body, PINNED_IMAGE);
    assert.match(body, /profiles: \[mac\]/);
    assert.match(body, /command: \["--wait", "--no-dump-schema", "up"\]/);
    assert.match(body, /postgres-mac:\n\s+condition: service_healthy/);
    assert.match(body, /@postgres:5432\/gto/);
    assert.deepEqual(mountsOf(body), [['./db/migrations', '/db/migrations']]);
    assert.match(body, /- \.\/db\/migrations:\/db\/migrations:ro$/m);
  });

  it('r2_22 is hardened like the built services and publishes nothing', () => {
    for (const rule of HARDENED) assert.match(body, rule);
    assert.doesNotMatch(body, /^\s+ports:/m);
  });
});

describe('backup-mirror, the one-shot mirror (O-512)', () => {
  const body = service('backup-mirror');

  it('r2_22 is a pinned rclone under the backup profile with no default command', () => {
    assert.match(body, /image: rclone\/rclone:/);
    assert.match(body, PINNED_IMAGE);
    assert.match(body, /profiles: \[backup\]/);
    assert.doesNotMatch(body, /^\s+command:/m, 'the mirror has a default command');
  });

  it('r2_22 holds the two bucket identities from .env and never the admin keys', () => {
    assert.match(body, /RCLONE_CONFIG_LIBRARY_ACCESS_KEY_ID: \$\{S3_LIBRARY_ACCESS_KEY:\?/);
    assert.match(body, /RCLONE_CONFIG_LIBRARY_SECRET_ACCESS_KEY: \$\{S3_LIBRARY_SECRET_KEY:\?/);
    assert.match(body, /RCLONE_CONFIG_REFERENCE_ACCESS_KEY_ID: \$\{S3_REFERENCE_ACCESS_KEY:\?/);
    assert.match(body, /RCLONE_CONFIG_REFERENCE_SECRET_ACCESS_KEY: \$\{S3_REFERENCE_SECRET_KEY:\?/);
    assert.doesNotMatch(body, /S3_ADMIN/, 'the mirror carries the admin keys');
    assert.match(body, /RCLONE_CONFIG_LIBRARY_ENDPOINT: http:\/\/seaweedfs:8333/);
    assert.match(body, /RCLONE_CONFIG_REFERENCE_ENDPOINT: http:\/\/seaweedfs:8333/);
  });

  it('r2_22 writes only under the drive path from .env and is hardened like the built services', () => {
    assert.deepEqual(mountsOf(body), [['${BACKUP_DRIVE_PATH:?set BACKUP_DRIVE_PATH in .env}/g-tee-oh/s3', '/backup']]);
    for (const rule of HARDENED) assert.match(body, rule);
    assert.match(body, /tmpfs:\n\s+- \/tmp:size=64m/);
    assert.doesNotMatch(body, /^\s+ports:/m);
  });
});
