import { defineConfig } from "vite";

// Claw Lite 前端构建配置（Tauri dev 固定 1420 端口）
export default defineConfig({
  clearScreen: false,
  server: { port: 1420, strictPort: true },
  build: { target: "es2021", outDir: "dist", emptyOutDir: true }
});
