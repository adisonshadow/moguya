/// <reference types="vite/client" />

declare global {
  interface Window {
    yiman?: {
      dialog: {
        openDirectory: () => Promise<string | null>;
        openFile: (options?: { filters?: { name: string; extensions: string[] }[] }) => Promise<string | undefined>;
        saveFile: (options?: {
          defaultPath?: string;
          filters?: { name: string; extensions: string[] }[];
        }) => Promise<string | null>;
      };
      fs: {
        pathExists: (p: string) => Promise<boolean>;
        pathDirname: (p: string) => Promise<string>;
        pathJoin: (...parts: string[]) => Promise<string>;
        getUnusedSaveDefaultPath: (dir: string, fileName: string) => Promise<string | null>;
        getSafeFilePath: (fullCandidatePath: string) => Promise<string>;
        writeBase64File: (fullPath: string, base64: string) => Promise<{ ok: boolean; error?: string }>;
        removePathRecursive: (fullPath: string) => Promise<{ ok: boolean; error?: string }>;
        readFileAsDataUrl: (fullPath: string) => Promise<string | null>;
        readUtf8File: (fullPath: string) => Promise<string | null>;
        readImageFileForEditor: (
          fullPath: string,
        ) => Promise<
          | { ok: true; kind: 'raster'; dataUrl: string }
          | { ok: true; kind: 'svg'; svgText: string }
          | { ok: false; error: string }
        >;
        getPathForFile: (file: File) => string;
      };
      settings: {
        get: () => Promise<import('@/types/settings').AISettings>;
        save: (data: import('@/types/settings').AISettings) => Promise<{ ok: boolean; error?: string }>;
      };
      system: {
        getFonts: () => Promise<string[]>;
        getFontFaces: () => Promise<
          Array<{
            familyName: string;
            postScriptName: string;
            weight: string;
            style: string;
            styleLabel?: string;
            englishFamilyGuess?: string;
          }>
        >;
      };
      plugins?: {
        lamaCleanerEnsure: () => Promise<
          | { ok: true; baseUrl: string }
          | { ok: false; needInstall: true }
          | { ok: false; needInstall?: false; error: string }
        >;
        lamaCleanerOpenInstallTerminal: () => Promise<{ ok: boolean; error?: string }>;
      };
      project: {
        matteImageFromDataUrl: (
          dataUrl: string,
          options?: { mattingModel?: string; downsampleRatio?: number },
        ) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
      };
      /** 历史图片项目 */
      imageProjects: {
        list: () => Promise<
          Array<{
            id: string;
            name: string;
            project_dir: string;
            cover_path: string | null;
            doc_width: number;
            doc_height: number;
            created_at: string;
            updated_at: string;
          }>
        >;
        create: (payload: {
          name: string;
          docWidth: number;
          docHeight: number;
          docBackgroundColor: string;
        }) => Promise<{ ok: boolean; id?: string; error?: string }>;
        saveDoc: (payload: {
          id: string;
          name: string;
          docWidth: number;
          docHeight: number;
          docBackgroundColor: string;
          objects: unknown[];
        }) => Promise<{ ok: boolean; error?: string }>;
        loadDoc: (id: string) => Promise<
          | {
              ok: true;
              name: string;
              docWidth: number;
              docHeight: number;
              docBackgroundColor: string;
              objects: unknown[];
            }
          | { ok: false; error: string }
        >;
        delete: (id: string) => Promise<{ ok: boolean; error?: string }>;
        rename: (id: string, name: string) => Promise<{ ok: boolean; error?: string }>;
        saveCover: (id: string, base64Png: string) => Promise<{ ok: boolean; error?: string }>;
      };
    };
  }
}

export {};
