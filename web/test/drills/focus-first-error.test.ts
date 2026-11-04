/**
 * Where a failed Save puts the focus (S47, R3.14, O-483; PR #48 review MEDIUM 7): the page's first
 * invalid control, else its first fieldset or the form alert made focusable, never nothing armed.
 */
import { describe, expect, it } from "vitest";

import { firstErrorTarget } from "../../src/routes/drills/use-focus-first-error.js";

function page(html: string): HTMLElement {
  const root = document.createElement("form");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

describe("R3.14 the first error's focus target", () => {
  it("R3.14 the first invalid control wins", () => {
    const root = page('<fieldset tabindex="-1"><input id="a"></fieldset><input id="b" aria-invalid="true">');
    expect(firstErrorTarget(root)?.id).toBe("b");
  });

  it("R3.14 with no invalid control the first fieldset takes the focus, made focusable", () => {
    const root = page('<div data-testid="panels"><fieldset id="g"><p class="text-danger">Error: x</p></fieldset></div>');
    const target = firstErrorTarget(root);
    expect(target?.id).toBe("g");
    expect(target?.tabIndex).toBe(-1);
    target?.focus();
    expect(document.activeElement).toBe(target);
  });

  it("R3.14 with neither, the form alert takes it; a page with none gives null", () => {
    const alert = page('<div role="alert" data-testid="form-alert">Error: Fix the fields marked below.</div>');
    expect(firstErrorTarget(alert)?.getAttribute("data-testid")).toBe("form-alert");
    expect(firstErrorTarget(page("<p>nothing</p>"))).toBeNull();
  });
});
