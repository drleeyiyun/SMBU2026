import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Hono } from "hono";
import { loadEnv } from "../env.js";
import type { AuthVariables } from "../middleware/session.js";
import { requireUser, sessionMiddleware } from "../middleware/session.js";

const MIME_TO_EXT: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
};

function extToMime(ext: string): string {
  const e = ext.toLowerCase();
  if (e === ".jpg" || e === ".jpeg") return "image/jpeg";
  if (e === ".png") return "image/png";
  if (e === ".webp") return "image/webp";
  if (e === ".gif") return "image/gif";
  return "application/octet-stream";
}

function safeStoredName(name: string): string | null {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpe?g|png|webp|gif)$/i.test(
      name,
    )
  ) {
    return null;
  }
  return name;
}

function resolveUploadDir(): string {
  const env = loadEnv();
  return path.isAbsolute(env.UPLOAD_DIR)
    ? env.UPLOAD_DIR
    : path.join(process.cwd(), env.UPLOAD_DIR);
}

/** Max multipart image size (bytes). Keep below or equal to reverse-proxy `client_max_body_size`. */
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

export const uploadsRouter = new Hono<{ Variables: AuthVariables }>()
  .post("/image", sessionMiddleware, requireUser, async (c) => {
    const env = loadEnv();
    const body = await c.req.parseBody();
    const file = body["file"];
    if (!(file instanceof File)) {
      return c.json({ error: "Expected multipart field file" }, 400);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return c.json({ error: "File too large (max 20MB)" }, 400);
    }
    const mime = file.type;
    const ext = MIME_TO_EXT[mime];
    if (!ext) {
      return c.json({ error: "Unsupported image type" }, 400);
    }
    const stored = `${randomUUID()}${ext}`;
    const dir = resolveUploadDir();
    await mkdir(dir, { recursive: true });
    const buf = Buffer.from(await file.arrayBuffer());
    await writeFile(path.join(dir, stored), buf);

    // Prefer relative `/uploads/...` when no public base is set so the browser
    // uses the same host as the page (Vite proxy, nginx, LAN IP). Using the
    // API request origin often yields `http://localhost:3000`, which breaks
    // when the app is opened via another host/port or a non-published API port.
    const base = env.PUBLIC_ASSET_BASE?.replace(/\/$/, "");
    const url = base ? `${base}/uploads/${stored}` : `/uploads/${stored}`;
    return c.json({ url });
  })
  .get("/:name", async (c) => {
    const name = safeStoredName(c.req.param("name"));
    if (!name) {
      return c.body(null, 404);
    }
    const dir = resolveUploadDir();
    const full = path.join(dir, name);
    const normalized = path.normalize(full);
    const rel = path.relative(dir, normalized);
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      return c.body(null, 404);
    }
    try {
      const buf = await readFile(normalized);
      return c.body(buf, 200, {
        "Content-Type": extToMime(path.extname(name)),
        "Cache-Control": "public, max-age=86400",
      });
    } catch {
      return c.body(null, 404);
    }
  });
