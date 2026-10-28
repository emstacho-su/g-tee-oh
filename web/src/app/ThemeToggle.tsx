/**
 * Theme toggle button (R3.13, O-266). Its accessible name says what a press does ("Switch to dark
 * theme" while light), and its visible text says the same, so the state is not carried by an icon
 * or color alone.
 */
import { Button } from "../components/ui/index.js";
import { useThemeStore } from "../store/index.js";

export function ThemeToggle() {
  const theme = useThemeStore((state) => state.theme);
  const toggle = useThemeStore((state) => state.toggle);
  const label = theme === "dark" ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Button variant="ghost" size="sm" className="whitespace-nowrap" onClick={toggle} aria-label={label}>
      {theme === "dark" ? "Light theme" : "Dark theme"}
    </Button>
  );
}
