// src/utils/resolve.ts
// 项目路径解析工具
import * as path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * 返回项目根目录的绝对路径。
 * 兼容 Node.js（__dirname）和 Bun（import.meta.url）。
 * 假设调用此函数的位置在 src/utils/ 下。
 */
export function getRepoRoot(): string {
  if (typeof __dirname !== "undefined") {
    return path.join(__dirname, "..", "..");
  }
  // Bun runtime
  const currentFile = fileURLToPath(import.meta.url);
  return path.join(path.dirname(currentFile), "..", "..");
}
