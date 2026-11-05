// Shared parts of the Deploy 1 scripts (S20, R2.22): the compose command line per profile, the
// service names each profile gives Postgres, a checked child-process runner and the UTC stamp.
//
// Mechanism: every script runs `docker compose --project-directory . -f infra/compose/compose.yaml`
// from the repository root with one profile, `mac` on the Mac (the default) or `dev` on the
// Zenbook (O-23), where the S20 sitting 1 rehearsal runs the same scripts against the dev stack.
// Postgres is `postgres-mac` under mac and `postgres` under dev; the backup mirror is always the
// `backup-mirror` one-shot of the `backup` profile. Children run with shell: false, so no argument
// is ever parsed by a shell, and a non-zero exit throws a MacScriptError naming the command.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

export const COMPOSE_FILE = 'infra/compose/compose.yaml';
export const PROFILES = ['mac', 'dev'];
export const DEFAULT_PROFILE = 'mac';
export const BACKUP_PROFILE = 'backup';
export const MIRROR_SERVICE = 'backup-mirror';
export const DATABASE = 'gto';
export const SUPERUSER = 'postgres';

const POSTGRES_SERVICE = { mac: 'postgres-mac', dev: 'postgres' };
const SEAWEEDFS_SERVICE = { mac: 'seaweedfs-mac', dev: 'seaweedfs' };

/** Raised for anything a script refuses or a command that fails; the message says what to fix. */
export class MacScriptError extends Error {
  constructor(message) {
    super(message);
    this.name = 'MacScriptError';
  }
}

/** The profile, checked: `mac` or `dev`. */
export function checkProfile(profile) {
  if (!PROFILES.includes(profile)) {
    throw new MacScriptError(`profile ${JSON.stringify(profile)} is not one of ${PROFILES.join(', ')}`);
  }
  return profile;
}

/** The Postgres service of a profile. */
export function postgresService(profile) {
  return POSTGRES_SERVICE[checkProfile(profile)];
}

/** The SeaweedFS service of a profile. */
export function seaweedfsService(profile) {
  return SEAWEEDFS_SERVICE[checkProfile(profile)];
}

/** `docker compose ...` arguments (without `docker`) for `profiles` followed by `rest`. */
export function composeArgs(profiles, rest) {
  const flags = profiles.flatMap((profile) => ['--profile', profile]);
  return ['compose', '--project-directory', '.', '-f', COMPOSE_FILE, ...flags, ...rest];
}

/** `docker compose exec -T <postgres> psql ...` arguments for one SQL text read from stdin. */
export function psqlArgs(profile, { database = DATABASE, variables = {} } = {}) {
  const vars = Object.entries(variables).flatMap(([name, value]) => ['-v', `${name}=${value}`]);
  return composeArgs([profile], [
    'exec', '-T', postgresService(profile),
    'psql', '-U', SUPERUSER, '-d', database, '-v', 'ON_ERROR_STOP=1', '-X', '-q', '-At', ...vars,
  ]);
}

/** `docker compose run --rm backup-mirror <rclone args>` arguments. */
export function mirrorArgs(profile, rcloneArgs) {
  return composeArgs([checkProfile(profile), BACKUP_PROFILE], ['run', '--rm', '--no-deps', MIRROR_SERVICE, ...rcloneArgs]);
}

/**
 * Runs `command` with `args` and no shell, and returns its stdout. `input` goes to stdin;
 * `stdin` and `stdout` may be file descriptors instead. A failure throws, naming the command.
 */
export function run(command, args, { input, stdin, stdout, spawn = spawnSync } = {}) {
  const result = spawn(command, args, {
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
    input,
    stdio: [stdin ?? 'pipe', stdout ?? 'pipe', 'inherit'],
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw new MacScriptError(`${command} did not start: ${result.error.message}`);
  if (result.status !== 0) {
    throw new MacScriptError(`${command} ${args.slice(0, 8).join(' ')} ... exited ${result.status}`);
  }
  return result.stdout ?? '';
}

/**
 * One variable from the environment, else from the repo's .env (the justfile does not load it, and
 * the LaunchAgent starts with no environment beyond PATH). Only the named key is taken from the file.
 */
export function envValue(name, env = process.env, dotenvPath = '.env') {
  const value = env[name];
  if (value !== undefined && value !== '') return value;
  if (!existsSync(dotenvPath)) return undefined;
  return parseEnv(readFileSync(dotenvPath, 'utf8'))[name];
}

/** `date` as a sortable UTC stamp, for example 20261105T033000Z. */
export function utcStamp(date) {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** `--name value` pairs and bare `--flag`s after the script name; unknown names are refused. */
export function parseFlags(argv, { values = [], booleans = [] }) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const word = argv[index];
    const name = word.startsWith('--') ? word.slice(2) : null;
    if (name !== null && booleans.includes(name)) {
      out[name] = true;
    } else if (name !== null && values.includes(name)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith('--')) throw new MacScriptError(`--${name} needs a value`);
      if (name in out) throw new MacScriptError(`--${name} is given twice`);
      out[name] = value;
      index += 1;
    } else {
      throw new MacScriptError(`unknown argument ${JSON.stringify(word)}`);
    }
  }
  return out;
}

/** Runs `main` as the script's entry point: an error prints its message and exits 1. */
export function runMain(name, main) {
  try {
    const code = main(process.argv.slice(2));
    process.exitCode = typeof code === 'number' ? code : 0;
  } catch (error) {
    console.error(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
