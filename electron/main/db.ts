/**
 * 应用级 SQLite：项目列表等（见技术文档 3.1、开发计划 2.1）
 * 存储路径：用户数据目录 / yiman / app.db
 */
import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';

let db: Database.Database | null = null;

function getDbPath(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'yiman');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'app.db');
}

export function initAppDb(): void {
  if (db) return;
  const dbPath = getDbPath();
  db = new Database(dbPath);

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      landscape INTEGER NOT NULL DEFAULT 1,
      project_dir TEXT NOT NULL UNIQUE,
      cover_path TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
}

function getDb(): Database.Database {
  if (!db) initAppDb();
  return db!;
}

export interface ProjectRow {
  id: string;
  name: string;
  landscape: number;
  project_dir: string;
  cover_path: string | null;
  created_at: string;
  updated_at: string;
}

export function getProjects(): ProjectRow[] {
  const stmt = getDb().prepare('SELECT * FROM projects ORDER BY updated_at DESC');
  return stmt.all() as ProjectRow[];
}

export function createProject(payload: {
  id: string;
  name: string;
  landscape: number;
  project_dir: string;
  cover_path?: string | null;
}): { ok: boolean; error?: string } {
  const now = new Date().toISOString();
  try {
    getDb()
      .prepare(
        `INSERT INTO projects (id, name, landscape, project_dir, cover_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        payload.id,
        payload.name,
        payload.landscape ?? 1,
        payload.project_dir,
        payload.cover_path ?? null,
        now,
        now
      );
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

/** 导入已有项目：根据 project_dir 下的 project.db 解析 meta 并加入列表（见功能文档 2） */
export function importProject(
  projectDir: string,
  meta: { name: string; landscape: number; cover_path: string | null; created_at: string; updated_at: string }
): { ok: boolean; id?: string; error?: string } {
  const normalized = path.normalize(projectDir);
  try {
    const existing = getDb().prepare('SELECT id FROM projects WHERE project_dir = ?').get(normalized) as { id: string } | undefined;
    if (existing) return { ok: false, error: '该项目目录已在列表中' };
    const id = `p_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    getDb()
      .prepare(
        `INSERT INTO projects (id, name, landscape, project_dir, cover_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        id,
        meta.name,
        meta.landscape ?? 1,
        normalized,
        meta.cover_path ?? null,
        meta.created_at,
        meta.updated_at
      );
    return { ok: true, id };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}

export function deleteProject(id: string, deleteOnDisk: boolean): { ok: boolean; error?: string } {
  try {
    const row = getDb().prepare('SELECT project_dir FROM projects WHERE id = ?').get(id) as { project_dir: string } | undefined;
    if (!row) return { ok: false, error: '项目不存在' };
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);
    if (deleteOnDisk && fs.existsSync(row.project_dir)) {
      fs.rmSync(row.project_dir, { recursive: true });
    }
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
