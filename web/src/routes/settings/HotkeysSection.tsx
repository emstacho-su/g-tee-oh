/**
 * The read-only Hotkeys section of /settings (S32, O-327, O-285): a table of the trainer and app
 * shortcuts from hotkey-table.ts, and a note that rebinding comes later.
 */
import { HOTKEY_ROWS } from "./hotkey-table.js";
import { HOTKEYS_TEXT } from "./settings-text.js";
import { SettingsSection } from "./SettingsSection.js";

export function HotkeysSection() {
  return (
    <SettingsSection title={HOTKEYS_TEXT.title} description={HOTKEYS_TEXT.description}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{HOTKEYS_TEXT.caption}</caption>
          <thead className="text-muted">
            <tr>
              <th scope="col" className="py-1 pr-4 font-medium">
                Key
              </th>
              <th scope="col" className="py-1 pr-4 font-medium">
                Action
              </th>
              <th scope="col" className="py-1 font-medium">
                Where
              </th>
            </tr>
          </thead>
          <tbody>
            {HOTKEY_ROWS.map((row) => (
              <tr key={row.key} className="border-t border-border">
                <th scope="row" className="py-1 pr-4 font-normal">
                  <kbd className="whitespace-nowrap rounded border border-border bg-surface-sunken px-1.5 font-mono">{row.key}</kbd>
                </th>
                <td className="py-1 pr-4">{row.action}</td>
                <td className="py-1 text-muted">{row.scope}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-muted">{HOTKEYS_TEXT.later}</p>
    </SettingsSection>
  );
}
