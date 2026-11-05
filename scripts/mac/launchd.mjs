#!/usr/bin/env node
// The nightly backup job on the Mac (S20, R2.22, O-512): `just mac-backup-install` writes a launchd
// LaunchAgent that runs `just mac-backup` in this checkout at 03:30 every night and loads it.
//
// Mechanism: a LaunchAgent runs in the owner's login session, which is where Docker Desktop runs
// too, so the job sees the same Docker; it does not run while nobody is logged in (recorded in
// O-512). The plist is rendered here from the checkout path, the home directory and the installer's
// PATH (launchd starts jobs with a minimal PATH, and just, node and docker live in Homebrew's or
// Docker's directories), every value XML-escaped. Output goes to ~/Library/Logs/g-tee-oh/. The file
// lands in ~/Library/LaunchAgents and is loaded with `launchctl bootstrap gui/<uid>`, after a
// `bootout` of any earlier copy, so a reinstall replaces it. `--print` prints the plist and changes
// nothing, which is what runs off the Mac.
// Usage: node scripts/mac/launchd.mjs [--print]
import { mkdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { MacScriptError, parseFlags, run, runMain } from './lib.mjs';

export const LABEL = 'com.g-tee-oh.backup';
export const HOUR = 3;
export const MINUTE = 30;

/** `text` with the five XML special characters escaped. */
export function xmlEscape(text) {
  return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** The LaunchAgent plist for the checkout at `repo`, logs under `home`, with `path` as PATH. */
export function renderPlist({ repo, home, path }) {
  for (const [name, value] of Object.entries({ repo, home, path })) {
    if (!value) throw new MacScriptError(`the plist needs ${name}`);
  }
  const logs = join(home, 'Library', 'Logs', 'g-tee-oh');
  const e = xmlEscape;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>just</string>
    <string>mac-backup</string>
  </array>
  <key>WorkingDirectory</key>
  <string>${e(repo)}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>${e(path)}</string>
  </dict>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key>
    <integer>${HOUR}</integer>
    <key>Minute</key>
    <integer>${MINUTE}</integer>
  </dict>
  <key>StandardOutPath</key>
  <string>${e(join(logs, 'backup.log'))}</string>
  <key>StandardErrorPath</key>
  <string>${e(join(logs, 'backup.err.log'))}</string>
  <key>RunAtLoad</key>
  <false/>
</dict>
</plist>
`;
}

export function main(argv, { runner = run, platform = process.platform, env = process.env, home = os.homedir(), repo = resolve('.'), uid = process.getuid?.() } = {}) {
  const flags = parseFlags(argv, { booleans: ['print'] });
  const plist = renderPlist({ repo, home, path: env.PATH });
  if (flags.print) {
    process.stdout.write(plist);
    return 0;
  }
  if (platform !== 'darwin') throw new MacScriptError('the backup job installs on the Mac only; --print shows it here');
  mkdirSync(join(home, 'Library', 'Logs', 'g-tee-oh'), { recursive: true });
  const agents = join(home, 'Library', 'LaunchAgents');
  mkdirSync(agents, { recursive: true });
  const target = join(agents, `${LABEL}.plist`);
  writeFileSync(target, plist, { mode: 0o644 });
  try {
    runner('launchctl', ['bootout', `gui/${uid}/${LABEL}`]);
  } catch {
    // Nothing was loaded yet.
  }
  runner('launchctl', ['bootstrap', `gui/${uid}`, target]);
  console.log(JSON.stringify({ installed: target, label: LABEL, schedule: `${String(HOUR).padStart(2, '0')}:${String(MINUTE).padStart(2, '0')} daily` }));
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runMain('mac-backup-install', main);
}
