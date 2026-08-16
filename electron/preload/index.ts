/**
 * 蘑菇鸭 - preload 桥（精简自芝绘 electron/preload/index.ts）
 * 只暴露图片编辑器实际用到的命名空间 + 新增 imageProjects（历史）。
 * 渲染进程统一通过 window.yiman.* 访问。
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron';

const api = {
  dialog: {
    openDirectory: () => ipcRenderer.invoke('app:dialog:openDirectory'),
    openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('app:dialog:openFile', options),
    saveFile: (options?: { defaultPath?: string; filters?: { name: string; extensions: string[] }[] }) =>
      ipcRenderer.invoke('app:dialog:saveFile', options),
  },
  fs: {
    pathExists: (p: string) => ipcRenderer.invoke('app:fs:pathExists', p),
    pathDirname: (p: string) => ipcRenderer.invoke('app:fs:pathDirname', p) as Promise<string>,
    pathJoin: (...parts: string[]) => ipcRenderer.invoke('app:fs:pathJoin', parts) as Promise<string>,
    getUnusedSaveDefaultPath: (dir: string, fileName: string) =>
      ipcRenderer.invoke('app:fs:getUnusedSaveDefaultPath', dir, fileName) as Promise<string | null>,
    getSafeFilePath: (fullCandidatePath: string) =>
      ipcRenderer.invoke('app:fs:getSafeFilePath', fullCandidatePath) as Promise<string>,
    writeBase64File: (fullPath: string, base64: string) =>
      ipcRenderer.invoke('app:fs:writeBase64File', fullPath, base64) as Promise<{ ok: boolean; error?: string }>,
    removePathRecursive: (fullPath: string) =>
      ipcRenderer.invoke('app:fs:removePathRecursive', fullPath) as Promise<{ ok: boolean; error?: string }>,
    readFileAsDataUrl: (fullPath: string) =>
      ipcRenderer.invoke('app:fs:readFileAsDataUrl', fullPath) as Promise<string | null>,
    readUtf8File: (fullPath: string) =>
      ipcRenderer.invoke('app:fs:readUtf8File', fullPath) as Promise<string | null>,
    readImageFileForEditor: (fullPath: string) =>
      ipcRenderer.invoke('app:fs:readImageFileForEditor', fullPath) as Promise<
        | { ok: true; kind: 'raster'; dataUrl: string }
        | { ok: true; kind: 'svg'; svgText: string }
        | { ok: false; error: string }
      >,
    /** 拖入本地文件时取绝对路径（Electron） */
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
  },
  settings: {
    get: () => ipcRenderer.invoke('app:settings:get'),
    save: (data: unknown) => ipcRenderer.invoke('app:settings:save', data),
  },
  system: {
    getFonts: () => ipcRenderer.invoke('app:system:getFonts') as Promise<string[]>,
    getFontFaces: () =>
      ipcRenderer.invoke('app:system:getFontFaces') as Promise<
        Array<{
          familyName: string;
          postScriptName: string;
          weight: string;
          style: string;
          styleLabel?: string;
          englishFamilyGuess?: string;
        }>
      >,
  },
  plugins: {
    lamaCleanerEnsure: () =>
      ipcRenderer.invoke('app:plugins:lama:ensure') as Promise<
        | { ok: true; baseUrl: string }
        | { ok: false; needInstall: true }
        | { ok: false; needInstall?: false; error: string }
      >,
    lamaCleanerOpenInstallTerminal: () =>
      ipcRenderer.invoke('app:plugins:lama:openInstallTerminal') as Promise<{ ok: boolean; error?: string }>,
  },
  project: {
    matteImageFromDataUrl: (
      dataUrl: string,
      options?: { mattingModel?: string; downsampleRatio?: number },
    ) =>
      ipcRenderer.invoke('app:project:matteImageFromDataUrl', dataUrl, options) as Promise<{
        ok: boolean;
        dataUrl?: string;
        error?: string;
      }>,
  },
  /** 历史图片项目（新增） */
  imageProjects: {
    list: () => ipcRenderer.invoke('app:image-projects:list'),
    create: (payload: { name: string; docWidth: number; docHeight: number; docBackgroundColor: string }) =>
      ipcRenderer.invoke('app:image-projects:create', payload),
    saveDoc: (payload: {
      id: string;
      name: string;
      docWidth: number;
      docHeight: number;
      docBackgroundColor: string;
      objects: unknown[];
    }) => ipcRenderer.invoke('app:image-projects:saveDoc', payload),
    loadDoc: (id: string) => ipcRenderer.invoke('app:image-projects:loadDoc', id),
    delete: (id: string) => ipcRenderer.invoke('app:image-projects:delete', id),
    rename: (id: string, name: string) => ipcRenderer.invoke('app:image-projects:rename', id, name),
    saveCover: (id: string, base64Png: string) =>
      ipcRenderer.invoke('app:image-projects:saveCover', id, base64Png),
  },
};

contextBridge.exposeInMainWorld('yiman', api);

export type YimanApi = typeof api;
