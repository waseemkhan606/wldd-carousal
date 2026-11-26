/** @type {import('next').NextConfig} */
import path from "node:path";
export default {
  outputFileTracingRoot: path.resolve("."),
  serverExternalPackages: ["better-sqlite3", "playwright"],
  poweredByHeader: false,
};
