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
    expect(packageJson.build.win.target).toEqual(expect.arrayContaining(["nsis", "portable", "dir"]));
    expect(packageJson.build.nsis).toMatchObject({
      oneClick: false,
      allowToChangeInstallationDirectory: true,
      deleteAppDataOnUninstall: false
    });
    expect(packageJson.build.portable.requestExecutionLevel).toBe("user");
  });

  it("waits for the renderer workspace flush before every native window close", async () => {
    const [main, preload, app] = await Promise.all([
      readFile(resolve("electron/main/index.ts"), "utf8"),
      readFile(resolve("electron/preload/index.ts"), "utf8"),
      readFile(resolve("src/App.vue"), "utf8")
    ]);
    expect(main).toContain('webContents.send("window:close-requested")');
    expect(main).toContain('ipcMain.handle("window:close-response"');
    expect(preload).toContain("onCloseRequested:");
    expect(app).toContain("store.flushSave().then(");
  });
});
