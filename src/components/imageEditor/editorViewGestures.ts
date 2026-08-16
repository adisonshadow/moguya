/**
 * 图片编辑区：视口平移与以屏幕点为锚的缩放（触控板双指 / 触摸屏双指）
 */

export const EDITOR_VIEW_ZOOM_MIN = 0.05;
export const EDITOR_VIEW_ZOOM_MAX = 4;

export function docCenterInset(viewportW: number, viewportH: number, docW: number, docH: number, z: number) {
  return {
    cx0: Math.max(0, (viewportW - docW * z) / 2),
    cy0: Math.max(0, (viewportH - docH * z) / 2),
  };
}

/** 缩放后保持 (screenX, screenY) 下对应文档点不动；返回新 zoom 与附加 viewPan */
export function zoomAroundScreenPoint(args: {
  viewportW: number;
  viewportH: number;
  docW: number;
  docH: number;
  zoom: number;
  viewPan: { x: number; y: number };
  screenX: number;
  screenY: number;
  newZoom: number;
}): { zoom: number; viewPan: { x: number; y: number } } {
  const { viewportW, viewportH, docW, docH, zoom, viewPan, screenX, screenY, newZoom } = args;
  const { cx0, cy0 } = docCenterInset(viewportW, viewportH, docW, docH, zoom);
  const cx = cx0 + viewPan.x;
  const cy = cy0 + viewPan.y;
  const docX = (screenX - cx) / zoom;
  const docY = (screenY - cy) / zoom;
  const z = Math.min(EDITOR_VIEW_ZOOM_MAX, Math.max(EDITOR_VIEW_ZOOM_MIN, newZoom));
  const { cx0: cx0n, cy0: cy0n } = docCenterInset(viewportW, viewportH, docW, docH, z);
  const cxNew = screenX - docX * z;
  const cyNew = screenY - docY * z;
  return { zoom: z, viewPan: { x: cxNew - cx0n, y: cyNew - cy0n } };
}
