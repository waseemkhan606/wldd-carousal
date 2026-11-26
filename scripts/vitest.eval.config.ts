import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ test: { include: ["scripts/**/*.eval.ts"], testTimeout: 280000, hookTimeout: 120000 }, resolve: { alias: { "@": path.resolve(__dirname, "..") } } });
