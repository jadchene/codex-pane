import { describe, expect, it } from "vitest";
import { MAX_REMOTE_MESSAGE_BYTES, createEnvelope, mobileCommandSchema, parseEnvelopeText, routeEnvelopeSchema } from "../../packages/remote-protocol/src/index";

describe("remote protocol", () => {
  it("accepts only the supported product commands", () => {
    const requestId = crypto.randomUUID();
    expect(mobileCommandSchema.parse({ type: "snapshot.get", requestId }).type).toBe("snapshot.get");
    expect(() => mobileCommandSchema.parse({ type: "turn.interrupt", requestId, threadId: "thread-1" })).toThrow();
    expect(() => mobileCommandSchema.parse({ type: "turn.send", requestId, text: "/model gpt" })).not.toThrow();
    expect(() => mobileCommandSchema.parse({ type: "remote.disable", requestId })).not.toThrow();
    expect(() => mobileCommandSchema.parse({ type: "approval.resolve", requestId, approvalId: "approval-1", version: 1, decision: "accept", selection: "测试" })).not.toThrow();
    expect(() => mobileCommandSchema.parse({ type: "turn.send", requestId, text: "x".repeat(20_001) })).toThrow();
  });

  it("rejects invalid lifetimes and oversized messages", () => {
    const envelope = createEnvelope("device-1", { type: "snapshot.get", requestId: crypto.randomUUID() }, 1_000);
    expect(routeEnvelopeSchema.parse(envelope).version).toBe(1);
    expect(() => routeEnvelopeSchema.parse({ ...envelope, expiresAt: envelope.sentAt + 60_001 })).toThrow();
    expect(() => parseEnvelopeText(`"${"x".repeat(MAX_REMOTE_MESSAGE_BYTES)}"`)).toThrow("消息超过大小限制");
  });
});
