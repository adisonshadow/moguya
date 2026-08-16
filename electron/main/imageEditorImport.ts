/**
 * 图片编辑器：栅格格式转 data URL；SVG/SVGZ 返回原始文本供渲染进程解析为矢量图层；PDF/EPS/ODG 等栅格化
 */
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import zlib from 'node:zlib';
import sharp from 'sharp';

const execFileAsync = promisify(execFile);

const RASTER_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff',
};

const MAX_RASTER_SIDE = 8192;
const MAX_SVG_TEXT_BYTES = 12 * 1024 * 1024;

async function tryGhostscriptEpsToPng(epsPath: string): Promise<string | null> {
  const outPng = path.join(os.tmpdir(), `yiman_eps_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  const bins = process.platform === 'win32' ? ['gswin64c.exe', 'gswin32c.exe', 'gswin64c', 'gswin32c', 'gs'] : ['gs'];
  for (const bin of bins) {
    try {
      await execFileAsync(
        bin,
        [
          '-dSAFER',
          '-dBATCH',
          '-dNOPAUSE',
          '-sDEVICE=pngalpha',
          '-r144',
          `-sOutputFile=${outPng}`,
          epsPath,
        ],
        { timeout: 90_000 }
      );
      if (fs.existsSync(outPng)) {
        const b = fs.readFileSync(outPng);
        try {
          fs.unlinkSync(outPng);
        } catch {
          /* ignore */
        }
        return `data:image/png;base64,${b.toString('base64')}`;
      }
    } catch {
      try {
        if (fs.existsSync(outPng)) fs.unlinkSync(outPng);
      } catch {
        /* ignore */
      }
    }
  }
  return null;
}

async function tryLibreOfficeOdgToPng(odgPath: string): Promise<string | null> {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yiman_odg_'));
  const sofficeBins =
    process.platform === 'darwin'
      ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice', 'soffice']
      : process.platform === 'win32'
        ? [
            'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
            'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
            'soffice.exe',
            'soffice',
          ]
        : ['soffice'];
  try {
    for (const bin of sofficeBins) {
      try {
        await execFileAsync(
          bin,
          ['--headless', '--convert-to', 'png', '--outdir', tmp, odgPath],
          { timeout: 120_000 }
        );
        const names = fs.readdirSync(tmp).filter((f) => f.toLowerCase().endsWith('.png'));
        if (!names.length) continue;
        const pngPath = path.join(tmp, names[0]!);
        const b = fs.readFileSync(pngPath);
        return `data:image/png;base64,${b.toString('base64')}`;
      } catch {
        /* try next bin */
      }
    }
  } finally {
    try {
      fs.rmSync(tmp, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  return null;
}

export type ReadImageFileForEditorResult =
  | { ok: true; kind: 'raster'; dataUrl: string }
  | { ok: true; kind: 'svg'; svgText: string }
  | { ok: false; error: string };

export async function readImageFileForEditor(fullPath: string): Promise<ReadImageFileForEditorResult> {
  const raw = fullPath?.trim();
  if (!raw) return { ok: false, error: '路径无效' };
  const normalized = path.normalize(raw);
  if (!fs.existsSync(normalized)) return { ok: false, error: '文件不存在' };

  const ext = path.extname(normalized).toLowerCase();
  let buf: Buffer;
  try {
    buf = fs.readFileSync(normalized);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : '读取失败' };
  }

  const mime = RASTER_MIME[ext];
  if (mime) {
    return { ok: true, kind: 'raster', dataUrl: `data:${mime};base64,${buf.toString('base64')}` };
  }

  if (ext === '.svg' || ext === '.svgz') {
    try {
      const rawBuf = ext === '.svgz' ? zlib.gunzipSync(buf) : buf;
      if (rawBuf.length > MAX_SVG_TEXT_BYTES) {
        return { ok: false, error: `SVG 过大（>${Math.floor(MAX_SVG_TEXT_BYTES / (1024 * 1024))}MB）` };
      }
      const text = rawBuf.toString('utf8').trim();
      if (!text.startsWith('<')) {
        return { ok: false, error: 'SVG 内容无效（非 XML）' };
      }
      return { ok: true, kind: 'svg', svgText: text };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, error: ext === '.svgz' ? `SVGZ 解压失败：${msg}` : `读取 SVG 失败：${msg}` };
    }
  }

  try {
    if (ext === '.pdf') {
      const png = await sharp(buf, { density: 144, failOn: 'none' })
        .resize(MAX_RASTER_SIDE, MAX_RASTER_SIDE, { fit: 'inside', withoutEnlargement: true })
        .png()
        .toBuffer();
      return { ok: true, kind: 'raster', dataUrl: `data:image/png;base64,${png.toString('base64')}` };
    }

    if (ext === '.eps' || ext === '.ps') {
      try {
        const png = await sharp(buf, { failOn: 'none' })
          .resize(MAX_RASTER_SIDE, MAX_RASTER_SIDE, { fit: 'inside', withoutEnlargement: true })
          .png()
          .toBuffer();
        return { ok: true, kind: 'raster', dataUrl: `data:image/png;base64,${png.toString('base64')}` };
      } catch {
        const gs = await tryGhostscriptEpsToPng(normalized);
        if (gs) return { ok: true, kind: 'raster', dataUrl: gs };
        return {
          ok: false,
          error: '无法渲染 EPS/PS：可安装 Ghostscript，或先导出为 PDF/SVG',
        };
      }
    }

    if (ext === '.odg') {
      const lo = await tryLibreOfficeOdgToPng(normalized);
      if (lo) return { ok: true, kind: 'raster', dataUrl: lo };
      return {
        ok: false,
        error: '无法打开 ODG：请安装 LibreOffice，或先导出为 PDF/PNG',
      };
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (ext === '.pdf') {
      return {
        ok: false,
        error: `PDF 渲染失败（${msg}）。若本机 sharp 未链接 PDF 支持，可先导出为图片或使用其他格式`,
      };
    }
    return { ok: false, error: msg || '转换失败' };
  }

  return { ok: false, error: '不支持的格式' };
}
