/**
 * Shown when the authenticated layout cannot load the session (R3.13): /me failed with something
 * other than 401 (server down, network error). The message is fixed text, never the server's
 * detail (A9 section 3); Try again reruns the route loads.
 */
import { useRouter } from "@tanstack/react-router";

import { Button } from "../components/ui/index.js";

export function SessionError() {
  const router = useRouter();
  return (
    <section className="mx-auto max-w-md p-6">
      <p role="alert" className="mb-3 text-danger">
        Could not load your session.
      </p>
      <Button variant="primary" onClick={() => void router.invalidate()}>
        Try again
      </Button>
    </section>
  );
}
