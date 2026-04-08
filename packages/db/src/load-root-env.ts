import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Load repo-root `.env` so CLI tools and `db` client see `DATABASE_URL` when run from `packages/db`. */
const here = path.dirname(fileURLToPath(import.meta.url));
config({ path: path.resolve(here, "../../.env") });
