/**
 * 图片编辑器：导出 SVG / PDF / EPS / ODG 等非 PNG 格式（见功能文档 图片编辑）
 */
import { PDFDocument } from 'pdf-lib';
import { buildZipStoreOnly } from '@/utils/zipStoreOnly';
import type {
  EditorObject,
  EditorImageObject,
  EditorPathObject,
  EditorShapeObject,
  EditorTextObject,
  PathSubpathStyleOverride,
} from './editorTypes';
import { serializeSubpathToD, tryParsePathData } from '@/utils/svgPathEditModel';

export type RasterExportMime = 'image/png' | 'image/jpeg' | 'image/webp';

export function editorHasVectorPathLayer(objects: EditorObject[]): boolean {
  return objects.some((o) => o.type === 'path');
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function stripDataUrlToBase64(dataUrl: string): string {
  const i = dataUrl.indexOf('base64,');
  return i >= 0 ? dataUrl.slice(i + 7) : dataUrl;
}

function uint8ToBase64(u8: Uint8Array): string {
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < u8.length; i += chunk) {
    binary += String.fromCharCode.apply(null, u8.subarray(i, i + chunk) as unknown as number[]);
  }
  return btoa(binary);
}

function utf8ToBase64(text: string): string {
  return btoa(unescape(encodeURIComponent(text)));
}

/** 文档组与 Konva 一致：须写标准 SVG transform 属性，不能写成 `<g translate(...)>`（非法 XML） */
function transformAttr(obj: { x: number; y: number; rotation: number }): string {
  const { x, y, rotation } = obj;
  if (rotation === 0) return `transform="translate(${x} ${y})"`;
  return `transform="translate(${x} ${y}) rotate(${rotation})"`;
}

function shapeFillToSvg(o: EditorShapeObject): { fill: string; def?: string } {
  if (o.fillMode === 'solid') return { fill: o.fill };
  if (o.fillMode === 'gradient' || o.fillMode === 'gradient_radial') {
    const id = `g_${o.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    const a = escapeXml(o.gradientColor1);
    const b = escapeXml(o.gradientColor2);
    if (o.fillMode === 'gradient') {
      const ang = ((o.gradientAngleDeg ?? 0) * Math.PI) / 180;
      const x2 = Math.cos(ang) * o.width;
      const y2 = Math.sin(ang) * o.height;
      const def = `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${x2}" y2="${y2}"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></linearGradient>`;
      return { fill: `url(#${id})`, def };
    }
    const cx = o.width / 2;
    const cy = o.height / 2;
    const r = Math.max(o.width, o.height) / 2;
    const def = `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}"><stop offset="0%" stop-color="${a}"/><stop offset="100%" stop-color="${b}"/></radialGradient>`;
    return { fill: `url(#${id})`, def };
  }
  return { fill: o.fill };
}

function imageLayerToSvgFragment(o: EditorImageObject): string {
  const href = o.src.startsWith('data:') ? o.src : escapeXml(o.src);
  const sc = o.sourceCrop;
  const g = `<g ${transformAttr(o)}>`;
  if (sc && o.naturalW && o.naturalH) {
    const nw = Math.max(1, o.naturalW);
    const nh = Math.max(1, o.naturalH);
    const clipId = `clip_${o.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
    return `${g}<defs><clipPath id="${clipId}"><rect x="0" y="0" width="${o.width}" height="${o.height}"/></clipPath></defs><g clip-path="url(#${clipId})"><image href="${href}" x="${(-sc.x / nw) * o.width}" y="${(-sc.y / nh) * o.height}" width="${(nw / sc.width) * o.width}" height="${(nh / sc.height) * o.height}" preserveAspectRatio="none" opacity="${o.opacity}"/></g></g>`;
  }
  return `${g}<image href="${href}" x="0" y="0" width="${o.width}" height="${o.height}" preserveAspectRatio="none" opacity="${o.opacity}"/></g>`;
}

function pathStrokeSvgAttrs(stroke: string, strokeWidth: number): string {
  if (strokeWidth > 0 && stroke !== 'transparent') {
    return ` stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"`;
  }
  return '';
}

/** 子路径填充：优先 pathSubpathStyles[i].fill，否则整层 pattern 或顶层 fill */
function subpathFillValue(
  o: EditorPathObject,
  st: PathSubpathStyleOverride | undefined,
  patternId: string
): string {
  if (st?.fill != null && st.fill !== '') {
    return escapeXml(st.fill);
  }
  if (o.fillKind === 'pattern' && o.patternSrc) {
    return `url(#${patternId})`;
  }
  return escapeXml(o.fill);
}

function subpathStrokePair(
  o: EditorPathObject,
  st: PathSubpathStyleOverride | undefined
): { stroke: string; strokeWidth: number } {
  return {
    stroke: st?.stroke != null && st.stroke !== '' ? st.stroke : o.stroke,
    strokeWidth: st?.strokeWidth !== undefined ? st.strokeWidth : o.strokeWidth,
  };
}

/** 导出 SVG 内 `<path>` 的文档级短 id（p0、p1…），见 buildEditorSvgString */
type SvgPathIdSeq = { n: number };

function nextExportPathId(seq: SvgPathIdSeq): string {
  return `p${seq.n++}`;
}

function pathObjectToSvgFragment(o: EditorPathObject, pathIdSeq: SvgPathIdSeq): string {
  const sx = o.naturalW > 0 ? o.width / o.naturalW : 1;
  const sy = o.naturalH > 0 ? o.height / o.naturalH : 1;
  const pid = `pat_${o.id.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  let defs = '';
  if (o.fillKind === 'pattern' && o.patternSrc) {
    const href = o.patternSrc.startsWith('data:') ? o.patternSrc : escapeXml(o.patternSrc);
    defs = `<defs><pattern id="${pid}" patternUnits="userSpaceOnUse" width="${o.naturalW}" height="${o.naturalH}"><image href="${href}" width="${o.naturalW}" height="${o.naturalH}"/></pattern></defs>`;
  }

  const model = tryParsePathData(o.pathData);
  const styles = o.pathSubpathStyles;
  /** 与 EditorCanvas PathObjectNode：仅当 per-subpath 样式与轮廓条数一致时才分拆；否则整段 d 单 path，复合孔洞才能 evenodd 生效 */
  const splitPathExport =
    !!model &&
    model.subpaths.length > 0 &&
    !!styles &&
    styles.length === model.subpaths.length;

  if (model && model.subpaths.length > 0 && splitPathExport) {
    const pieces: string[] = [];
    for (let i = 0; i < model.subpaths.length; i++) {
      const sp = model.subpaths[i]!;
      const dRaw = serializeSubpathToD(sp);
      if (!dRaw.trim()) continue;
      const st = styles[i];
      const fillVal = subpathFillValue(o, st, pid);
      const { stroke: sc, strokeWidth: sw } = subpathStrokePair(o, st);
      const d = escapeXml(dRaw);
      const peid = nextExportPathId(pathIdSeq);
      pieces.push(
        `<path id="${peid}" transform="scale(${sx} ${sy})" d="${d}" fill="${fillVal}" fill-rule="evenodd" opacity="${o.opacity}"${pathStrokeSvgAttrs(sc, sw)}/>`
      );
    }
    if (pieces.length > 0) {
      return `<g ${transformAttr(o)}>${defs}${pieces.join('')}</g>`;
    }
  }

  const fill =
    o.fillKind === 'pattern' && o.patternSrc ? `url(#${pid})` : escapeXml(o.fill);
  const stroke = pathStrokeSvgAttrs(o.stroke, o.strokeWidth);
  const d = escapeXml(o.pathData);
  const peid = nextExportPathId(pathIdSeq);
  return `<g ${transformAttr(o)}>${defs}<path id="${peid}" transform="scale(${sx} ${sy})" d="${d}" fill="${fill}" fill-rule="evenodd" opacity="${o.opacity}"${stroke}/></g>`;
}

function shapeToSvgFragment(o: EditorShapeObject): string {
  const { fill, def } = shapeFillToSvg(o);
  const idSafe = o.id.replace(/[^a-zA-Z0-9_-]/g, '_');
  const shadow = o.shadowEnabled ? ` filter="url(#sh_${idSafe})"` : '';
  const innerDefs: string[] = [];
  if (def) innerDefs.push(def);
  if (o.shadowEnabled) {
    const sc = escapeXml(o.shadowColor);
    innerDefs.push(
      `<filter id="sh_${idSafe}" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${o.shadowOffsetX}" dy="${o.shadowOffsetY}" stdDeviation="${(o.shadowBlur + o.shadowSpread) / 2}" flood-color="${sc}" flood-opacity="0.5"/></filter>`
    );
  }
  const defs = innerDefs.length ? `<defs>${innerDefs.join('')}</defs>` : '';
  const base = `<g ${transformAttr(o)}>${defs}`;
  if (o.geometryKind === 'rect') {
    const r = o.cornerRadius > 0 ? ` rx="${o.cornerRadius}" ry="${o.cornerRadius}"` : '';
    return `${base}<rect x="0" y="0" width="${o.width}" height="${o.height}"${r} fill="${fill}"${shadow}/></g>`;
  }
  if (o.geometryKind === 'circle') {
    const cx = o.width / 2;
    const cy = o.height / 2;
    const rx = o.width / 2;
    const ry = o.height / 2;
    return `${base}<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${shadow}/></g>`;
  }
  if (o.geometryKind === 'path' && o.pathData && o.naturalW && o.naturalH) {
    const sx = o.width / o.naturalW;
    const sy = o.height / o.naturalH;
    const d = escapeXml(o.pathData);
    return `${base}<path transform="scale(${sx} ${sy})" d="${d}" fill="${fill}" fill-rule="evenodd"${shadow}/></g>`;
  }
  return `${base}<rect x="0" y="0" width="${o.width}" height="${o.height}" fill="${fill}"${shadow}/></g>`;
}

function textToSvgFragment(o: EditorTextObject): string {
  const ff = escapeXml(o.fontFamily);
  const fill = escapeXml(o.fill);
  const lines = o.text.split('\n');
  const inner =
    lines.length === 1
      ? escapeXml(o.text)
      : lines
          .map((line, i) =>
            i === 0
              ? `<tspan x="0" dy="0">${escapeXml(line)}</tspan>`
              : `<tspan x="0" dy="${(o.fontSize * 1.2).toFixed(2)}">${escapeXml(line)}</tspan>`
          )
          .join('');
  return `<g ${transformAttr(o)}><text x="0" y="${o.fontSize}" font-family="${ff}" font-size="${o.fontSize}" fill="${fill}" opacity="${o.opacity}">${inner}</text></g>`;
}

/** 组装整页 SVG（与画布文档坐标一致） */
export function buildEditorSvgString(
  objects: EditorObject[],
  docWidth: number,
  docHeight: number,
  docBackgroundColor: string
): string {
  const w = Math.max(1, Math.round(docWidth));
  const h = Math.max(1, Math.round(docHeight));
  const bg =
    !docBackgroundColor || docBackgroundColor.trim().toLowerCase() === 'transparent'
      ? ''
      : `<rect x="0" y="0" width="${w}" height="${h}" fill="${escapeXml(docBackgroundColor)}"/>`;
  const parts: string[] = [];
  const pathIdSeq: SvgPathIdSeq = { n: 0 };
  for (const o of objects) {
    if (o.layerVisible === false) continue;
    if (o.type === 'image') parts.push(imageLayerToSvgFragment(o as EditorImageObject));
    else if (o.type === 'path') parts.push(pathObjectToSvgFragment(o as EditorPathObject, pathIdSeq));
    else if (o.type === 'shape') parts.push(shapeToSvgFragment(o as EditorShapeObject));
    else if (o.type === 'text') parts.push(textToSvgFragment(o as EditorTextObject));
  }
  const body = `${bg}${parts.join('')}`;
  return `<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}

export async function buildPdfFromPngDataUrl(
  pngDataUrl: string,
  widthPt: number,
  heightPt: number
): Promise<Uint8Array> {
  const b64 = stripDataUrlToBase64(pngDataUrl);
  const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const pdfDoc = await PDFDocument.create();
  const img = await pdfDoc.embedPng(raw);
  const page = pdfDoc.addPage([widthPt, heightPt]);
  page.drawImage(img, { x: 0, y: 0, width: widthPt, height: heightPt });
  return pdfDoc.save();
}

/** 整页 RGB 光栅嵌入 EPS（ASCIIHex colorimage） */
export function buildEpsFromRgba(
  width: number,
  height: number,
  rgba: Uint8ClampedArray
): string {
  const W = Math.max(1, width);
  const H = Math.max(1, height);
  let hex = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const r = rgba[i] ?? 0;
      const g = rgba[i + 1] ?? 0;
      const b = rgba[i + 2] ?? 0;
      hex += r.toString(16).padStart(2, '0');
      hex += g.toString(16).padStart(2, '0');
      hex += b.toString(16).padStart(2, '0');
      if (hex.length % 72 === 0) hex += '\n';
    }
  }
  if (!hex.endsWith('\n')) hex += '\n';
  return (
    `%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 ${W} ${H}\n%%EndComments\n` +
    `gsave\n${W} ${H} 8 [${W} 0 0 -${H} 0 ${H}] { currentfile /ASCIIHexDecode filter } bind false 3 colorimage\n` +
    hex +
    `>\ngrestore\n%%EOF\n`
  );
}

export function rgbaFromPngDataUrl(pngDataUrl: string): Promise<{ w: number; h: number; rgba: Uint8ClampedArray }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) {
        reject(new Error('no 2d'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      const rgba = ctx.getImageData(0, 0, w, h).data;
      resolve({ w, h, rgba });
    };
    img.onerror = () => reject(new Error('png load'));
    img.src = pngDataUrl;
  });
}

export async function buildEpsFromPngDataUrlAsync(pngDataUrl: string): Promise<string> {
  const { w, h, rgba } = await rgbaFromPngDataUrl(pngDataUrl);
  return buildEpsFromRgba(w, h, rgba);
}

/** 最小 ODG：单页嵌入整图 PNG（ZIP 在渲染进程内用纯 JS 生成，不引用 adm-zip/fs） */
export function buildOdgZipBase64FromPngBytes(pngBytes: Uint8Array): string {
  const enc = new TextEncoder();
  const pngName = 'Pictures/10000000000000000000000000.png';

  const manifest = `<?xml version="1.0" encoding="UTF-8"?>
<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0">
  <manifest:file-entry manifest:full-path="/" manifest:media-type="application/vnd.oasis.opendocument.graphics"/>
  <manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>
  <manifest:file-entry manifest:full-path="${pngName}" manifest:media-type="image/png"/>
</manifest:manifest>`;

  const styles = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-styles xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0">
  <office:styles/>
  <office:automatic-styles/>
  <office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>
</office:document-styles>`;

  const W = 210;
  const H = 297;
  const content = `<?xml version="1.0" encoding="UTF-8"?>
<office:document-content xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0">
  <office:automatic-styles/>
  <office:body>
    <office:drawing>
      <draw:page draw:name="page1" draw:style-name="dp1">
        <draw:frame draw:style-name="fr1" draw:name="img1" svg:width="${W}mm" svg:height="${H}mm" svg:x="0mm" svg:y="0mm">
          <draw:image xlink:href="${pngName}" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>
        </draw:frame>
      </draw:page>
    </office:drawing>
  </office:body>
</office:document-content>`;

  const zipBytes = buildZipStoreOnly([
    { path: 'mimetype', data: enc.encode('application/vnd.oasis.opendocument.graphics') },
    { path: pngName, data: pngBytes },
    { path: 'META-INF/manifest.xml', data: enc.encode(manifest) },
    { path: 'styles.xml', data: enc.encode(styles) },
    { path: 'content.xml', data: enc.encode(content) },
  ]);

  return uint8ToBase64(zipBytes);
}

export function buildOdgZipBase64FromPngDataUrl(pngDataUrl: string): string {
  const b64 = stripDataUrlToBase64(pngDataUrl);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return buildOdgZipBase64FromPngBytes(bytes);
}

export { utf8ToBase64, uint8ToBase64, stripDataUrlToBase64 };
