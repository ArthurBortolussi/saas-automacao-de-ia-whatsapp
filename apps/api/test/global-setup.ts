import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { useTestDatabaseEnv } from "./test-env.js";

// Aplica as migrations (as mesmas de produção) no banco de teste antes das suítes.
export default function setup(): void {
  const url = useTestDatabaseEnv();
  const databasePackage = resolve(import.meta.dirname, "../../../packages/database");
  execFileSync(resolve(databasePackage, "node_modules/.bin/prisma"), ["migrate", "deploy"], {
    cwd: databasePackage,
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
