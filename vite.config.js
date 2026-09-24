import { defineConfig } from "vite";

// Claw Lite 渲染进程构建配置
// base 必须为相对路径：Electron 打包后通过 file:// 加载 dist/index.html
export default defineConfig({
  base: "./",
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  build: { target: "es2022", outDir: "dist", emptyOutDir: true }
});
