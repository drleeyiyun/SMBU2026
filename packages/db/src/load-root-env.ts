import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load repo-root `.env` (this file lives in `packages/db/src/`, so three levels up). */
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../../.env") });
