import { describe, expect, it } from "vitest";

import { INTERNAL_DEPENDENCIES, PACKAGE_NAME } from "../src/index.js";

describe("@g-tee-oh/web", () => {
  it("R0.1 web stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/web");
  });

  it("R0.1 web stub resolves its workspace dependency", () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(["@g-tee-oh/contracts"]);
  });
});
