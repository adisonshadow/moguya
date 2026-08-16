/**
 * 从 data URL 或裸 SVG 文本中取出 UTF-8 的 SVG 字符串（图片编辑器导入矢量图层）
 */
export function tryDecodeSvgTextFromSrc(src: string): string | null {
  const s = src.trim();
  if (s.startsWith('<svg') || (s.startsWith('<?xml') && /<svg[\s>]/i.test(s))) return s;
  const low = s.slice(0, 64).toLowerCase();
  if (!low.startsWith('data:image/svg+xml')) return null;
  const comma = s.indexOf(',');
  if (comma < 0) return null;
  const header = s.slice(0, comma);
  const payload = s.slice(comma + 1);
  try {
    if (/;base64/i.test(header)) {
      const bin = atob(payload.replace(/\s/g, ''));
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      return new TextDecoder('utf-8').decode(bytes);
    }
    return decodeURIComponent(payload.replace(/\+/g, ' '));
  } catch {
    return null;
  }
}
