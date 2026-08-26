import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FileStore } from "../../electron/main/file-store";

let testDirectory = "";

afterEach(async () => {
  if (testDirectory) await rm(testDirectory, { recursive: true, force: true });
});

describe("FileStore", () => {
  it("copies a selected file into the managed data directory and preserves its extension", async () => {
    testDirectory = await mkdtemp(join(tmpdir(), "codex-pane-files-"));
    const source = join(testDirectory, "notes.txt");
    const managedDirectory = join(testDirectory, "data", "files");
    await writeFile(source, "managed attachment", "utf8");
    const store = new FileStore(managedDirectory);
    await store.initialize();

    const reference = await store.importPath(source);
    const managedPath = store.resolveAttachment(reference.id, reference.name);

    expect(reference).toMatchObject({ name: "notes.txt", managed: true });
    expect(managedPath).toContain(managedDirectory);
    expect(managedPath).toMatch(/\.txt$/);
    expect(await readFile(managedPath, "utf8")).toBe("managed attachment");
  });
});
