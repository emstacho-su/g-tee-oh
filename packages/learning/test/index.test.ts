import { describe, expect, it } from "vitest";

import { PACKAGE_NAME } from "../src/index.js";

describe("@g-tee-oh/learning", () => {
  it("R0.1 learning stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/learning");
  });
});
