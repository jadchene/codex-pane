import { randomUUID } from "node:crypto";
import { copyFile, mkdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import type { FileReference } from "../shared/contracts.js";

const MAX_FILE_BYTES = 100 * 1024 * 1024;

export class FileStore {
  readonly #directory: string;

  constructor(directory: string) {
    this.#directory = resolve(directory);
  }

  async initialize(): Promise<void> {
    await mkdir(this.#directory, { recursive: true });
  }

  async importPath(sourcePath: string): Promise<FileReference> {
    const normalizedPath = resolve(sourcePath.trim().replace(/^['"]|['"]$/g, ""));
    const sourceStat = await stat(normalizedPath);
    if (!sourceStat.isFile() || sourceStat.size > MAX_FILE_BYTES) {
      throw new Error("请选择不超过 100 MB 的文件。" );
    }
    const id = randomUUID();
    const name = basename(normalizedPath);
    const destination = this.resolveAttachment(id, name);
    await copyFile(normalizedPath, destination);
    return { id, name, path: destination, managed: true };
  }

  resolveAttachment(id: string, name: string): string {
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error("文件引用无效。" );
    const extension = extname(basename(name));
    const safeExtension = /^\.[a-z0-9_-]{1,20}$/i.test(extension) ? extension : "";
    const path = resolve(this.#directory, `${id}${safeExtension}`);
    if (!path.startsWith(`${this.#directory}\\`) && path !== join(this.#directory, `${id}${safeExtension}`)) {
      throw new Error("文件路径不在应用管理目录中。" );
    }
    return path;
  }
}
