import { closeSync, cpSync, existsSync, mkdirSync, openSync, renameSync, rmSync, statSync, unlinkSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";

const APPLICATION_DATA_DIRECTORIES = ["workspaces", "media", "logs"] as const;

export type UserDataLocationOptions = {
  explicitPath?: string;
  executablePath: string;
  applicationPath: string;
  legacyUserDataPath: string;
  packaged: boolean;
};

export type UserDataLocation = {
  path: string;
  warning: string | null;
  migratedDirectories: string[];
};

const ensureWritableDirectory = (path: string): void => {
  mkdirSync(path, { recursive: true });
  const probePath = join(path, `.write-probe-${randomUUID()}`);
  const descriptor = openSync(probePath, "wx");
  closeSync(descriptor);
  unlinkSync(probePath);
};

const migrateApplicationData = (source: string, target: string): string[] => {
  if (resolve(source) === resolve(target)) return [];
  const pending = APPLICATION_DATA_DIRECTORIES.filter((name) => {
    const sourceDirectory = join(source, name);
    if (!existsSync(sourceDirectory) || existsSync(join(target, name))) return false;
    if (!statSync(sourceDirectory).isDirectory()) throw new Error(`Legacy data path is not a directory: ${sourceDirectory}`);
    return true;
  });
  if (!pending.length) return [];

  const stagingDirectory = join(target, `.migration-${randomUUID()}`);
  mkdirSync(stagingDirectory);
  try {
    for (const name of pending) cpSync(join(source, name), join(stagingDirectory, name), { recursive: true, errorOnExist: true });
    for (const name of pending) renameSync(join(stagingDirectory, name), join(target, name));
    return [...pending];
  } finally {
    rmSync(stagingDirectory, { recursive: true, force: true });
  }
};

export const prepareUserDataLocation = (options: UserDataLocationOptions): UserDataLocation => {
  if (options.explicitPath) {
    const path = resolve(options.explicitPath);
    ensureWritableDirectory(path);
    return { path, warning: null, migratedDirectories: [] };
  }

  const applicationDirectory = options.packaged ? dirname(options.executablePath) : options.applicationPath;
  const preferredPath = resolve(applicationDirectory, "data");

  try {
    ensureWritableDirectory(preferredPath);
  } catch {
    const fallbackPath = resolve(options.legacyUserDataPath);
    ensureWritableDirectory(fallbackPath);
    return {
      path: fallbackPath,
      warning: `程序所在目录不可写，用户数据已改存到 ${fallbackPath}。如需数据随程序保存，请将 Codex Pane 放到可写目录。`,
      migratedDirectories: []
    };
  }

  const hasAdjacentApplicationData = APPLICATION_DATA_DIRECTORIES.some((name) => existsSync(join(preferredPath, name)));
  try {
    const migratedDirectories = migrateApplicationData(options.legacyUserDataPath, preferredPath);
    return {
      path: preferredPath,
      warning: migratedDirectories.length
        ? `已将原用户数据复制到程序旁的 data 目录；原目录仍保留，可在确认数据完整后自行清理。`
        : null,
      migratedDirectories
    };
  } catch {
    if (!hasAdjacentApplicationData) {
      const fallbackPath = resolve(options.legacyUserDataPath);
      ensureWritableDirectory(fallbackPath);
      return {
        path: fallbackPath,
        warning: `原用户数据未能完整复制，本次继续使用 ${fallbackPath}；程序旁未留下不完整副本，下次启动会重试。`,
        migratedDirectories: []
      };
    }
    return {
      path: preferredPath,
      warning: "程序旁的 data 目录已启用，但原用户数据未能自动复制。原目录仍保留，请按 README 手工迁移。",
      migratedDirectories: []
    };
  }
};
