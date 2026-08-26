import { z } from "zod";

const shortId = z.string().min(1).max(512);
const nullableString = z.string().max(32_768).nullable();
const textInput = z.object({ type: z.literal("text"), text: z.string().max(200_000), text_elements: z.array(z.unknown()).max(100).default([]) });
const localImageInput = z.object({ type: z.literal("managedImage"), id: z.string().uuid(), detail: z.enum(["low", "high", "auto"]).optional() });
const remoteImageInput = z.object({ type: z.literal("managedRemoteImage"), url: z.string().url().max(8_192), detail: z.enum(["low", "high", "auto"]).optional() });
const managedFileInput = z.object({ type: z.literal("managedFile"), id: z.string().uuid(), name: z.string().min(1).max(512) });
const skillInput = z.object({ type: z.literal("skill"), name: z.string().min(1).max(512), path: z.string().min(1).max(32_768) });
const mentionInput = z.object({ type: z.literal("mention"), name: z.string().min(1).max(512), path: z.string().min(1).max(32_768) });
const userInput = z.union([textInput, localImageInput, remoteImageInput, managedFileInput, skillInput, mentionInput]);

export const safeRequestSchema = z.discriminatedUnion("method", [
  z.object({ method: z.literal("model/list"), params: z.object({ limit: z.number().int().min(1).max(200) }) }),
  z.object({ method: z.literal("account/read"), params: z.object({ refreshToken: z.boolean() }) }),
  z.object({ method: z.literal("account/rateLimits/read"), params: z.undefined().optional() }),
  z.object({ method: z.literal("account/usage/read"), params: z.object({ threadId: shortId.nullable().optional() }) }),
  z.object({ method: z.literal("config/read"), params: z.object({ includeLayers: z.boolean(), cwd: nullableString }) }),
  z.object({ method: z.literal("permissionProfile/list"), params: z.object({ cursor: nullableString, limit: z.number().int().min(1).max(100), cwd: nullableString }) }),
  z.object({ method: z.literal("thread/list"), params: z.object({
    limit: z.number().int().min(1).max(100),
    sortKey: z.enum(["created_at", "updated_at"]),
    sortDirection: z.enum(["asc", "desc"]),
    searchTerm: nullableString,
    cwd: nullableString.optional(),
    ancestorThreadId: shortId.nullable().optional(),
    sourceKinds: z.array(z.enum(["subAgent", "subAgentReview", "subAgentCompact", "subAgentThreadSpawn", "subAgentOther"])).max(5).nullable().optional()
  }) }),
  z.object({ method: z.literal("thread/resume"), params: z.object({
    threadId: shortId,
    excludeTurns: z.boolean(),
    initialTurnsPage: z.object({
      limit: z.number().int().min(1).max(100),
      sortDirection: z.literal("desc"),
      itemsView: z.literal("full")
    }).optional()
  }) }),
  z.object({ method: z.literal("thread/turns/list"), params: z.object({
    threadId: shortId,
    cursor: nullableString,
    limit: z.number().int().min(1).max(100),
    sortDirection: z.literal("desc"),
    itemsView: z.literal("full")
  }) }),
  z.object({ method: z.literal("thread/start"), params: z.object({ cwd: nullableString, model: z.string().max(200).nullable(), ephemeral: z.boolean() }) }),
  z.object({ method: z.literal("thread/settings/update"), params: z.object({ threadId: shortId, cwd: z.string().max(32_768).optional(), permissions: z.string().min(1).max(512).optional() }).refine((params) => params.cwd !== undefined || params.permissions !== undefined, { message: "至少需要一项会话设置" }) }),
  z.object({ method: z.literal("turn/start"), params: z.object({ threadId: shortId, clientUserMessageId: shortId.nullable().optional(), input: z.array(userInput).min(1).max(100), model: z.string().max(200).nullable(), effort: z.string().max(50).nullable() }) }),
  z.object({ method: z.literal("turn/steer"), params: z.object({ threadId: shortId, clientUserMessageId: shortId.nullable().optional(), expectedTurnId: shortId, input: z.array(userInput).min(1).max(100) }) }),
  z.object({ method: z.literal("turn/interrupt"), params: z.object({ threadId: shortId, turnId: shortId }) }),
  z.object({ method: z.literal("thread/compact/start"), params: z.object({ threadId: shortId }) }),
  z.object({ method: z.literal("review/start"), params: z.object({ threadId: shortId, target: z.object({ type: z.literal("uncommittedChanges") }), delivery: z.literal("inline") }) }),
  z.object({ method: z.literal("mcpServerStatus/list"), params: z.object({ threadId: shortId.nullable().optional(), limit: z.number().int().min(1).max(100), detail: z.literal("full") }) }),
  z.object({ method: z.literal("mcpServer/oauth/login"), params: z.object({ name: z.string().min(1).max(200), threadId: shortId.nullable().optional(), clientRegistration: z.enum(["auto", "cimd", "dcr"]).nullable().optional(), scopes: z.array(z.string().min(1).max(500)).max(100).nullable().optional() }) }),
  z.object({ method: z.literal("thread/backgroundTerminals/list"), params: z.object({ threadId: shortId, cursor: nullableString.optional(), limit: z.number().int().min(1).max(100).nullable().optional() }) }),
  z.object({ method: z.literal("thread/backgroundTerminals/terminate"), params: z.object({ threadId: shortId, processId: shortId }) }),
  z.object({ method: z.literal("thread/backgroundTerminals/clean"), params: z.object({ threadId: shortId }) }),
  z.object({ method: z.literal("skills/list"), params: z.object({ cwds: z.array(z.string().max(32_768)).max(1), forceReload: z.boolean() }) })
]);

export const serverResponseSchema = z.object({
  generation: z.number().int().positive(),
  id: z.union([z.string(), z.number()]),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional()
}).refine((value) => (value.result !== undefined) !== (value.error !== undefined), {
  message: "处理结果和错误必须且只能提供一个"
});

export type SafeRequest = z.infer<typeof safeRequestSchema>;
export type ServerResponse = z.infer<typeof serverResponseSchema>;

export type ConnectionState = {
  phase: "stopped" | "starting" | "ready" | "error" | "restarting";
  generation: number;
  codexVersion: string | null;
  compatible: boolean | null;
  message: string;
};

export type ProtocolEvent = {
  generation: number;
  kind: "notification" | "notification-batch" | "server-request" | "diagnostic";
  payload: unknown;
};

export type MediaAttachment = {
  id: string;
  name: string;
  url: string;
  size: number;
  kind: "local" | "remote";
  sourceUrl?: string;
};

export type FileReference = {
  id: string;
  name: string;
  path: string;
  managed?: boolean;
};

export type AttachmentBatch = {
  images: MediaAttachment[];
  files: FileReference[];
};
