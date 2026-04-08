import { describe, expect, it, vi } from "vitest";
import { SseHub } from "../lib/sse-hub.js";

describe("SseHub", () => {
  it("delivers broadcast to subscribed writer", async () => {
    const hub = new SseHub();
    const writer = vi.fn();
    hub.subscribe("user-1", writer);
    hub.broadcast("user-1", "notification", { hello: "world" });
    expect(writer).toHaveBeenCalledWith("notification", { hello: "world" });
  });

  it("does not deliver to other users", () => {
    const hub = new SseHub();
    const writer = vi.fn();
    hub.subscribe("user-1", writer);
    hub.broadcast("user-2", "notification", { x: 1 });
    expect(writer).not.toHaveBeenCalled();
  });

  it("unsubscribe removes writer", () => {
    const hub = new SseHub();
    const writer = vi.fn();
    const off = hub.subscribe("user-1", writer);
    off();
    hub.broadcast("user-1", "notification", { x: 1 });
    expect(writer).not.toHaveBeenCalled();
  });

  it("drops writer when async push rejects", async () => {
    const hub = new SseHub();
    const bad = vi.fn().mockRejectedValue(new Error("write failed"));
    const good = vi.fn().mockResolvedValue(undefined);
    hub.subscribe("user-1", bad);
    hub.subscribe("user-1", good);
    hub.broadcast("user-1", "notification", { n: 1 });
    await new Promise((r) => setTimeout(r, 10));
    expect(bad).toHaveBeenCalledWith("notification", { n: 1 });
    expect(good).toHaveBeenCalledWith("notification", { n: 1 });
    bad.mockClear();
    good.mockClear();
    hub.broadcast("user-1", "notification", { n: 2 });
    await new Promise((r) => setTimeout(r, 10));
    expect(bad).not.toHaveBeenCalled();
    expect(good).toHaveBeenCalledWith("notification", { n: 2 });
  });
});
