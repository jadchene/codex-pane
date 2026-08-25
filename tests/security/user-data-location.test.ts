import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { prepareUserDataLocation } from "../../electron/main/user-data-location";

const createRoot = (): string => resolve("test-results", `user-data-location-${randomUUID()}`);

describe("Electron user data location", () => {
  it("stores packaged application data beside the executable and migrates managed legacy data", async () => {
    const root = createRoot();
    const legacy = join(root, "legacy");
    const install = join(root, "install");
    await mkdir(join(legacy, "workspaces"), { recursive: true });
    await mkdir(install, { recursive: true });
    await writeFile(join(legacy, "workspaces", "default.json"), "legacy-workspace", "utf8");
    try {
      const location = prepareUserDataLocation({
        executablePath: join(install, "Codex Pane.exe"),
        applicationPath: root,
        legacyUserDataPath: legacy,
        packaged: true
      });
      expect(location.path).toBe(join(install, "data"));
      expect(location.migratedDirectories).toEqual(["workspaces"]);
      expect(await readFile(join(location.path, "workspaces", "default.json"), "utf8")).toBe("legacy-workspace");
      expect(await readFile(join(legacy, "workspaces", "default.json"), "utf8")).toBe("legacy-workspace");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("never overwrites existing packaged data while migrating missing directories", async () => {
    const root = createRoot();
    const legacy = join(root, "legacy");
    const install = join(root, "install");
    await mkdir(join(legacy, "workspaces"), { recursive: true });
    await mkdir(join(legacy, "media"), { recursive: true });
    await mkdir(join(install, "data", "workspaces"), { recursive: true });
    await writeFile(join(legacy, "workspaces", "default.json"), "legacy", "utf8");
    await writeFile(join(legacy, "media", "image.png"), "image", "utf8");
    await writeFile(join(install, "data", "workspaces", "default.json"), "packaged", "utf8");
    try {
      const location = prepareUserDataLocation({
        executablePath: join(install, "Codex Pane.exe"),
        applicationPath: root,
        legacyUserDataPath: legacy,
        packaged: true
      });
      expect(location.path).toBe(join(install, "data"));
      expect(location.migratedDirectories).toEqual(["media"]);
      expect(await readFile(join(location.path, "workspaces", "default.json"), "utf8")).toBe("packaged");
      expect(await readFile(join(location.path, "media", "image.png"), "utf8")).toBe("image");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("honors an explicit test path without importing legacy data", async () => {
    const root = createRoot();
    const explicit = join(root, "isolated");
    const legacy = join(root, "legacy");
    await mkdir(join(legacy, "workspaces"), { recursive: true });
    try {
      const location = prepareUserDataLocation({
        explicitPath: explicit,
        executablePath: join(root, "Codex Pane.exe"),
        applicationPath: root,
        legacyUserDataPath: legacy,
        packaged: true
      });
      expect(location).toEqual({ path: explicit, warning: null, migratedDirectories: [] });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("falls back to the legacy directory with a readable warning when the adjacent path is unavailable", async () => {
    const root = createRoot();
    const legacy = join(root, "legacy");
    const install = join(root, "install");
    await mkdir(legacy, { recursive: true });
    await mkdir(install, { recursive: true });
    await writeFile(join(install, "data"), "not-a-directory", "utf8");
    try {
      const location = prepareUserDataLocation({
        executablePath: join(install, "Codex Pane.exe"),
        applicationPath: root,
        legacyUserDataPath: legacy,
        packaged: true
      });
      expect(location.path).toBe(legacy);
      expect(location.warning).toContain("程序所在目录不可写");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not leave a partial adjacent copy and retries a failed migration", async () => {
    const root = createRoot();
    const legacy = join(root, "legacy");
    const install = join(root, "install");
    await mkdir(legacy, { recursive: true });
    await mkdir(install, { recursive: true });
    await writeFile(join(legacy, "workspaces"), "invalid-directory", "utf8");
    const options = {
      executablePath: join(install, "Codex Pane.exe"),
      applicationPath: root,
      legacyUserDataPath: legacy,
      packaged: true
    };
    try {
      const failed = prepareUserDataLocation(options);
      expect(failed.path).toBe(legacy);
      expect(failed.warning).toContain("继续使用");
      expect(failed.warning).toContain(legacy);
      expect(await readFile(join(legacy, "workspaces"), "utf8")).toBe("invalid-directory");

      await rm(join(legacy, "workspaces"), { force: true });
      await mkdir(join(legacy, "workspaces"), { recursive: true });
      await mkdir(join(legacy, "media", "nested"), { recursive: true });
      await mkdir(join(legacy, "logs"), { recursive: true });
      await writeFile(join(legacy, "workspaces", "default.json"), "workspace", "utf8");
      await writeFile(join(legacy, "media", "nested", "image.bin"), Buffer.from([0, 1, 2, 3]));
      await writeFile(join(legacy, "logs", "app.log"), "log", "utf8");

      const retried = prepareUserDataLocation(options);
      expect(retried.path).toBe(join(install, "data"));
      expect(retried.migratedDirectories).toEqual(["workspaces", "media", "logs"]);
      expect(await readFile(join(retried.path, "media", "nested", "image.bin"))).toEqual(Buffer.from([0, 1, 2, 3]));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
