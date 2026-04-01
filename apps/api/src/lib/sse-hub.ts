/**
 * In-memory fan-out: each user id maps to active SSE writers (Hono stream callbacks).
 */
export type SseStreamWriter = (event: object) => void | Promise<void>;

export class SseHub {
  private readonly subscribers = new Map<string, Set<SseStreamWriter>>();

  subscribe(userId: string, streamWriter: SseStreamWriter): () => void {
    let set = this.subscribers.get(userId);
    if (!set) {
      set = new Set();
      this.subscribers.set(userId, set);
    }
    set.add(streamWriter);
    return () => this.unsubscribe(userId, streamWriter);
  }

  unsubscribe(userId: string, streamWriter: SseStreamWriter): void {
    const set = this.subscribers.get(userId);
    if (!set) return;
    set.delete(streamWriter);
    if (set.size === 0) {
      this.subscribers.delete(userId);
    }
  }

  broadcast(userId: string, event: object): void {
    const set = this.subscribers.get(userId);
    if (!set?.size) return;
    for (const writer of [...set]) {
      try {
        const out = writer(event);
        if (out !== undefined && typeof (out as Promise<void>).then === "function") {
          (out as Promise<void>).catch(() => this.unsubscribe(userId, writer));
        }
      } catch {
        this.unsubscribe(userId, writer);
      }
    }
  }
}

export const sseHub = new SseHub();
