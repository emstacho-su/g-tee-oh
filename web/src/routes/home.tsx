/**
 * Home placeholder (R0.7). The trainer screens from A7 section 2 replace this in S24; until
 * then it names the app and links to the sign-in placeholder so the router has two routes.
 */
import { Link } from "@tanstack/react-router";

export function HomePage() {
  return (
    <section>
      <h1>g-tee-oh</h1>
      <p>Personal no-limit hold'em trainer. The trainer screens arrive with S24.</p>
      <p>
        <Link to="/login">Sign in</Link>
      </p>
    </section>
  );
}
