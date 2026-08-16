/**
 * AI 模型服务 - 纯 Node 入口
 * 用 node 运行，不启动 Electron，无 Dock 图标
 * 用法: node --import tsx electron/ai-model-service/standalone.ts
 * 或: npx tsx electron/ai-model-service/standalone.ts
 */
import { startServer } from './server.js';
await startServer();
