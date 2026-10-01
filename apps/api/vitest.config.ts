import swc from "unplugin-swc";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // O transformador padrão do Vitest não emite decorator metadata, de que a DI do Nest depende.
  plugins: [swc.vite({ module: { type: "es6" } })],
  test: {
    include: ["test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    setupFiles: ["test/setup-env.ts"],
    // Todas as suítes compartilham o mesmo banco de teste: execução sequencial.
    fileParallelism: false,
    pool: "forks",
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
