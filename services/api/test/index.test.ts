import { describe, expect, it } from "vitest";

import { INTERNAL_DEPENDENCIES, PACKAGE_NAME } from "../src/index.js";

describe("@g-tee-oh/api", () => {
  it("R0.1 api stub builds and exports its name", () => {
    expect(PACKAGE_NAME).toBe("@g-tee-oh/api");
  });

  it("R0.1 api stub resolves its workspace dependencies", () => {
    expect(INTERNAL_DEPENDENCIES).toEqual(["@g-tee-oh/contracts", "@g-tee-oh/learning"]);
  });
});
