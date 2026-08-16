/**
 * 蘑菇鸭 - Electron 主进程入口（精简自芝绘 electron/main/index.ts）
 * 只保留图片编辑器所需：
 *   - 单窗口 + preload
 *   - AI 模型服务（抠图 ONNX HTTP 服务）子进程托管
 *   - IPC：dialog / fs / system(字体) / settings / plugins:lama / matte / image-projects(历史)
 */
import { app, BrowserWindow, ipcMain, dialog } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { initAppDb } from './db';
import { loadAISettings, saveAISettings, type AISettings } from './settings';
import { readImageFileForEditor } from './imageEditorImport';
import { matteImageForContour } from './spriteOnnxService';
import { ensureLamaCleanerRunning, openLamaCleanerInstallTerminal } from './lamaCleanerHost';
import { getSystemFonts, getSystemFontFaces } from './fontService';
import {
  listImageProjects,
  createImageProject,
  saveImageProjectDoc,
  loadImageProjectDoc,
  deleteImageProject,
  renameImageProject,
  saveImageProjectCover,
} from './imageProjectStore';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let mainWindow: BrowserWindow | null = null;
const isDev = !!process.env.VITE_DEV_SERVER_URL;

function createWindow(): void {
  // preload 构建为 CommonJS，避免 ESM 下 require 未定义
  const preloadPath = path.join(__dirname, '../preload/index.cjs');
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#141414',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
      sandbox: false,
    },
    show: false,
  });

  const reveal = () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      mainWindow.show();
    }
  };
  mainWindow.once('ready-to-show', () => {
    reveal();
    if (isDev) mainWindow?.webContents.openDevTools();
  });
  // 页面加载失败时 ready-to-show 可能不触发，避免一直无窗口
  setTimeout(reveal, 4000);

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (isDev && devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    if (isDev && !devUrl) {
      console.error('[Electron] VITE_DEV_SERVER_URL 未设置，无法加载开发页面');
    }
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    mainWindow.loadFile(htmlPath).catch((e) => {
      console.error('[Electron] loadFile 失败:', htmlPath, e);
      reveal();
    });
  }

  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error('[Electron] 页面加载失败:', { code, desc, url });
    reveal();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------- AI 模型服务（抠图 ONNX HTTP 服务）子进程托管 ----------
let aiModelServerProcess: ReturnType<typeof spawn> | null = null;
const AIMODEL_PORT = 19815;

async function startAiModelServer(): Promise<void> {
  try {
    const serverScript = path.join(__dirname, '../ai-server/index.js');
    // 打包后 __dirname 在 asar 内：不能把 asar 路径当作 spawn cwd（会 ENOTDIR），
    // 也不要用系统 node 去跑 asar 里的脚本。
    const useNodeServer = !app.isPackaged && fs.existsSync(serverScript);
    const spawnCwd = app.isPackaged ? process.resourcesPath : path.join(__dirname, '../../');
    const env: Record<string, string> = { ...process.env, AIMODEL_PORT: String(AIMODEL_PORT) };

    if (useNodeServer) {
      aiModelServerProcess = spawn('node', [serverScript], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env,
        cwd: spawnCwd,
      });
    } else if (fs.existsSync(serverScript)) {
      // 打包：用 Electron 二进制以 Node 模式跑 ai-server
      aiModelServerProcess = spawn(process.execPath, [serverScript], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        cwd: spawnCwd,
      });
    } else {
      aiModelServerProcess = spawn(process.execPath, [path.join(__dirname, 'index.js'), '--ai-model-server'], {
        stdio: ['ignore', 'inherit', 'inherit'],
        env,
        cwd: spawnCwd,
      });
    }

    aiModelServerProcess.on('error', (e) => console.error('[AI Model Service] 启动失败:', e));
    aiModelServerProcess.on('exit', (code) => {
      if (code !== 0 && code !== null) console.warn('[AI Model Service] 子进程退出:', code);
      aiModelServerProcess = null;
    });

    // 等待服务就绪（最多 10 秒）；失败不阻断主窗口
    const { pingMattingService } = await import('../ai-model-service/client.js');
    for (let i = 0; i < 50; i++) {
      if (await pingMattingService()) break;
      await new Promise((r) => setTimeout(r, 200));
    }
  } catch (e) {
    console.error('[AI Model Service] 启动异常:', e);
  }
}

// ---------- 抠图：dataUrl → 临时 PNG → matteImageForContour ----------
async function handleMatteImageFromDataUrl(
  _: unknown,
  dataUrl: string,
  options?: { mattingModel?: string; downsampleRatio?: number },
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const trimmed = dataUrl.trim();
    const m = /^data:image\/\w+;base64,(.+)$/i.exec(trimmed);
    const base64 = m ? m[1] : trimmed.replace(/^data:image\/\w+;base64,/i, '');
    const tmpDir = fs.realpathSync(os.tmpdir());
    const fname = `mogoyya_editor_matte_${Date.now()}_${Math.random().toString(36).slice(2, 9)}.png`;
    const fullPath = path.join(tmpDir, fname);
    fs.writeFileSync(fullPath, Buffer.from(base64, 'base64'));
    try {
      return await matteImageForContour(tmpDir, fname, options);
    } finally {
      try {
        fs.unlinkSync(fullPath);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ---------- IPC 注册 ----------
function registerIpc(): void {
  // ---- dialog ----
  ipcMain.handle('app:dialog:openDirectory', async () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow;
    const r = await dialog.showOpenDialog(win!, {
      properties: ['openDirectory', 'createDirectory'],
    });
    return r.canceled ? null : r.filePaths[0] ?? null;
  });

  ipcMain.handle(
    'app:dialog:openFile',
    async (_, options?: { filters?: { name: string; extensions: string[] }[] }) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const filters = options?.filters ?? [
        {
          name: '图片与文档',
          extensions: [
            'png',
            'jpg',
            'jpeg',
            'gif',
            'webp',
            'bmp',
            'tif',
            'tiff',
            'svg',
            'svgz',
            'pdf',
            'eps',
            'ps',
            'odg',
          ],
        },
      ];
      const r = await dialog.showOpenDialog(win!, { properties: ['openFile'], filters });
      return r.canceled ? null : r.filePaths[0] ?? null;
    },
  );

  ipcMain.handle(
    'app:dialog:saveFile',
    async (_, options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) => {
      const win = BrowserWindow.getFocusedWindow() || mainWindow;
      const r = await dialog.showSaveDialog(win!, {
        defaultPath: options?.defaultPath,
        filters: options?.filters ?? [{ name: '图片', extensions: ['png', 'jpg', 'webp', 'svg', 'pdf'] }],
      });
      return r.canceled ? null : r.filePath ?? null;
    },
  );

  // ---- fs ----
  ipcMain.handle('app:fs:pathExists', (_, p: string) => fs.existsSync(p));

  ipcMain.handle('app:fs:pathDirname', (_, p: string) => {
    try {
      if (!p?.trim()) return '';
      return path.dirname(path.normalize(p));
    } catch {
      return '';
    }
  });

  ipcMain.handle('app:fs:pathJoin', (_, parts: string[]) => {
    try {
      const a = (parts ?? []).map((x) => String(x ?? '').trim()).filter(Boolean);
      if (!a.length) return '';
      return path.normalize(path.join(...a));
    } catch {
      return '';
    }
  });

  ipcMain.handle('app:fs:getUnusedSaveDefaultPath', async (_, dir: string, fileName: string) => {
    const rawDir = dir?.trim();
    const rawName = fileName?.trim();
    if (!rawDir || !rawName) return null;
    try {
      const resolvedDir = path.normalize(rawDir);
      const name = path.basename(path.normalize(rawName));
      if (!name) return path.join(resolvedDir, rawName);
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let n = 0;
      for (;;) {
        const piece = n === 0 ? name : `${base} (${n})${ext}`;
        const candidatePath = path.normalize(path.join(resolvedDir, piece));
        try {
          await fs.promises.access(candidatePath, fs.constants.F_OK);
          n += 1;
        } catch {
          return candidatePath;
        }
      }
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:fs:getSafeFilePath', async (_, fullCandidatePath: string) => {
    const raw = fullCandidatePath?.trim();
    if (!raw) return '';
    try {
      const normalized = path.normalize(raw);
      const dir = path.dirname(normalized);
      const name = path.basename(normalized);
      if (!name) return normalized;
      const ext = path.extname(name);
      const base = path.basename(name, ext);
      let n = 0;
      for (;;) {
        const piece = n === 0 ? name : `${base} (${n})${ext}`;
        const candidatePath = path.normalize(path.join(dir, piece));
        try {
          await fs.promises.access(candidatePath, fs.constants.F_OK);
          n += 1;
        } catch {
          return candidatePath;
        }
      }
    } catch {
      return path.normalize(raw);
    }
  });

  ipcMain.handle('app:fs:writeBase64File', (_, fullPath: string, base64: string) => {
    try {
      if (!fullPath?.trim()) return { ok: false as const, error: '路径无效' };
      const normalized = path.normalize(fullPath.trim());
      const dir = path.dirname(normalized);
      fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(base64, 'base64');
      fs.writeFileSync(normalized, buf);
      return { ok: true as const };
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('app:fs:removePathRecursive', (_, fullPath: string) => {
    try {
      if (!fullPath?.trim()) return { ok: false as const, error: '路径无效' };
      const normalized = path.normalize(fullPath.trim());
      if (fs.existsSync(normalized)) {
        fs.rmSync(normalized, { recursive: true, force: true });
      }
      return { ok: true as const };
    } catch (e: unknown) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('app:fs:readFileAsDataUrl', (_, fullPath: string) => {
    try {
      if (!fullPath?.trim() || !fs.existsSync(fullPath)) return null;
      const normalized = path.normalize(fullPath);
      const buf = fs.readFileSync(normalized);
      const ext = path.extname(normalized).toLowerCase();
      const mime =
        ext === '.png'
          ? 'image/png'
          : ext === '.gif'
            ? 'image/gif'
            : ext === '.webp'
              ? 'image/webp'
              : ext === '.svg' || ext === '.svgz'
                ? 'image/svg+xml'
                : ext === '.bmp'
                  ? 'image/bmp'
                  : ext === '.tif' || ext === '.tiff'
                    ? 'image/tiff'
                    : 'image/jpeg';
      return `data:${mime};base64,${buf.toString('base64')}`;
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:fs:readUtf8File', (_, fullPath: string) => {
    try {
      if (!fullPath?.trim() || !fs.existsSync(fullPath)) return null;
      const normalized = path.normalize(fullPath);
      const raw = fs.readFileSync(normalized, 'utf8');
      const t = raw.replace(/^\uFEFF/, '').trim();
      return t || null;
    } catch {
      return null;
    }
  });

  ipcMain.handle('app:fs:readImageFileForEditor', async (_, fullPath: string) =>
    readImageFileForEditor(fullPath),
  );

  // ---- system（字体）----
  ipcMain.handle('app:system:getFonts', () => getSystemFonts());
  ipcMain.handle('app:system:getFontFaces', () => getSystemFontFaces());

  // ---- settings ----
  ipcMain.handle('app:settings:get', () => loadAISettings());
  ipcMain.handle('app:settings:save', async (_, data: AISettings) => saveAISettings(data));

  // ---- plugins: LaMa 擦除 ----
  ipcMain.handle('app:plugins:lama:ensure', async () => ensureLamaCleanerRunning());
  ipcMain.handle('app:plugins:lama:openInstallTerminal', async () => {
    if (process.platform !== 'darwin') {
      return {
        ok: false as const,
        error:
          '自动打开安装终端目前仅在 macOS 上可用。请在应用数据目录下自行创建 venv：Python 3.10 推荐；pip install torch torchvision torchaudio && pip install iopaint；Apple Silicon 可用 python -m iopaint start --device mps --port 9380。',
      };
    }
    try {
      openLamaCleanerInstallTerminal();
      return { ok: true as const };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ---- 抠图 ----
  ipcMain.handle('app:project:matteImageFromDataUrl', handleMatteImageFromDataUrl);
  ipcMain.handle('app:editor:matteImageFromDataUrl', handleMatteImageFromDataUrl);

  // ---- 历史项目（图片编辑文档持久化）----
  ipcMain.handle('app:image-projects:list', () => listImageProjects());
  ipcMain.handle(
    'app:image-projects:create',
    (_, payload: { name: string; docWidth: number; docHeight: number; docBackgroundColor: string }) =>
      createImageProject(payload),
  );
  ipcMain.handle(
    'app:image-projects:saveDoc',
    async (
      _,
      payload: {
        id: string;
        name: string;
        docWidth: number;
        docHeight: number;
        docBackgroundColor: string;
        objects: unknown[];
      },
    ) => saveImageProjectDoc(payload),
  );
  ipcMain.handle('app:image-projects:loadDoc', async (_, id: string) => loadImageProjectDoc(id));
  ipcMain.handle('app:image-projects:delete', async (_, id: string) => deleteImageProject(id));
  ipcMain.handle('app:image-projects:rename', async (_, id: string, name: string) =>
    renameImageProject(id, name),
  );
  ipcMain.handle('app:image-projects:saveCover', async (_, id: string, base64Png: string) =>
    saveImageProjectCover(id, base64Png),
  );
}

// ---------- 启动 ----------
// AI 模型服务独立进程模式：仅启动 HTTP API，不启动主窗口（回退路径）
const isAiModelServer = process.argv.includes('--ai-model-server');
if (isAiModelServer) {
  const { startServer } = await import('../ai-model-service/server.js');
  await startServer();
  // 服务保持运行，不退出
} else {
  app.whenReady().then(async () => {
    initAppDb();
    registerIpc();
    // 先开窗口：AI 服务启动失败（如 asar cwd）不能挡住 UI
    createWindow();
    void startAiModelServer();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (aiModelServerProcess) {
      try {
        aiModelServerProcess.kill();
      } catch {
        /* ignore */
      }
    }
    if (process.platform !== 'darwin') app.quit();
  });
}
