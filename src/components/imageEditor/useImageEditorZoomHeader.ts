import { useMemo } from 'react';

/** 与 ImageEditorPage 中 zoomMode 一致 */
export type ImageEditorZoomHeaderMode = 'fit' | 'fixed';

export type ImageEditorZoomHeaderDisplay = {
  /** 四舍五入后的缩放百分比，如 54 */
  zoomPercentRounded: number;
  /**
   * 顶栏 Select 的受控 value：始终为实际缩放对应百分比字符串（不再使用 'fit'），
   * 以便手势缩放、适合画布时_closed 态都显示准确数字。
   */
  zoomSelectValue: string;
  /** Tooltip 全文 */
  zoomTooltipTitle: string;
};

/**
 * 将画布「逻辑 zoom」同步到顶栏缩放控件展示。
 * - 固定比例：跟随 state.zoom（含滚轮捏合手势）。
 * - 适合画布：按 fitZoom 显示（视口/文档变化时与 ImageEditorPage 内 effect 一致）。
 */
export function useImageEditorZoomHeaderDisplay(params: {
  zoom: number;
  zoomMode: ImageEditorZoomHeaderMode;
  fitZoom: number;
}): ImageEditorZoomHeaderDisplay {
  const { zoom, zoomMode, fitZoom } = params;

  return useMemo(() => {
    const raw = zoomMode === 'fit' ? fitZoom : zoom;
    const safe = Number.isFinite(raw) && raw > 0 ? raw : 0.05;
    const zoomPercentRounded = Math.min(40_000, Math.max(1, Math.round(safe * 100)));
    const zoomSelectValue = String(zoomPercentRounded);
    const zoomTooltipTitle =
      zoomMode === 'fit'
        ? `画布缩放：${zoomPercentRounded}%（适合画布 · 视口或文档变化时自动更新）`
        : `画布缩放：${zoomPercentRounded}%（固定比例 · 双指或 ⌃/⌘+滚轮缩放）`;
    return { zoomPercentRounded, zoomSelectValue, zoomTooltipTitle };
  }, [zoom, zoomMode, fitZoom]);
}
