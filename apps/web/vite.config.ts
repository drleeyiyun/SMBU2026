import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_TARGET = process.env.VITE_DEV_API_PROXY ?? "http://localhost:3000";

const API_PREFIXES = [
  "/auth",
  "/me",
  "/health",
  "/schedule",
  "/timeline",
  "/plans",
  "/archive",
  "/orgs",
  "/directory",
  "/tasks",
  "/notifications",
  "/league",
  "/academic",
  "/uploads",
];

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: Object.fromEntries(
      API_PREFIXES.map((prefix) => [
        prefix,
        { target: API_TARGET, changeOrigin: true },
      ]),
    ),
  },
});
