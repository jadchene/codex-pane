import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("desktop package hardening", () => {
  it("ships application code in an integrity-checked asar with unsafe Electron entry points disabled", async () => {
    const packageJson = JSON.parse(await readFile(resolve("package.json"), "utf8"));

    expect(packageJson.build.asar).toBe(true);
    expect(packageJson.build.electronFuses).toMatchObject({
      runAsNode: false,
      enableCookieEncryption: true,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true
    });
  });
});
