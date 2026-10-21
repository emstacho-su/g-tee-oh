import { describe, expect, it } from "vitest";

import { DEFAULT_API_PORT, parseApiPort } from "../src/config.js";

describe("@g-tee-oh/api config", () => {
  it("R0.7 API_PORT defaults to 8080 when unset or blank and accepts an integer port", () => {
    expect(parseApiPort(undefined)).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("")).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("  ")).toBe(DEFAULT_API_PORT);
    expect(parseApiPort("8081")).toBe(8081);
    expect(parseApiPort(" 8081 ")).toBe(8081);
  });

  it("R0.7 API_PORT rejects anything that is not a port number", () => {
    for (const raw of ["0", "65536", "-1", "80a", "8080.5", "0x1F", "abc"]) {
      expect(() => parseApiPort(raw), raw).toThrow(/API_PORT must be an integer/);
    }
  });
});
