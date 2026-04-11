import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "tsup";

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/index.ts"],
  format: "esm",
  platform: "node",
  clean: true,
  dts: true,
  // Workspace `db` exports `.ts` sources; bundle so `node dist/index.js` does not
  // need Node to load TypeScript from `node_modules/db`.
  noExternal: ["db", "academic-catalog"],
  alias: {
    db: path.join(dir, "../../packages/db/src/client.ts"),
    "db/schema": path.join(dir, "../../packages/db/src/schema.ts"),
    "academic-catalog": path.join(dir, "../../packages/academic-catalog/src/index.ts"),
  },
});
