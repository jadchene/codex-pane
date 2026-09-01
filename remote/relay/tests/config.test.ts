import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("relay configuration", () => {
  it("normalizes a root origin and keeps local HTTP development available", () => {
    expect(loadConfig({ PUBLIC_ORIGIN: "https://pane.example.com/" }).PUBLIC_ORIGIN).toBe("https://pane.example.com");
    expect(loadConfig({ PUBLIC_ORIGIN: "http://localhost:3000" }).PUBLIC_ORIGIN).toBe("http://localhost:3000");
  });

  it.each([
    "http://pane.example.com",
    "https://user:secret@pane.example.com",
    "https://pane.example.com/relay",
    "https://pane.example.com?token=value",
    "https://pane.example.com/#mobile"
  ])("rejects a non-origin PUBLIC_ORIGIN: %s", (value) => {
    expect(() => loadConfig({ PUBLIC_ORIGIN: value })).toThrow(/PUBLIC_ORIGIN/);
  });
});
