/**
 * 图片编辑器：打开本地 / 插入 图片对话框扩展名（与主进程 imageEditorImport 一致）
 */
export const EDITOR_IMAGE_DIALOG_FILTER = {
  name: '图片、SVG、PDF、EPS、ODG',
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
} as const;
