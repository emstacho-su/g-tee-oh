/**
 * The shell header on its own (R3.13): without a signed-in user read it shows no email, and
 * Sign out is disabled while its request runs. The auth hooks are replaced so the header renders
 * outside the router and query client.
 */
import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  me: { data: undefined as { user: { email: string } } | undefined },
  logout: { mutate: vi.fn(), isPending: false },
}));

vi.mock("../../src/auth/index.js", () => ({
  useMe: () => auth.me,
  useLogout: () => auth.logout,
}));

const { AppHeader } = await import("../../src/app/AppHeader.js");

afterEach(() => {
  auth.me = { data: undefined };
  auth.logout = { mutate: vi.fn(), isPending: false };
});

describe("R3.13 AppHeader", () => {
  it("R3.13 shows no email before the signed-in user is read", () => {
    render(<AppHeader />);
    const header = screen.getByTestId("app-header");
    expect(header).toHaveTextContent("g-tee-oh");
    expect(header.querySelector("span[title]")).toBeNull();
  });

  it("R3.13 disables Sign out while the logout request runs", () => {
    auth.me = { data: { user: { email: "owner@example.com" } } };
    auth.logout = { mutate: vi.fn(), isPending: true };
    render(<AppHeader />);
    expect(screen.getByText("owner@example.com")).toHaveAttribute("title", "owner@example.com");
    expect(screen.getByRole("button", { name: "Sign out" })).toBeDisabled();
  });
});
