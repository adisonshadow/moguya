/**
 * 系统字体：
 * - macOS：system_profiler SPFontsDataType -json（完整 typefaces + 中文 family/style，解决 font-list 每族仅一行的问题）
 * - 其它平台：font-list getFonts2，失败则合成
 * 缓存：userData/font-faces-cache.json（减轻 profiler 首次耗时）
 */
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { platform } from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { app } from 'electron';

const execAsync = promisify(exec);

export type SystemFontFaceRow = {
  familyName: string;
  postScriptName: string;
  weight: string;
  style: string;
  /** 系统提供的样式文案（多为中文：细体、中等） */
  styleLabel?: string;
  /** 常见英文族名，用于旧文档 PingFang SC / Heiti SC 等与数据对齐 */
  englishFamilyGuess?: string;
};

let cachedFamilies: string[] | null = null;
let cachedFaces: SystemFontFaceRow[] | null = null;

const CACHE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function cacheFilePath(): string {
  try {
    return path.join(app.getPath('userData'), 'font-faces-cache.json');
  } catch {
    return '';
  }
}

const FONT_FACE_DISK_CACHE_VERSION = 2;

function readDiskCache(): SystemFontFaceRow[] | null {
  const p = cacheFilePath();
  if (!p) return null;
  try {
    const st = fs.statSync(p);
    if (Date.now() - st.mtimeMs > CACHE_MAX_AGE_MS) return null;
    const raw = JSON.parse(fs.readFileSync(p, 'utf8')) as unknown;
    /** 旧版为 JSON 数组；v2 含斜体样式映射，需重建缓存 */
    if (Array.isArray(raw)) return null;
    if (raw && typeof raw === 'object' && 'rows' in raw && Array.isArray((raw as { rows: unknown }).rows)) {
      const boxed = raw as { v?: number; rows: SystemFontFaceRow[] };
      if (boxed.v !== FONT_FACE_DISK_CACHE_VERSION) return null;
      return boxed.rows.length > 200 ? boxed.rows : null;
    }
    return null;
  } catch {
    return null;
  }
}

function writeDiskCache(rows: SystemFontFaceRow[]): void {
  const p = cacheFilePath();
  if (!p) return;
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ v: FONT_FACE_DISK_CACHE_VERSION, rows }));
  } catch {
    /* 忽略 */
  }
}

/** PostScript 名 → 常见英文 CSS 族名（仅用于与旧数据对齐） */
export function guessEnglishFamilyFromPostScript(ps: string): string | undefined {
  const u = ps.trim();
  if (/^PingFangSC-/i.test(u)) return 'PingFang SC';
  if (/^PingFangHK-/i.test(u)) return 'PingFang HK';
  if (/^PingFangTC-/i.test(u)) return 'PingFang TC';
  if (/^PingFangMO-/i.test(u)) return 'PingFang MO';
  if (/^PingFangUI-/i.test(u)) return 'PingFang SC';
  if (/^STHeitiSC-/i.test(u)) return 'Heiti SC';
  if (/^STHeitiTC-/i.test(u)) return 'Heiti TC';
  if (/^HiraginoSansGB-/i.test(u)) return 'Hiragino Sans GB';
  return undefined;
}

const CN_STYLE_TO_WEIGHT: Record<string, string> = {
  极细体: 'ultralight',
  纤细体: 'thin',
  ultralight: 'ultralight',
  extralight: 'ultralight',
  thin: 'thin',
  细体: 'light',
  light: 'light',
  常规体: 'regular',
  标准: 'regular',
  regular: 'regular',
  roman: 'regular',
  中等: 'medium',
  中黑体: 'medium',
  medium: 'medium',
  中粗体: 'semibold',
  semibold: 'semibold',
  粗体: 'bold',
  bold: 'bold',
  黑体: 'black',
  black: 'black',
  heavy: 'heavy',
  /** 含「斜」的样式：字重仍按字面推断，style 在 finish 中置 italic */
  斜体: 'regular',
  细斜体: 'light',
  中粗斜体: 'semibold',
  粗斜体: 'bold',
};

function inferWeightStyleFromTypeface(postScriptName: string, appleStyle: string): { weight: string; style: string } {
  const ps = postScriptName;
  const low = ps.toLowerCase();
  let style: string = 'normal';
  if (/italic|it$/i.test(ps) || /oblique/i.test(ps)) style = 'italic';

  const finish = (weight: string, styleFromPs: string = style): { weight: string; style: string } => {
    let st = styleFromPs;
    const a = (appleStyle && String(appleStyle).trim()) || '';
    /** macOS style 常为「斜体」「粗斜体」，此前未映射会导致前端无法切换斜体 */
    if (a && /斜|oblique|\bitalic\b/i.test(a)) st = 'italic';
    return { weight, style: st };
  };

  // Hiragino W 系列
  const wMatch = /-w([0-9]+)$/i.exec(ps);
  if (wMatch) {
    const n = Number(wMatch[1]);
    let weight = 'regular';
    if (n <= 2) weight = 'ultralight';
    else if (n <= 3) weight = 'light';
    else if (n <= 4) weight = 'regular';
    else if (n <= 5) weight = 'medium';
    else if (n <= 6) weight = 'semibold';
    else weight = 'bold';
    return finish(weight);
  }

  if (/ultralight|extralight|hairline/i.test(low)) return finish('ultralight');
  if (/\bthin\b|^.*-th$/i.test(low)) return finish('thin');
  if (/light/i.test(low) && !/highlight/i.test(low)) return finish('light');
  if (/medium/i.test(low) && !/ultramedium/i.test(low)) return finish('medium');
  if (/semibold|demibold/i.test(low)) return finish('semibold');
  if (/\bbold\b|[-_]bd$/i.test(low) && !/semibold/i.test(low)) return finish('bold');
  if (/heavy|black/i.test(low)) return finish('black');

  if (appleStyle) {
    const k = appleStyle.trim();
    const mapped = CN_STYLE_TO_WEIGHT[k] ?? CN_STYLE_TO_WEIGHT[k.toLowerCase()];
    if (mapped) return finish(mapped);
    const en = k.toLowerCase();
    if (/medium|semibold|bold|light|regular|black|heavy|thin/i.test(en)) {
      const m2 =
        CN_STYLE_TO_WEIGHT[en] ||
        (en.includes('bold') && !en.includes('semi') ? 'bold' : null) ||
        (en.includes('semi') ? 'semibold' : null) ||
        (en.includes('light') ? 'light' : null) ||
        (en.includes('medium') ? 'medium' : null) ||
        (en.includes('regular') || en.includes('normal') ? 'regular' : null);
      if (m2) return finish(m2);
    }
  }

  if (/regular|roman|normal|book|std|standard/i.test(low)) return finish('regular');
  return finish('regular');
}

async function parseDarwinFontsFromSystemProfiler(): Promise<SystemFontFaceRow[]> {
  const { stdout } = await execAsync('system_profiler SPFontsDataType -json', {
    maxBuffer: 80 * 1024 * 1024,
    timeout: 180000,
  });
  const j = JSON.parse(stdout) as { SPFontsDataType?: unknown[] };
  const fonts = j?.SPFontsDataType;
  if (!Array.isArray(fonts)) return [];

  const rows: SystemFontFaceRow[] = [];
  const seenPs = new Set<string>();

  for (const file of fonts as Array<{ typefaces?: unknown[] }>) {
    const typefaces = file.typefaces;
    if (!Array.isArray(typefaces)) continue;
    for (const t of typefaces as Array<Record<string, string>>) {
      const ps = t?._name?.trim();
      if (!ps || typeof ps !== 'string') continue;
      if (seenPs.has(ps)) continue;
      seenPs.add(ps);

      const family = (t.family && String(t.family).trim()) || (t.fullname && String(t.fullname).trim());
      if (!family) continue;

      const appleStyle = (t.style && String(t.style).trim()) || '';
      const { weight, style } = inferWeightStyleFromTypeface(ps, appleStyle);
      const englishFamilyGuess = guessEnglishFamilyFromPostScript(ps);

      rows.push({
        familyName: family,
        postScriptName: ps,
        weight,
        style,
        styleLabel: appleStyle || undefined,
        englishFamilyGuess,
      });
    }
  }
  return rows;
}

async function loadDarwinFaces(): Promise<SystemFontFaceRow[]> {
  const disk = readDiskCache();
  if (disk) return disk;
  try {
    const rows = await parseDarwinFontsFromSystemProfiler();
    if (rows.length > 200) writeDiskCache(rows);
    return rows;
  } catch (e) {
    console.error('[fontService] parseDarwinFontsFromSystemProfiler failed:', e);
    return [];
  }
}

/** macOS 回退：仅族名 */
async function getFontsBySystemProfiler(): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `system_profiler SPFontsDataType | grep "Family:" | awk -F: '{print $2}' | sort | uniq`,
      { maxBuffer: 1024 * 1024 * 10, timeout: 30000 }
    );
    return stdout
      .split('\n')
      .map((f: string) => f.trim())
      .filter((f: string) => !!f);
  } catch (e) {
    console.error('[fontService] getFontsBySystemProfiler failed:', e);
    return [];
  }
}

function syntheticFacesFromFamilies(families: string[]): SystemFontFaceRow[] {
  return families.map((familyName) => ({
    familyName,
    postScriptName: familyName,
    weight: 'regular',
    style: 'normal',
  }));
}

async function loadDetailedFacesNonDarwin(): Promise<SystemFontFaceRow[]> {
  try {
    const { getFonts2 } = await import('font-list');
    const raw = await getFonts2({ disableQuoting: true });
    if (!Array.isArray(raw) || raw.length === 0) return [];
    return raw
      .filter((f): f is NonNullable<typeof f> => !!f?.familyName && typeof f.familyName === 'string')
      .map((f) => ({
        familyName: f.familyName,
        postScriptName: (f.postScriptName && String(f.postScriptName)) || f.familyName,
        weight: (f.weight && String(f.weight)) || 'regular',
        style: (f.style && String(f.style)) || 'normal',
        englishFamilyGuess: guessEnglishFamilyFromPostScript((f.postScriptName && String(f.postScriptName)) || ''),
      }));
  } catch (e) {
    console.warn('[fontService] getFonts2 failed:', e);
    return [];
  }
}

async function loadFamiliesOnly(): Promise<string[]> {
  try {
    const { getFonts } = await import('font-list');
    const fonts = await getFonts({ disableQuoting: true });
    const list = Array.isArray(fonts) ? fonts : [];
    if (list.length < 20 && platform() === 'darwin') {
      const fallback = await getFontsBySystemProfiler();
      return fallback.length > list.length ? fallback : list;
    }
    return list;
  } catch (e) {
    console.error('[fontService] getFonts failed:', e);
    if (platform() === 'darwin') return getFontsBySystemProfiler();
    return [];
  }
}

function rebuildFamilyListFromFaces(faces: SystemFontFaceRow[]): string[] {
  const set = new Set(faces.map((f) => f.familyName));
  return Array.from(set).sort((a, b) =>
    a.replace(/^['"]+|['"]+$/g, '').localeCompare(b.replace(/^['"]+|['"]+$/g, ''), 'zh', { sensitivity: 'base' })
  );
}

/**
 * 获取系统字体族名列表（供 UI 主下拉），结果缓存
 */
export async function getSystemFonts(): Promise<string[]> {
  if (cachedFamilies !== null) return cachedFamilies;
  const faces = await getSystemFontFaces();
  return cachedFamilies ?? rebuildFamilyListFromFaces(faces);
}

/**
 * 获取全部字体字面（样式子下拉）
 */
export async function getSystemFontFaces(): Promise<SystemFontFaceRow[]> {
  if (cachedFaces !== null) return cachedFaces;

  let faces: SystemFontFaceRow[] = [];

  if (platform() === 'darwin') {
    faces = await loadDarwinFaces();
    if (faces.length < 100) {
      const fallback = await loadDetailedFacesNonDarwin();
      if (fallback.length > faces.length) faces = fallback;
    }
  } else {
    faces = await loadDetailedFacesNonDarwin();
  }

  if (faces.length === 0) {
    const fam = await loadFamiliesOnly();
    faces = syntheticFacesFromFamilies(fam.length ? fam : ['Arial', 'Microsoft YaHei', 'PingFang SC']);
  }

  cachedFaces = faces;
  if (cachedFamilies === null) cachedFamilies = rebuildFamilyListFromFaces(faces);
  return cachedFaces;
}
