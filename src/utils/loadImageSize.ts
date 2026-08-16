/**
 * 获取图片/位图 data URL 的像素尺寸（用于图片编辑器插入与画布）
 */
const DECODE_TIMEOUT_MS = 60_000;

export async function loadImageSize(src: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const timer = window.setTimeout(() => {
      reject(new Error(`加载超时（${DECODE_TIMEOUT_MS / 1000}s）`));
    }, DECODE_TIMEOUT_MS);
    img.onload = () => {
      window.clearTimeout(timer);
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w > 0 && h > 0) {
        resolve({ w, h });
        return;
      }
      const svgHint = src.startsWith('data:image/svg+xml')
        ? ' SVG 若以 data URL 加载，在 Electron 内 <img> 常得到 0×0；本地文件应由主进程先转为 PNG。'
        : '';
      reject(new Error(`无效尺寸 ${w}×${h}。${svgHint}`));
    };
    img.onerror = () => {
      window.clearTimeout(timer);
      if (src.startsWith('data:image/svg+xml')) {
        reject(
          new Error(
            'data:image/svg+xml 在 <img> 中解码失败（Chromium 对 data URL 型 SVG 限制较严）。请使用桌面版：打开/插入 SVG 时会由主进程栅格化为 PNG。'
          )
        );
        return;
      }
      reject(new Error('图片解码失败（文件损坏、截断或浏览器不支持的 data URL）'));
    };
    img.src = src;
  });
}
