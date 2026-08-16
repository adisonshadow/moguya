/**
 * 蘑菇鸭 - 图片编辑历史项目持久化（新增功能）
 *
 * 磁盘布局（userData = ~/Library/Application Support/蘑菇鸭）：
 *   蘑菇鸭/image-projects.db              SQLite，项目索引
 *   蘑菇鸭/projects/<id>/document.json    文档骨架（大图 src 存 "asset:<uuid>"）
 *   蘑菇鸭/projects/<id>/cover.png        列表卡片缩略图
 *   蘑菇鸭/projects/<id>/assets/<uuid>.<ext>  大图栅格抽离到磁盘
 *
 * 设计参考芝绘的 db.ts（app.db 项目索引）+ projectDb.ts（磁盘优先、DB 索引、base64 over IPC）。
 * 大图抽离规则：保存时 type==='image' 且 src 是 data: URL 且 > THRESHOLD 字节 → 写 assets/，
 *   src 替换为 "asset:<uuid>"；加载时反向还原成 data URL。
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

const ASSET_INLINE_THRESHOLD = 64 * 1024; // > 64KB 的 data URL 抽离到磁盘
let db: Database.Database | null = null;

function getDataDir(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, '蘑菇鸭');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function getDbPath(): string {
  return path.join(getDataDir(), 'image-projects.db');
}

function getProjectsRoot(): string {
  const root = path.join(getDataDir(), 'projects');
  if (!fs.existsSync(root)) fs.mkdirSync(root, { recursive: true });
  return root;
}

function getDb(): Database.Database {
  if (db) return db;
  db = new Database(getDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS image_projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      project_dir TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      doc_width INTEGER NOT NULL DEFAULT 1024,
      doc_height INTEGER NOT NULL DEFAULT 768,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  return db;
}

export interface ImageProjectRow {
  id: string;
  name: string;
  project_dir: string;
  cover_path: string | null;
  doc_width: number;
  doc_height: number;
  created_at: string;
  updated_at: string;
}

/** data URL 的 MIME → 扩展名（仅栅格） */
function extForDataUrl(dataUrl: string): string {
  const m = /^data:([\w/.+-]+);base64,/i.exec(dataUrl);
  const mime = m?.[1] ?? '';
  if (mime.includes('png')) return '.png';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  if (mime.includes('webp')) return '.webp';
  if (mime.includes('gif')) return '.gif';
  if (mime.includes('bmp')) return '.bmp';
  if (mime.includes('tiff')) return '.tif';
  return '.png';
}

/** 估算 data URL 的原始字节数（base64 长度 * 3/4） */
function estimateDataUrlBytes(dataUrl: string): number {
  const m = /^data:[\w/.+-]+;base64,(.+)$/i.exec(dataUrl);
  const b64 = m?.[1] ?? '';
  const pad = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - pad;
}

export function listImageProjects(): ImageProjectRow[] {
  const stmt = getDb().prepare('SELECT * FROM image_projects ORDER BY updated_at DESC');
  return stmt.all() as ImageProjectRow[];
}

export function createImageProject(payload: {
  name: string;
  docWidth: number;
  docHeight: number;
  docBackgroundColor: string;
}): { ok: boolean; id?: string; error?: string } {
  const id = `img_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const now = new Date().toISOString();
  const projectDir = path.join(getProjectsRoot(), id);
  try {
    fs.mkdirSync(projectDir, { recursive: true });
    fs.mkdirSync(path.join(projectDir, 'assets'), { recursive: true });
    const doc = {
      docWidth: payload.docWidth,
      docHeight: payload.docHeight,
      docBackgroundColor: payload.docBackgroundColor,
      objects: [],
    };
    fs.writeFileSync(path.join(projectDir, 'document.json'), JSON.stringify(doc, null, 2), 'utf-8');
    getDb()
      .prepare(
        `INSERT INTO image_projects (id, name, project_dir, cover_path, doc_width, doc_height, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        payload.name,
        projectDir,
        null,
        payload.docWidth,
        payload.docHeight,
        now,
        now,
      );
    return { ok: true, id };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * 保存文档：抽出大图到 assets/，src 替换为 asset:<uuid>，写 document.json，刷新 updated_at。
 * 保留已存在的 asset 引用（多次保存不会重复抽离同一张图——靠 src 已是 asset:<uuid> 判断）。
 */
export function saveImageProjectDoc(payload: {
  id: string;
  name: string;
  docWidth: number;
  docHeight: number;
  docBackgroundColor: string;
  objects: unknown[];
}): { ok: boolean; error?: string } {
  const row = getDb().prepare('SELECT project_dir FROM image_projects WHERE id = ?').get(payload.id) as
    | { project_dir: string }
    | undefined;
  if (!row) return { ok: false, error: '项目不存在' };
  const projectDir = row.project_dir;
  const assetsDir = path.join(projectDir, 'assets');
  try {
    if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

    const objects = payload.objects as Array<Record<string, unknown>>;
    for (const obj of objects) {
      if (obj.type !== 'image') continue;
      const src = typeof obj.src === 'string' ? obj.src : '';
      if (src.startsWith('asset:')) continue; // 已是磁盘引用，保留
      if (!src.startsWith('data:')) continue;
      if (estimateDataUrlBytes(src) <= ASSET_INLINE_THRESHOLD) continue; // 小图内联
      const uuid = randomUUID();
      const ext = extForDataUrl(src);
      const fileName = `${uuid}${ext}`;
      const m = /^data:[\w/.+-]+;base64,(.+)$/i.exec(src);
      if (!m) continue;
      fs.writeFileSync(path.join(assetsDir, fileName), Buffer.from(m[1], 'base64'));
      obj.src = `asset:${uuid}`;
    }

    const doc = {
      docWidth: payload.docWidth,
      docHeight: payload.docHeight,
      docBackgroundColor: payload.docBackgroundColor,
      objects,
    };
    fs.writeFileSync(path.join(projectDir, 'document.json'), JSON.stringify(doc, null, 2), 'utf-8');

    const now = new Date().toISOString();
    getDb()
      .prepare(
        `UPDATE image_projects SET name = ?, doc_width = ?, doc_height = ?, updated_at = ? WHERE id = ?`,
      )
      .run(payload.name, payload.docWidth, payload.docHeight, now, payload.id);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 加载文档：把 asset:<uuid> 还原成 data URL 注回 src */
export async function loadImageProjectDoc(
  id: string,
): Promise<
  | {
      ok: true;
      name: string;
      docWidth: number;
      docHeight: number;
      docBackgroundColor: string;
      objects: unknown[];
    }
  | { ok: false; error: string }
> {
  const row = getDb()
    .prepare('SELECT project_dir, name FROM image_projects WHERE id = ?')
    .get(id) as { project_dir: string; name: string } | undefined;
  if (!row) return { ok: false, error: '项目不存在' };
  const docPath = path.join(row.project_dir, 'document.json');
  if (!fs.existsSync(docPath)) return { ok: false, error: '文档不存在' };
  try {
    const raw = fs.readFileSync(docPath, 'utf-8');
    const doc = JSON.parse(raw) as {
      docWidth: number;
      docHeight: number;
      docBackgroundColor: string;
      objects: Array<Record<string, unknown>>;
    };
    const assetsDir = path.join(row.project_dir, 'assets');
    for (const obj of doc.objects) {
      if (obj.type !== 'image') continue;
      const src = typeof obj.src === 'string' ? obj.src : '';
      const m = /^asset:(.+)$/i.exec(src);
      if (!m) continue;
      // 资源可能存为 <uuid> 或 <uuid>.<ext>；优先精确匹配，其次按 uuid 前缀
      const uuid = m[1];
      let assetPath = '';
      const direct = path.join(assetsDir, uuid);
      if (fs.existsSync(direct)) {
        assetPath = direct;
      } else {
        const candidates = fs.existsSync(assetsDir)
          ? fs.readdirSync(assetsDir).filter((f) => f.startsWith(uuid))
          : [];
        if (candidates.length > 0) assetPath = path.join(assetsDir, candidates[0]!);
      }
      if (assetPath) {
        const buf = fs.readFileSync(assetPath);
        const ext = path.extname(assetPath).toLowerCase();
        const mime =
          ext === '.png'
            ? 'image/png'
            : ext === '.jpg' || ext === '.jpeg'
              ? 'image/jpeg'
              : ext === '.webp'
                ? 'image/webp'
                : ext === '.gif'
                  ? 'image/gif'
                  : ext === '.bmp'
                    ? 'image/bmp'
                    : ext === '.tif' || ext === '.tiff'
                      ? 'image/tiff'
                      : 'image/png';
        obj.src = `data:${mime};base64,${buf.toString('base64')}`;
      }
    }
    return {
      ok: true,
      name: row.name,
      docWidth: doc.docWidth,
      docHeight: doc.docHeight,
      docBackgroundColor: doc.docBackgroundColor,
      objects: doc.objects,
    };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function deleteImageProject(id: string): { ok: boolean; error?: string } {
  try {
    const row = getDb()
      .prepare('SELECT project_dir FROM image_projects WHERE id = ?')
      .get(id) as { project_dir: string } | undefined;
    if (!row) return { ok: false, error: '项目不存在' };
    getDb().prepare('DELETE FROM image_projects WHERE id = ?').run(id);
    if (fs.existsSync(row.project_dir)) {
      fs.rmSync(row.project_dir, { recursive: true, force: true });
    }
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function renameImageProject(id: string, name: string): { ok: boolean; error?: string } {
  try {
    const now = new Date().toISOString();
    const r = getDb()
      .prepare('UPDATE image_projects SET name = ?, updated_at = ? WHERE id = ?')
      .run(name, now, id);
    if (r.changes === 0) return { ok: false, error: '项目不存在' };
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export function saveImageProjectCover(id: string, base64Png: string): { ok: boolean; error?: string } {
  try {
    const row = getDb()
      .prepare('SELECT project_dir FROM image_projects WHERE id = ?')
      .get(id) as { project_dir: string } | undefined;
    if (!row) return { ok: false, error: '项目不存在' };
    const coverPath = path.join(row.project_dir, 'cover.png');
    const m = /^data:image\/png;base64,(.+)$/i.exec(base64Png);
    const b64 = m ? m[1] : base64Png.replace(/^data:image\/\w+;base64,/i, '');
    fs.writeFileSync(coverPath, Buffer.from(b64, 'base64'));
    getDb()
      .prepare('UPDATE image_projects SET cover_path = ? WHERE id = ?')
      .run(`cover.png`, id);
    return { ok: true };
  } catch (e: unknown) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
