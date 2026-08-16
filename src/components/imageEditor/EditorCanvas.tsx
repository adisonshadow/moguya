/**
 * 图片编辑器 Konva 画布：文档组、选中、变换、右键
 */
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
  type Dispatch,
  type SetStateAction,
} from 'react';
import Konva from 'konva';
import { Stage, Layer, Group, Rect, Line, Image as KonvaImage, Text as KonvaText, Path, Ellipse, Transformer } from 'react-konva';
import type { EditorObject, EditorImageObject, EditorPathObject, EditorShapeObject, EditorTextObject } from './editorTypes';
import { docBackgroundToKonvaFill, isShapeFrostedActive } from './editorTypes';
import {
  konvaFontStyleFromFace,
  letterSpacingPxFromPercent,
  resolveShapeTextFace,
  resolveTextFace,
  konvaShadowBlurFromBlurAndSpread,
  textAppearanceFromShapeObject,
  textAppearanceFromTextObject,
  type EditorFontFaceInfo,
} from './textAppearance';
import { createKonvaCheckerboardTile } from '@/utils/konvaCheckerboardPattern';
import { EDITOR_SNAP_SCREEN_PX, snapDragRect } from './editorSnap';
import { applyZoomAroundCenter, getFullImageDisplayFrameInDoc, type CropDocRect } from './imageCropHelpers';
import { objectRotatedBounds } from './editorContentBounds';
import { serializeSubpathToD, tryParsePathData } from '@/utils/svgPathEditModel';
import { composeBackdropFrostedTexture } from '@/utils/frostedGlassCanvas';
import {
  centeredGradientLine,
  centeredRadialEllipse,
  naturalRectRadialGradient,
  rectLocalGradientLine,
  rectLocalRadialGradient,
  resolveShapeGradientAngleDeg,
} from './shapeGradientEndpoints';
import {
  PathVectorEditOverlay,
  type PathVectorEditUiState,
  type PathVectorSimplifyPreview,
} from './PathVectorEditOverlay';

/** 多选：整组替换 / 单 id 开关 / 追加框选结果 */
export type EditorSelectAction =
  | { type: 'set'; ids: string[] }
  | { type: 'toggle'; id: string }
  | { type: 'add'; ids: string[] };

function docMarqueeFromScreen(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  cx: number,
  cy: number,
  z: number
) {
  const l = Math.min(x0, x1);
  const r = Math.max(x0, x1);
  const t = Math.min(y0, y1);
  const b = Math.max(y0, y1);
  return {
    minX: (l - cx) / z,
    minY: (t - cy) / z,
    maxX: (r - cx) / z,
    maxY: (b - cy) / z,
  };
}

function aabbIntersects(
  A: { minX: number; minY: number; maxX: number; maxY: number },
  B: { minX: number; minY: number; maxX: number; maxY: number }
) {
  return A.minX < B.maxX && A.maxX > B.minX && A.minY < B.maxY && A.maxY > B.minY;
}

/** 拖拽吸附：对齐画布与其它对象边/中点（Konva 拖拽事件与 react-konva 泛型不完全一致，此处放宽） */
type EditorDragSnapHandlers = {
  onDragStart: () => void;
  onDragMove: (e: Konva.KonvaEventObject<unknown>) => void;
  onDragEnd: (e: Konva.KonvaEventObject<unknown>) => void;
};

export interface EditorCanvasProps {
  docWidth: number;
  docHeight: number;
  /** 画布底色：transparent 或与 ColorPicker 一致的 CSS 颜色 */
  docBackgroundColor?: string;
  objects: EditorObject[];
  onObjectsChange: Dispatch<SetStateAction<EditorObject[]>>;
  selectedIds: string[];
  onSelectChange: (action: EditorSelectAction) => void;
  zoom: number;
  /** 在居中基础上的视口平移（屏幕像素），与裁切浮层共用同一原点 */
  viewPan?: { x: number; y: number };
  /** 触控板双指滑动 / 触摸拖动：增量平移 */
  onViewPanGestureDelta?: (dx: number, dy: number) => void;
  /** 以包装元素内坐标为锚的捏合缩放 */
  onZoomGestureAt?: (newZoom: number, screenXInWrap: number, screenYInWrap: number, viewportW: number, viewportH: number) => void;
  onContextMenu: (e: { x: number; y: number; objectId: string }) => void;
  /** 画布容器尺寸变化（用于「适合画布」缩放） */
  onViewportSize?: (w: number, h: number) => void;
  /** 裁切模式中的图片图层：隐藏 Transformer，仅预览缩放 */
  imageCropModeId?: string | null;
  imageCropPreviewZoom?: number;
  /** 画布编辑：禁用图层拖拽与变形框 */
  canvasEditMode?: boolean;
  /** 移除白底 / 适合画布 / 适合内容 等：禁用图层拖拽与变形框 */
  adjustOverlayLock?: boolean;
  /** 画布编辑时虚线框（文档坐标），用于延伸棋盘格示意范围 */
  canvasEditRect?: CropDocRect | null;
  onImageNaturalSize?: (id: string, naturalW: number, naturalH: number) => void;
  /** 渲染在画布容器内的 DOM 浮层（裁切毛玻璃等），与 Stage 叠放 */
  cropOverlay?: React.ReactNode;
  /** 拖拽 / 变形开始前记录撤销点（由页面注入） */
  onBeforeObjectGesture?: () => void;
  /** 系统字体字面，供 Konva 解析 PostScript→字重 */
  fontFaces?: EditorFontFaceInfo[];
  /** 将本地/拖入的图片按文档坐标落点插入（与工具栏插入规则一致，仅位置不同） */
  onDropImageFiles?: (files: File[], docPoint: { x: number; y: number }) => void;
  /** 简化路径预览时压低该 path 图层本体不透明度，便于看清叠在上面的预览 */
  pathSimplifyDimPathId?: string | null;
  /** 矢量路径锚点编辑（仅 path 图层） */
  pathVectorEdit?: {
    objectId: string;
    ui: PathVectorEditUiState;
    onUiChange: (patch: Partial<PathVectorEditUiState>) => void;
    onCommitPathData: (pathData: string) => void;
    onGestureStart: () => void;
    /** 文档坐标系框选子路径；shift 为 true 时与当前 activeSubpaths 并集 */
    onMarqueeSelectSubpaths?: (
      docRect: { minX: number; minY: number; maxX: number; maxY: number },
      shiftKey: boolean
    ) => void;
    simplifyPreview?: PathVectorSimplifyPreview | null;
    suspendVectorInteraction?: boolean;
  } | null;
}

export type ExportDocRasterOptions = {
  pixelRatio?: number;
  mimeType?: 'image/png' | 'image/jpeg' | 'image/webp';
  /** JPEG/WebP 质量 0…1 */
  quality?: number;
};

export interface EditorCanvasHandle {
  /** 导出文档区域 PNG data URL */
  exportDocPngDataUrl: (pixelRatio?: number) => string | null;
  /** 导出文档区域栅格（PNG/JPEG/WebP） */
  exportDocRasterDataUrl: (options?: ExportDocRasterOptions) => string | null;
}

function useHtmlImage(src: string | undefined): HTMLImageElement | undefined {
  const [img, setImg] = useState<HTMLImageElement | undefined>();
  useEffect(() => {
    if (!src) {
      setImg(undefined);
      return;
    }
    let cancelled = false;
    const pendingBlobUrls: string[] = [];

    const revokeBlob = (u: string) => {
      try {
        URL.revokeObjectURL(u);
      } catch {
        /* ignore */
      }
      const ix = pendingBlobUrls.indexOf(u);
      if (ix >= 0) pendingBlobUrls.splice(ix, 1);
    };

    const commitImg = (el: HTMLImageElement) => {
      if (cancelled) return;
      const done = () => {
        if (!cancelled) setImg(el);
      };
      if (typeof el.decode === 'function') {
        el.decode().then(done).catch(done);
      } else {
        done();
      }
    };

    const loadHttpOrBlob = () => {
      const i = new Image();
      if (!src.startsWith('blob:')) {
        i.crossOrigin = 'anonymous';
      }
      i.onload = () => commitImg(i);
      i.onerror = () => {
        if (!cancelled) setImg(undefined);
      };
      i.src = src;
      return () => {
        i.onload = null;
        i.onerror = null;
      };
    };

    // 超长 data URL 直接赋给 Image 在部分环境下易 onerror；先 fetch→blob URL 更稳
    if (src.startsWith('data:')) {
      (async () => {
        try {
          const res = await fetch(src);
          const blob = await res.blob();
          if (cancelled) return;
          const ou = URL.createObjectURL(blob);
          pendingBlobUrls.push(ou);
          const i = new Image();
          i.onload = () => {
            if (cancelled) return;
            revokeBlob(ou);
            commitImg(i);
          };
          i.onerror = () => {
            revokeBlob(ou);
            if (cancelled) return;
            const i2 = new Image();
            i2.onload = () => commitImg(i2);
            i2.onerror = () => {
              if (!cancelled) setImg(undefined);
            };
            i2.src = src;
          };
          i.src = ou;
        } catch {
          if (cancelled) return;
          const i = new Image();
          i.onload = () => commitImg(i);
          i.onerror = () => {
            if (!cancelled) setImg(undefined);
          };
          i.src = src;
        }
      })();
      return () => {
        cancelled = true;
        for (const u of [...pendingBlobUrls]) revokeBlob(u);
      };
    }

    const detach = loadHttpOrBlob();
    return () => {
      cancelled = true;
      detach();
    };
  }, [src]);
  return img;
}

/**
 * Blur 滤镜在几何边界外仍有像素；`cache()` 默认按 tight bbox 裁切会导致模糊被「切平」。
 * @see Konva Node#cache({ offset })
 */
function konvaBlurCacheOffset(blurRadius: number): number {
  if (!Number.isFinite(blurRadius) || blurRadius <= 0) return 0;
  return Math.min(320, Math.ceil(blurRadius * 3) + 12);
}

function cacheAfterFilters(node: Konva.Node, blurRadius: number) {
  const pad = konvaBlurCacheOffset(blurRadius);
  if (pad > 0) node.cache({ offset: pad });
  else node.cache();
}

function applyImageNodeFilters(node: Konva.Image | null, obj: EditorImageObject) {
  if (!node) return;
  node.clearCache();
  const p = obj.stylePreset;

  node.brightness(0);
  node.contrast(0);
  node.hue(0);
  node.saturation(0);
  node.luminance(0);

  const filters: typeof Konva.Filters.Blur[] = [];
  if (obj.blurRadius > 0) filters.push(Konva.Filters.Blur);

  const useHsl = p === 'warm' || p === 'cool' || p === 'fade';
  const useGray = p === 'gray' || p === 'noir';
  const useBrighten = p === 'vivid' || p === 'soft' || p === 'dramatic' || p === 'noir';
  const useContrast = p === 'soft' || p === 'dramatic' || p === 'noir';

  if (useGray) filters.push(Konva.Filters.Grayscale);
  if (useHsl) filters.push(Konva.Filters.HSL);
  if (useBrighten) filters.push(Konva.Filters.Brighten);
  if (useContrast) filters.push(Konva.Filters.Contrast);
  if (p === 'sepia') filters.push(Konva.Filters.Sepia);
  if (p === 'invert') filters.push(Konva.Filters.Invert);

  if (filters.length === 0) {
    node.filters([]);
    return;
  }
  node.filters(filters);
  if (obj.blurRadius > 0) node.blurRadius(obj.blurRadius);

  if (p === 'vivid') node.brightness(0.14);
  if (p === 'soft') {
    node.brightness(-0.06);
    node.contrast(-32);
  }
  if (p === 'dramatic') {
    node.brightness(-0.04);
    node.contrast(38);
  }
  if (p === 'noir') {
    node.brightness(-0.1);
    node.contrast(28);
  }
  if (p === 'warm') {
    node.hue(8);
    node.saturation(0.12);
  }
  if (p === 'cool') {
    node.hue(-10);
    node.saturation(0.08);
  }
  if (p === 'fade') {
    node.saturation(-0.38);
    node.luminance(0.1);
  }
  cacheAfterFilters(node, obj.blurRadius);
}

function ImageObjectNode({
  obj,
  onContextMenuObject,
  registerNode,
  dragSnap,
  cropMode,
  cropPreviewZoom,
  layerLocked,
  pickObject,
  onImageNaturalSize,
}: {
  obj: EditorImageObject;
  pickObject: (id: string, shiftKey: boolean) => void;
  onContextMenuObject: (objectId: string, e: Konva.KonvaEventObject<PointerEvent>) => void;
  registerNode: (id: string, n: Konva.Node | null) => void;
  dragSnap: EditorDragSnapHandlers;
  cropMode: boolean;
  cropPreviewZoom: number;
  layerLocked: boolean;
  onImageNaturalSize?: (id: string, naturalW: number, naturalH: number) => void;
}) {
  const imgEl = useHtmlImage(obj.src);
  const imgRef = useRef<Konva.Image>(null);
  const grpRef = useRef<Konva.Group>(null);

  const konvaCrop = useMemo(() => {
    const c = obj.sourceCrop;
    if (!c || c.width < 1 || c.height < 1) return undefined;
    return { x: c.x, y: c.y, width: c.width, height: c.height };
  }, [obj.sourceCrop]);

  useEffect(() => {
    if (!imgEl || !onImageNaturalSize) return;
    const nw = imgEl.naturalWidth;
    const nh = imgEl.naturalHeight;
    if (nw > 0 && nh > 0) onImageNaturalSize(obj.id, nw, nh);
  }, [imgEl, obj.id, onImageNaturalSize]);

  useEffect(() => {
    applyImageNodeFilters(imgRef.current, obj);
  }, [obj.stylePreset, obj.blurRadius, obj.src, imgEl]);

  useEffect(() => {
    const node = cropMode ? grpRef.current : imgRef.current;
    registerNode(obj.id, node);
    return () => registerNode(obj.id, null);
  }, [obj.id, registerNode, imgEl, cropMode]);

  const fullFrame = useMemo(
    () => getFullImageDisplayFrameInDoc(obj),
    [obj.x, obj.y, obj.width, obj.height, obj.naturalW, obj.naturalH, obj.sourceCrop]
  );
  const displayFrame = useMemo(
    () => (cropMode ? applyZoomAroundCenter(fullFrame, cropPreviewZoom) : fullFrame),
    [cropMode, fullFrame, cropPreviewZoom]
  );

  if (!imgEl) return null;

  if (cropMode) {
    return (
      <Group
        ref={grpRef}
        name={obj.id}
        x={displayFrame.x}
        y={displayFrame.y}
        listening
        onMouseDown={(e) => {
          e.cancelBubble = true;
          pickObject(obj.id, e.evt.shiftKey);
        }}
        onContextMenu={(e) => {
          e.evt.preventDefault();
          pickObject(obj.id, false);
          onContextMenuObject(obj.id, e);
        }}
      >
        <KonvaImage
          ref={imgRef}
          x={0}
          y={0}
          width={displayFrame.w}
          height={displayFrame.h}
          image={imgEl}
          rotation={obj.rotation}
          opacity={obj.opacity}
          listening={false}
        />
      </Group>
    );
  }

  return (
    <KonvaImage
      ref={imgRef}
      name={obj.id}
      image={imgEl}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      opacity={obj.opacity}
      crop={konvaCrop}
      draggable={!layerLocked}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        pickObject(obj.id, e.evt.shiftKey);
      }}
      onDragStart={dragSnap.onDragStart}
      onDragMove={dragSnap.onDragMove}
      onDragEnd={dragSnap.onDragEnd}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        pickObject(obj.id, false);
        onContextMenuObject(obj.id, e);
      }}
    />
  );
}

function ShapeObjectNode({
  obj,
  pickObject,
  onContextMenuObject,
  registerNode,
  dragSnap,
  layerLocked,
  frostedSceneKey,
  fontFaces,
}: {
  obj: EditorShapeObject;
  pickObject: (id: string, shiftKey: boolean) => void;
  onContextMenuObject: (objectId: string, e: Konva.KonvaEventObject<PointerEvent>) => void;
  registerNode: (id: string, n: Konva.Node | null) => void;
  dragSnap: EditorDragSnapHandlers;
  layerLocked: boolean;
  /** 文档中其它图层 / 画布尺寸变化时刷新毛玻璃截取 */
  frostedSceneKey: string;
  fontFaces: EditorFontFaceInfo[];
}) {
  const grpRef = useRef<Konva.Group>(null);
  const fillRef = useRef<Konva.Rect | Konva.Ellipse | Konva.Path | null>(null);
  const [backdropCanvas, setBackdropCanvas] = useState<HTMLCanvasElement | null>(null);
  const frostedGenRef = useRef(0);
  const frostedDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    registerNode(obj.id, grpRef.current);
    return () => registerNode(obj.id, null);
  }, [obj.id, registerNode]);

  const nw = obj.naturalW ?? 100;
  const nh = obj.naturalH ?? 100;
  const pathScaleX = nw > 0 ? obj.width / nw : 1;
  const pathScaleY = nh > 0 ? obj.height / nh : 1;

  /**
   * 纯色 + 无旋转：截取文档组下方像素 → 高斯模糊 → 按形状裁剪（矩形/圆/矢量 path）。
   * 矢量 path 不再用 Konva Blur（会向边界外渗色）；渐变或非 0° 旋转仍为简版模糊。
   */
  const useBackdropFrostedReal =
    isShapeFrostedActive(obj) &&
    obj.fillMode === 'solid' &&
    Math.abs(obj.rotation) < 0.01 &&
    ((obj.geometryKind === 'rect' || obj.geometryKind === 'circle') ||
      (obj.geometryKind === 'path' && !!obj.pathData && nw > 0 && nh > 0));

  useEffect(() => {
    const r = fillRef.current;
    if (!r) return;
    if (useBackdropFrostedReal) {
      r.clearCache();
      r.filters([]);
      return;
    }
    r.clearCache();
    if (isShapeFrostedActive(obj)) {
      r.filters([Konva.Filters.Blur]);
      r.blurRadius(obj.frostedBlur);
      cacheAfterFilters(r, obj.frostedBlur);
    } else {
      r.filters([]);
    }
  }, [
    useBackdropFrostedReal,
    obj.frostedBlur,
    obj.frostedEnabled,
    obj.width,
    obj.height,
    obj.fill,
    obj.fillMode,
    obj.gradientColor1,
    obj.gradientColor2,
    obj.gradientAngleDeg,
    obj.gradientVertical,
    obj.geometryKind,
    obj.pathData,
    obj.cornerRadius,
    nw,
    nh,
  ]);

  useEffect(() => {
    if (!useBackdropFrostedReal) {
      setBackdropCanvas(null);
      return;
    }
    if (frostedDebounceRef.current) clearTimeout(frostedDebounceRef.current);

    frostedDebounceRef.current = setTimeout(() => {
      frostedDebounceRef.current = null;
      const gen = ++frostedGenRef.current;
      const run = () => {
        const group = grpRef.current;
        if (!group || gen !== frostedGenRef.current) return;
        const docGroup = group.getParent();
        const layer = docGroup?.getLayer();
        if (!docGroup || !layer) return;

        const padDoc = Math.max(4, obj.frostedBlur * 2);
        const gx = obj.x - padDoc;
        const gy = obj.y - padDoc;
        const gw = obj.width + 2 * padDoc;
        const gh = obj.height + 2 * padDoc;

        const wasVisible = group.visible();
        group.visible(false);
        layer.batchDraw();

        try {
          const pr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
          const sourceCanvas = docGroup.toCanvas({
            x: gx,
            y: gy,
            width: gw,
            height: gh,
            pixelRatio: pr,
          });
          const padPx = Math.round(padDoc * pr);
          const blurPx = Math.max(1, Math.round(obj.frostedBlur * pr * 0.9));
          const frostKind =
            obj.geometryKind === 'path' ? 'path' : obj.geometryKind === 'circle' ? 'circle' : 'rect';
          const canvas = composeBackdropFrostedTexture({
            sourceCanvas,
            blurRadiusPx: blurPx,
            padPx,
            shapePxW: Math.round(obj.width * pr),
            shapePxH: Math.round(obj.height * pr),
            cornerRadiusLogical: obj.geometryKind === 'rect' ? obj.cornerRadius : 0,
            shapeLogicalW: obj.width,
            shapeLogicalH: obj.height,
            kind: frostKind,
            frostedOpacity: obj.frostedOpacity,
            pathData: obj.geometryKind === 'path' ? obj.pathData : undefined,
            naturalW: obj.geometryKind === 'path' ? obj.naturalW : undefined,
            naturalH: obj.geometryKind === 'path' ? obj.naturalH : undefined,
          });
          if (gen === frostedGenRef.current) setBackdropCanvas(canvas);
        } catch {
          if (gen === frostedGenRef.current) setBackdropCanvas(null);
        } finally {
          group.visible(wasVisible);
          layer.batchDraw();
        }
      };

      requestAnimationFrame(() => requestAnimationFrame(run));
    }, 80);

    return () => {
      if (frostedDebounceRef.current) clearTimeout(frostedDebounceRef.current);
      frostedGenRef.current += 1;
    };
  }, [
    useBackdropFrostedReal,
    obj.frostedBlur,
    obj.frostedOpacity,
    obj.x,
    obj.y,
    obj.width,
    obj.height,
    obj.cornerRadius,
    obj.geometryKind,
    obj.pathData,
    obj.naturalW,
    obj.naturalH,
    obj.rotation,
    obj.frostedEnabled,
    frostedSceneKey,
  ]);

  const gAngle = resolveShapeGradientAngleDeg(obj);
  const rectLine = rectLocalGradientLine(obj.width, obj.height, gAngle);
  const ellLine = centeredGradientLine(obj.width, obj.height, gAngle);
  const pathLine = rectLocalGradientLine(nw, nh, gAngle);
  const rectRadial = rectLocalRadialGradient(obj.width, obj.height);
  const ellRadial = centeredRadialEllipse(obj.width / 2, obj.height / 2);
  const pathRadial = naturalRectRadialGradient(nw, nh);
  const gradStops = [0, obj.gradientColor1, 1, obj.gradientColor2] as (number | string)[];

  const rectGradient =
    obj.fillMode === 'gradient'
      ? {
          fillLinearGradientStartPoint: rectLine.start,
          fillLinearGradientEndPoint: rectLine.end,
          fillLinearGradientColorStops: gradStops,
          fillEnabled: true,
        }
      : obj.fillMode === 'gradient_radial'
        ? {
            fillRadialGradientStartPoint: rectRadial.start,
            fillRadialGradientEndPoint: rectRadial.end,
            fillRadialGradientColorStops: gradStops,
            fillEnabled: true,
          }
        : { fill: obj.fill, fillEnabled: true };

  const ellipseGradient =
    obj.fillMode === 'gradient'
      ? {
          fillLinearGradientStartPoint: ellLine.start,
          fillLinearGradientEndPoint: ellLine.end,
          fillLinearGradientColorStops: gradStops,
          fillEnabled: true,
        }
      : obj.fillMode === 'gradient_radial'
        ? {
            fillRadialGradientStartPoint: ellRadial.start,
            fillRadialGradientEndPoint: ellRadial.end,
            fillRadialGradientColorStops: gradStops,
            fillEnabled: true,
          }
        : { fill: obj.fill, fillEnabled: true };

  const pathGradient =
    obj.fillMode === 'gradient'
      ? {
          fillLinearGradientStartPoint: pathLine.start,
          fillLinearGradientEndPoint: pathLine.end,
          fillLinearGradientColorStops: gradStops,
          fillEnabled: true,
        }
      : obj.fillMode === 'gradient_radial'
        ? {
            fillRadialGradientStartPoint: pathRadial.start,
            fillRadialGradientEndPoint: pathRadial.end,
            fillRadialGradientColorStops: gradStops,
            fillEnabled: true,
          }
        : { fill: obj.fill, fillEnabled: true };

  const shadow = {
    shadowEnabled: obj.shadowEnabled,
    shadowBlur: konvaShadowBlurFromBlurAndSpread(obj.shadowBlur, obj.shadowSpread ?? 0),
    shadowColor: obj.shadowColor,
    shadowOffsetX: obj.shadowOffsetX,
    shadowOffsetY: obj.shadowOffsetY,
    shadowOpacity: obj.shadowEnabled ? 0.55 : 0,
  };

  const frostedOpacitySimple = isShapeFrostedActive(obj) ? Math.max(0.15, obj.frostedOpacity) : 1;

  const shapeTextRef = useRef<Konva.Text | null>(null);
  const shapeTextTa = textAppearanceFromShapeObject(obj);
  const shapeFace = resolveShapeTextFace(fontFaces, obj);
  const shapeKonvaFontStyle = konvaFontStyleFromFace(shapeFace);
  const shapeLetterSp = letterSpacingPxFromPercent(shapeTextTa.letterSpacingPercent, shapeTextTa.fontSize);
  const shapeOutline =
    obj.shapeTextOutlineEnabled && obj.shapeText
      ? {
          stroke: shapeTextTa.outlineColor,
          strokeWidth: shapeTextTa.outlineWidthPt,
          fillAfterStrokeEnabled: true as const,
        }
      : {};
  const shapeShadow =
    obj.shapeTextShadowEnabled && obj.shapeText
      ? {
          shadowEnabled: true,
          shadowBlur: konvaShadowBlurFromBlurAndSpread(shapeTextTa.textShadowBlurPt, shapeTextTa.textShadowSpreadPt),
          shadowColor: shapeTextTa.textShadowColor,
          shadowOffsetX: shapeTextTa.textShadowOffsetX,
          shadowOffsetY: shapeTextTa.textShadowOffsetY,
          shadowOpacity: shapeTextTa.textShadowOpacity,
        }
      : { shadowEnabled: false };

  useEffect(() => {
    const t = shapeTextRef.current;
    if (!t) return;
    t.clearCache();
    if (obj.shapeTextBlur > 0) {
      t.filters([Konva.Filters.Blur]);
      t.blurRadius(obj.shapeTextBlur);
      cacheAfterFilters(t, obj.shapeTextBlur);
    } else {
      t.filters([]);
    }
  }, [
    obj.shapeTextBlur,
    obj.shapeText,
    obj.shapeTextFontSize,
    obj.shapeTextColor,
    obj.shapeTextFontFamily,
    obj.shapeTextFontPostScriptName,
    obj.shapeTextOutlineEnabled,
    obj.shapeTextOutlineColor,
    obj.shapeTextOutlineWidthPt,
    obj.shapeTextShadowEnabled,
    obj.shapeTextShadowBlurPt,
    obj.shapeTextShadowOffsetX,
    obj.shapeTextShadowOffsetY,
    obj.shapeTextShadowSpreadPt,
    obj.shapeTextShadowOpacity,
    obj.shapeTextShadowColor,
    obj.shapeTextLetterSpacingPercent,
    obj.shapeTextOpacity,
  ]);

  let fillBody: React.ReactNode;
  if (useBackdropFrostedReal) {
    fillBody = (
      <>
        <Rect x={0} y={0} width={obj.width} height={obj.height} fill="rgba(0,0,0,0.02)" listening />
        {backdropCanvas ? (
          <KonvaImage
            image={backdropCanvas}
            x={0}
            y={0}
            width={obj.width}
            height={obj.height}
            opacity={1}
            {...shadow}
            listening={false}
            perfectDrawEnabled={false}
          />
        ) : (
          <Rect
            width={obj.width}
            height={obj.height}
            cornerRadius={obj.geometryKind === 'rect' ? obj.cornerRadius : 0}
            fill="rgba(180,200,230,0.2)"
            listening={false}
          />
        )}
      </>
    );
  } else if (obj.geometryKind === 'path' && obj.pathData && obj.naturalW && obj.naturalH) {
    fillBody = (
      <>
        <Rect
          x={0}
          y={0}
          width={obj.width}
          height={obj.height}
          fill="rgba(0,0,0,0.02)"
          listening
        />
        <Path
          ref={fillRef as React.RefObject<Konva.Path>}
          data={obj.pathData}
          fillRule="evenodd"
          x={0}
          y={0}
          scaleX={pathScaleX}
          scaleY={pathScaleY}
          opacity={frostedOpacitySimple}
          {...pathGradient}
          {...shadow}
          listening={false}
          perfectDrawEnabled={false}
          shadowForStrokeEnabled={false}
        />
      </>
    );
  } else if (obj.geometryKind === 'circle') {
    fillBody = (
      <Ellipse
        ref={fillRef as React.RefObject<Konva.Ellipse>}
        x={obj.width / 2}
        y={obj.height / 2}
        radiusX={obj.width / 2}
        radiusY={obj.height / 2}
        opacity={frostedOpacitySimple}
        {...ellipseGradient}
        {...shadow}
      />
    );
  } else {
    fillBody = (
      <Rect
        ref={fillRef as React.RefObject<Konva.Rect>}
        width={obj.width}
        height={obj.height}
        cornerRadius={obj.cornerRadius}
        opacity={frostedOpacitySimple}
        {...rectGradient}
        {...shadow}
      />
    );
  }

  return (
    <Group
      ref={grpRef}
      name={obj.id}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      draggable={!layerLocked}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        pickObject(obj.id, e.evt.shiftKey);
      }}
      onDragStart={dragSnap.onDragStart}
      onDragMove={dragSnap.onDragMove}
      onDragEnd={dragSnap.onDragEnd}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        pickObject(obj.id, false);
        onContextMenuObject(obj.id, e);
      }}
    >
      {fillBody}
      {obj.shapeText ? (
        <KonvaText
          ref={shapeTextRef}
          text={obj.shapeText}
          width={obj.width}
          height={obj.height}
          align="center"
          verticalAlign="middle"
          fontFamily={shapeTextTa.fontFamily}
          fontSize={shapeTextTa.fontSize}
          fontStyle={shapeKonvaFontStyle}
          letterSpacing={shapeLetterSp}
          fill={shapeTextTa.fill}
          opacity={shapeTextTa.opacity}
          x={obj.width / 2}
          y={obj.height / 2}
          offsetX={obj.width / 2}
          offsetY={obj.height / 2}
          rotation={obj.shapeTextFlipY ? 180 : 0}
          listening={false}
          {...shapeOutline}
          {...shapeShadow}
        />
      ) : null}
    </Group>
  );
}

function PathObjectNode({
  obj,
  pickObject,
  onContextMenuObject,
  registerNode,
  dragSnap,
  layerLocked,
  vectorEditLock = false,
  simplifyPreviewDim = false,
}: {
  obj: EditorPathObject;
  pickObject: (id: string, shiftKey: boolean) => void;
  onContextMenuObject: (objectId: string, e: Konva.KonvaEventObject<PointerEvent>) => void;
  registerNode: (id: string, n: Konva.Node | null) => void;
  dragSnap: EditorDragSnapHandlers;
  layerLocked: boolean;
  /** 矢量锚点编辑中时禁止拖移整层 */
  vectorEditLock?: boolean;
  /** 简化路径调整：压低图层可见度，预览叠在上面 */
  simplifyPreviewDim?: boolean;
}) {
  const grpRef = useRef<Konva.Group>(null);
  const [patternImage, setPatternImage] = useState<HTMLImageElement | null>(null);
  const [patternLoadFailed, setPatternLoadFailed] = useState(false);

  useEffect(() => {
    registerNode(obj.id, grpRef.current);
    return () => registerNode(obj.id, null);
  }, [obj.id, registerNode]);

  useEffect(() => {
    if (obj.fillKind !== 'pattern' || !obj.patternSrc?.trim()) {
      setPatternImage(null);
      setPatternLoadFailed(false);
      return;
    }
    let cancelled = false;
    const img = new Image();
    const src = obj.patternSrc;
    if (!src.startsWith('data:') && !src.startsWith('blob:')) {
      img.crossOrigin = 'anonymous';
    }
    img.onload = () => {
      if (!cancelled) {
        setPatternImage(img);
        setPatternLoadFailed(false);
      }
    };
    img.onerror = () => {
      if (!cancelled) {
        setPatternImage(null);
        setPatternLoadFailed(true);
      }
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [obj.fillKind, obj.patternSrc]);

  const usePatternFill =
    obj.fillKind === 'pattern' && !!obj.patternSrc?.trim() && patternImage && !patternLoadFailed;

  const parsedModel = useMemo(() => tryParsePathData(obj.pathData), [obj.pathData]);
  const nSub = parsedModel?.subpaths.length ?? 0;
  const useSplitPathRender =
    !!parsedModel &&
    !!obj.pathSubpathStyles &&
    obj.pathSubpathStyles.length === nSub &&
    nSub > 0;

  const pathsContentRef = useRef<Konva.Group>(null);

  useEffect(() => {
    const g = pathsContentRef.current;
    if (!g) return;
    g.clearCache();
    if (obj.blurRadius > 0) {
      g.filters([Konva.Filters.Blur]);
      g.blurRadius(obj.blurRadius);
      cacheAfterFilters(g, obj.blurRadius);
    } else {
      g.filters([]);
    }
  }, [
    obj.blurRadius,
    obj.pathData,
    obj.pathSubpathStyles,
    obj.fill,
    obj.fillKind,
    obj.patternSrc,
    patternImage,
    patternLoadFailed,
    obj.stroke,
    obj.strokeWidth,
    obj.opacity,
    simplifyPreviewDim,
    obj.width,
    obj.height,
    obj.naturalW,
    obj.naturalH,
    useSplitPathRender,
  ]);

  const sx = obj.naturalW > 0 ? obj.width / obj.naturalW : 1;
  const sy = obj.naturalH > 0 ? obj.height / obj.naturalH : 1;
  const pathBodyOpacity = simplifyPreviewDim ? Math.min(1, obj.opacity * 0.14) : obj.opacity;

  const patternCommon = usePatternFill
    ? {
        fillPriority: 'pattern' as const,
        fillPatternImage: patternImage!,
        fillPatternRepeat: 'no-repeat' as const,
        fillPatternX: 0,
        fillPatternY: 0,
        fillPatternScaleX: obj.naturalW / Math.max(1, patternImage!.naturalWidth || obj.naturalW),
        fillPatternScaleY: obj.naturalH / Math.max(1, patternImage!.naturalHeight || obj.naturalH),
      }
    : { fillPriority: 'color' as const };

  return (
    <Group
      ref={grpRef}
      name={obj.id}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      draggable={!layerLocked && !vectorEditLock}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        pickObject(obj.id, e.evt.shiftKey);
      }}
      onDragStart={dragSnap.onDragStart}
      onDragMove={dragSnap.onDragMove}
      onDragEnd={dragSnap.onDragEnd}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        pickObject(obj.id, false);
        onContextMenuObject(obj.id, e);
      }}
    >
      {/* 极低不透明度以便命中；复杂 Path 不参与 hit，避免 Konva 对海量曲线逐段检测导致卡顿 */}
      <Rect
        x={0}
        y={0}
        width={obj.width}
        height={obj.height}
        fill="rgba(0,0,0,0.02)"
        listening={!vectorEditLock}
      />
      <Group ref={pathsContentRef} scaleX={sx} scaleY={sy}>
        {useSplitPathRender && parsedModel ? (
          parsedModel.subpaths.map((sp, i) => {
            const d = serializeSubpathToD(sp);
            const ovr = obj.pathSubpathStyles![i]!;
            const fill = ovr.fill ?? obj.fill;
            const stroke = ovr.stroke ?? obj.stroke;
            const sw = ovr.strokeWidth ?? obj.strokeWidth;
            return (
              <Path
                key={i}
                data={d}
                fillRule="evenodd"
                fill={fill}
                {...patternCommon}
                stroke={sw > 0 && stroke !== 'transparent' ? stroke : undefined}
                strokeWidth={sw}
                strokeScaleEnabled={false}
                opacity={pathBodyOpacity}
                listening={false}
                perfectDrawEnabled={false}
                shadowForStrokeEnabled={false}
              />
            );
          })
        ) : (
          <Path
            data={obj.pathData}
            fillRule="evenodd"
            fill={obj.fill}
            {...patternCommon}
            stroke={obj.strokeWidth > 0 && obj.stroke !== 'transparent' ? obj.stroke : undefined}
            strokeWidth={obj.strokeWidth}
            strokeScaleEnabled={false}
            opacity={pathBodyOpacity}
            listening={false}
            perfectDrawEnabled={false}
            shadowForStrokeEnabled={false}
          />
        )}
      </Group>
    </Group>
  );
}

function TextObjectNode({
  obj,
  pickObject,
  onContextMenuObject,
  registerNode,
  dragSnap,
  layerLocked,
  fontFaces,
}: {
  obj: EditorTextObject;
  pickObject: (id: string, shiftKey: boolean) => void;
  onContextMenuObject: (objectId: string, e: Konva.KonvaEventObject<PointerEvent>) => void;
  registerNode: (id: string, n: Konva.Node | null) => void;
  dragSnap: EditorDragSnapHandlers;
  layerLocked: boolean;
  fontFaces: EditorFontFaceInfo[];
}) {
  const tRef = useRef<Konva.Text | null>(null);

  useEffect(() => {
    registerNode(obj.id, tRef.current);
    return () => registerNode(obj.id, null);
  }, [obj.id, registerNode]);

  const ta = textAppearanceFromTextObject(obj);
  const textFace = resolveTextFace(fontFaces, obj);
  const konvaFontStyle = konvaFontStyleFromFace(textFace);
  const letterSp = letterSpacingPxFromPercent(ta.letterSpacingPercent, ta.fontSize);
  const outline = obj.outlineEnabled
    ? {
        stroke: ta.outlineColor,
        strokeWidth: ta.outlineWidthPt,
        fillAfterStrokeEnabled: true as const,
      }
    : obj.textPreset === 'outline' && !obj.outlineEnabled
      ? { stroke: 'rgba(0,0,0,0.9)', strokeWidth: 3, fillAfterStrokeEnabled: true as const }
      : {};
  const dropShadow = obj.textShadowEnabled
    ? {
        shadowEnabled: true,
        shadowBlur: konvaShadowBlurFromBlurAndSpread(ta.textShadowBlurPt, ta.textShadowSpreadPt),
        shadowColor: ta.textShadowColor,
        shadowOffsetX: ta.textShadowOffsetX,
        shadowOffsetY: ta.textShadowOffsetY,
        shadowOpacity: ta.textShadowOpacity,
      }
    : { shadowEnabled: false };

  useEffect(() => {
    const t = tRef.current;
    if (!t) return;
    t.clearCache();
    if (obj.blurRadius > 0) {
      t.filters([Konva.Filters.Blur]);
      t.blurRadius(obj.blurRadius);
      cacheAfterFilters(t, obj.blurRadius);
    } else {
      t.filters([]);
    }
  }, [
    obj.blurRadius,
    obj.text,
    obj.fontSize,
    obj.fill,
    obj.textPreset,
    obj.fontFamily,
    obj.fontPostScriptName,
    obj.fontStyle,
    obj.fontWeight,
    obj.fontBold,
    obj.fontItalic,
    obj.outlineEnabled,
    obj.outlineColor,
    obj.outlineWidthPt,
    obj.letterSpacingPercent,
    obj.textShadowEnabled,
    obj.textShadowBlurPt,
    obj.textShadowOffsetX,
    obj.textShadowOffsetY,
    obj.textShadowSpreadPt,
    obj.textShadowOpacity,
    obj.textShadowColor,
  ]);

  return (
    <KonvaText
      ref={tRef}
      name={obj.id}
      text={obj.text}
      x={obj.x}
      y={obj.y}
      width={obj.width}
      height={obj.height}
      rotation={obj.rotation}
      fontSize={ta.fontSize}
      fontFamily={ta.fontFamily}
      fontStyle={konvaFontStyle}
      letterSpacing={letterSp}
      fill={ta.fill}
      opacity={ta.opacity}
      draggable={!layerLocked}
      onMouseDown={(e) => {
        e.cancelBubble = true;
        pickObject(obj.id, e.evt.shiftKey);
      }}
      onDragStart={dragSnap.onDragStart}
      onDragMove={dragSnap.onDragMove}
      onDragEnd={dragSnap.onDragEnd}
      onContextMenu={(e) => {
        e.evt.preventDefault();
        pickObject(obj.id, false);
        onContextMenuObject(obj.id, e);
      }}
      {...outline}
      {...dropShadow}
    />
  );
}

export const EditorCanvas = forwardRef<EditorCanvasHandle, EditorCanvasProps>(function EditorCanvas(
  {
    docWidth,
    docHeight,
    docBackgroundColor = 'transparent',
    objects,
    onObjectsChange,
    selectedIds,
    onSelectChange,
    zoom,
    viewPan = { x: 0, y: 0 },
    onViewPanGestureDelta,
    onZoomGestureAt,
    onContextMenu,
    onViewportSize,
    imageCropModeId = null,
    imageCropPreviewZoom = 1,
    canvasEditMode = false,
    adjustOverlayLock = false,
    canvasEditRect = null,
    onImageNaturalSize,
    cropOverlay,
    onBeforeObjectGesture,
    fontFaces = [],
    onDropImageFiles,
    pathSimplifyDimPathId = null,
    pathVectorEdit = null,
  },
  ref
) {
  const layerLocked = canvasEditMode || adjustOverlayLock;
  const pathVectorEditRef = useRef(pathVectorEdit);
  pathVectorEditRef.current = pathVectorEdit;
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  /** 避免父组件传入的非稳定回调导致 resize 引用变化，进而反复触发 ResizeObserver 的 effect */
  const onViewportSizeRef = useRef(onViewportSize);
  onViewportSizeRef.current = onViewportSize;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const docGroupRef = useRef<Konva.Group>(null);
  const checkerboardRef = useRef<Konva.Rect>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const nodeRefs = useRef<Record<string, Konva.Node>>({});
  const marqRef = useRef<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [marqueeUi, setMarqueeUi] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const viewLayoutRef = useRef({ cx: 0, cy: 0, z: 1 });
  const layerLockedRef = useRef(false);
  layerLockedRef.current = layerLocked;
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const onSelectChangeRef = useRef(onSelectChange);
  onSelectChangeRef.current = onSelectChange;
  const [snapGuides, setSnapGuides] = useState<{ vx: number[]; hy: number[] }>({ vx: [], hy: [] });

  const checkerPattern = useMemo(() => createKonvaCheckerboardTile(), []);

  /** 形状毛玻璃截取底层：任意图层 / 画布尺寸 / 底色变化时重算 */
  const frostedSceneKey = useMemo(
    () =>
      `${docWidth}:${docHeight}:${docBackgroundColor}:` +
      objects
        .map((o) =>
          [
            o.id,
            o.type,
            'x' in o ? o.x : '',
            'y' in o ? o.y : '',
            'width' in o ? o.width : '',
            'height' in o ? o.height : '',
            'rotation' in o ? o.rotation : '',
            o.type === 'image' ? String((o as EditorImageObject).src?.length ?? 0) : '',
          ].join(',')
        )
        .join('|'),
    [objects, docWidth, docHeight, docBackgroundColor]
  );

  const checkerDocRect = useMemo(() => {
    if (!canvasEditRect) {
      return { x: 0, y: 0, w: docWidth, h: docHeight };
    }
    const r = canvasEditRect;
    const bx0 = Math.min(0, r.x);
    const by0 = Math.min(0, r.y);
    const bx1 = Math.max(docWidth, r.x + r.w);
    const by1 = Math.max(docHeight, r.y + r.h);
    return { x: bx0, y: by0, w: bx1 - bx0, h: by1 - by0 };
  }, [canvasEditRect, docWidth, docHeight]);

  const registerNode = useCallback((id: string, n: Konva.Node | null) => {
    if (n) nodeRefs.current[id] = n;
    else delete nodeRefs.current[id];
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      exportDocPngDataUrl: (pixelRatio = 2) => {
        const g = docGroupRef.current;
        if (!g) return null;
        const dw = Math.max(1, Math.round(docWidth));
        const dh = Math.max(1, Math.round(docHeight));
        const clone = g.clone();
        clone.setAttrs({
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          clipX: 0,
          clipY: 0,
          clipWidth: dw,
          clipHeight: dh,
        });
        try {
          return clone.toDataURL({
            x: 0,
            y: 0,
            width: dw,
            height: dh,
            pixelRatio,
            mimeType: 'image/png',
          });
        } finally {
          clone.destroy();
        }
      },
      exportDocRasterDataUrl: (options = {}) => {
        const g = docGroupRef.current;
        if (!g) return null;
        const dw = Math.max(1, Math.round(docWidth));
        const dh = Math.max(1, Math.round(docHeight));
        const pixelRatio = options.pixelRatio ?? 2;
        const mimeType = options.mimeType ?? 'image/png';
        const quality = options.quality;
        const clone = g.clone();
        clone.setAttrs({
          x: 0,
          y: 0,
          scaleX: 1,
          scaleY: 1,
          clipX: 0,
          clipY: 0,
          clipWidth: dw,
          clipHeight: dh,
        });
        try {
          const cfg: {
            x: number;
            y: number;
            width: number;
            height: number;
            pixelRatio: number;
            mimeType: string;
            quality?: number;
          } = {
            x: 0,
            y: 0,
            width: dw,
            height: dh,
            pixelRatio,
            mimeType,
          };
          if (mimeType !== 'image/png' && quality != null) {
            cfg.quality = quality;
          }
          return clone.toDataURL(cfg);
        } finally {
          clone.destroy();
        }
      },
    }),
    [docWidth, docHeight]
  );

  const resize = useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const w = el.clientWidth;
    const h = el.clientHeight;
    setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    onViewportSizeRef.current?.(w, h);
  }, []);

  useEffect(() => {
    resize();
    const el = wrapRef.current;
    const ro = el ? new ResizeObserver(resize) : null;
    if (el && ro) ro.observe(el);
    return () => ro?.disconnect();
  }, [resize]);

  /** 触控板：双指滑动平移、Ctrl/⌘+双指捏合缩放；触摸屏：双指捏合 + 拖动 */
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || !onViewPanGestureDelta || !onZoomGestureAt) return;

    /** 触控板捏合：目标体感约 ±20%/次（相对原先 ~14% 按 20/14 抬高 delta）；单次事件倍率不超过 ±20% */
    const TRACKPAD_PINCH_DELTA = 0.0026 * (20 / 14);
    const TRACKPAD_PINCH_HI = 1.2;
    const TRACKPAD_PINCH_LO = 1 / TRACKPAD_PINCH_HI;
    /** 触摸屏双指：与触控板同量级；单帧倍率约 ±20% */
    const TOUCH_PINCH_GAIN = 1.38 * (20 / 14);
    const TOUCH_PINCH_FRAME_HI = 1.2;
    const TOUCH_PINCH_FRAME_LO = 1 / TOUCH_PINCH_FRAME_HI;

    const onWheel = (e: WheelEvent) => {
      const rect = el.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw <= 0 || vh <= 0) return;

      const isPinch = e.ctrlKey || e.metaKey;
      if (isPinch) {
        e.preventDefault();
        const raw = 1 - e.deltaY * TRACKPAD_PINCH_DELTA;
        const factor = Math.min(TRACKPAD_PINCH_HI, Math.max(TRACKPAD_PINCH_LO, raw));
        onZoomGestureAt(zoomRef.current * factor, sx, sy, vw, vh);
        return;
      }
      e.preventDefault();
      onViewPanGestureDelta(-e.deltaX, -e.deltaY);
    };

    type PinchState = { dist: number; midX: number; midY: number };
    let pinch: PinchState | null = null;

    const readPinch = (te: TouchEvent): PinchState | null => {
      if (te.touches.length !== 2) return null;
      const t0 = te.touches[0];
      const t1 = te.touches[1];
      if (!t0 || !t1) return null;
      const r = el.getBoundingClientRect();
      const midX = (t0.clientX + t1.clientX) / 2 - r.left;
      const midY = (t0.clientY + t1.clientY) / 2 - r.top;
      const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
      return { dist: Math.max(dist, 1e-6), midX, midY };
    };

    const onTouchStart = (e: TouchEvent) => {
      const p = readPinch(e);
      if (p) pinch = p;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !pinch) return;
      e.preventDefault();
      const next = readPinch(e);
      if (!next) return;
      const prev = pinch;
      const vw = el.clientWidth;
      const vh = el.clientHeight;
      if (vw > 0 && vh > 0 && prev.dist > 1e-6) {
        const scale = next.dist / prev.dist;
        const amplified = 1 + (scale - 1) * TOUCH_PINCH_GAIN;
        const frameScale = Math.min(TOUCH_PINCH_FRAME_HI, Math.max(TOUCH_PINCH_FRAME_LO, amplified));
        if (Math.abs(frameScale - 1) > 0.001) {
          onZoomGestureAt(zoomRef.current * frameScale, next.midX, next.midY, vw, vh);
        }
        onViewPanGestureDelta(next.midX - prev.midX, next.midY - prev.midY);
      }
      pinch = next;
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
    };

    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', onTouchEnd);
    el.addEventListener('touchcancel', onTouchEnd);

    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', onTouchEnd);
      el.removeEventListener('touchcancel', onTouchEnd);
    };
  }, [onViewPanGestureDelta, onZoomGestureAt]);

  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    if (imageCropModeId || layerLocked) {
      tr.nodes([]);
      tr.getLayer()?.batchDraw();
      return;
    }
    const nodes = selectedIds
      .filter((id) => id !== pathVectorEdit?.objectId)
      .filter((id) => {
        const o = objects.find((x) => x.id === id);
        return o && o.layerVisible !== false;
      })
      .map((id) => nodeRefs.current[id])
      .filter(Boolean) as Konva.Node[];
    tr.nodes(nodes);
    tr.getLayer()?.batchDraw();
  }, [selectedIds, objects, imageCropModeId, layerLocked, pathVectorEdit?.objectId]);

  const pickObject = useCallback((id: string, shiftKey: boolean) => {
    onSelectChange(shiftKey ? { type: 'toggle', id } : { type: 'set', ids: [id] });
  }, [onSelectChange]);

  const handleTransformEnd = useCallback(() => {
    const tr = trRef.current;
    if (!tr || layerLockedRef.current) return;
    const nodes = tr.nodes();
    if (nodes.length === 0) return;
    onObjectsChange((prev) => {
      const next = [...prev];
      for (const node of nodes) {
        const id = node.name();
        const idx = next.findIndex((o) => o.id === id);
        if (idx < 0) continue;
        const obj = next[idx]!;
        const sx = node.scaleX();
        const sy = node.scaleY();
        // 变换控件在换图/重绑时可能短暂得到 0 或 NaN 缩放，写回 state 后图层会「闪一下就没」
        if (
          !Number.isFinite(sx) ||
          !Number.isFinite(sy) ||
          Math.abs(sx) < 1e-6 ||
          Math.abs(sy) < 1e-6
        ) {
          node.scaleX(1);
          node.scaleY(1);
          continue;
        }
        if (obj.type === 'image') {
          const ki = node as Konva.Image;
          const im = ki.image();
          if (
            !im ||
            !(im instanceof HTMLImageElement) ||
            im.naturalWidth < 1 ||
            im.naturalHeight < 1
          ) {
            node.scaleX(1);
            node.scaleY(1);
            continue;
          }
        }
        const nx = node.x();
        const ny = node.y();
        const nrot = node.rotation();
        if (!Number.isFinite(nx) || !Number.isFinite(ny) || !Number.isFinite(nrot)) {
          node.scaleX(1);
          node.scaleY(1);
          continue;
        }
        node.scaleX(1);
        node.scaleY(1);
        const w = Math.max(8, obj.width * Math.abs(sx));
        const h = Math.max(8, obj.height * Math.abs(sy));
        /** 等比取较小边，避免单向压扁时字号暴涨 */
        const uniform = Math.min(Math.abs(sx), Math.abs(sy));
        const scaleFont = (fs: number) =>
          Math.max(8, Math.min(200, Math.round(fs * uniform * 10) / 10));
        const base: EditorObject = {
          ...obj,
          x: nx,
          y: ny,
          rotation: nrot,
          width: w,
          height: h,
        } as EditorObject;
        if (obj.type === 'text' && obj.fontSizeTracksBox) {
          (next[idx] as EditorObject) = { ...base, fontSize: scaleFont(obj.fontSize) };
        } else if (obj.type === 'shape' && obj.shapeTextFontSizeTracksBox) {
          (next[idx] as EditorObject) = { ...base, shapeTextFontSize: scaleFont(obj.shapeTextFontSize) };
        } else {
          next[idx] = base;
        }
      }
      return next;
    });
  }, [onObjectsChange]);

  const beginMarqueeFromPoint = useCallback((clientX: number, clientY: number) => {
    if (layerLockedRef.current) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const x0 = clientX - r.left;
    const y0 = clientY - r.top;
    const box = { x0, y0, x1: x0, y1: y0 };
    marqRef.current = box;
    setMarqueeUi({ ...box });

    const move = (ev: MouseEvent) => {
      if (!marqRef.current) return;
      const x1 = ev.clientX - r.left;
      const y1 = ev.clientY - r.top;
      marqRef.current = { ...marqRef.current, x1, y1 };
      setMarqueeUi({ ...marqRef.current });
    };
    const up = (ev: MouseEvent) => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      const b = marqRef.current;
      marqRef.current = null;
      setMarqueeUi(null);
      if (!b || layerLockedRef.current) return;
      const mw = Math.abs(b.x1 - b.x0);
      const mh = Math.abs(b.y1 - b.y0);
      if (mw < 5 && mh < 5) {
        const pv = pathVectorEditRef.current;
        if (pv) {
          pv.onUiChange({ activeSubpaths: [], selectedVertices: [] });
        } else if (!ev.shiftKey) {
          onSelectChangeRef.current({ type: 'set', ids: [] });
        }
        return;
      }
      const { cx: lcx, cy: lcy, z: lz } = viewLayoutRef.current;
      const docM = docMarqueeFromScreen(b.x0, b.y0, b.x1, b.y1, lcx, lcy, lz);
      const pv = pathVectorEditRef.current;
      if (pv?.onMarqueeSelectSubpaths) {
        pv.onMarqueeSelectSubpaths(docM, ev.shiftKey);
        return;
      }
      const hits = objectsRef.current
        .filter((o) => o.layerVisible !== false && aabbIntersects(objectRotatedBounds(o), docM))
        .map((o) => o.id);
      if (ev.shiftKey) onSelectChangeRef.current({ type: 'add', ids: hits });
      else onSelectChangeRef.current({ type: 'set', ids: hits });
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  }, []);

  const onContextMenuObject = useCallback(
    (objectId: string, e: Konva.KonvaEventObject<PointerEvent>) => {
      const ev = e.evt;
      onContextMenu({ x: ev.clientX, y: ev.clientY, objectId });
    },
    [onContextMenu]
  );

  const buildSnapTargets = useCallback(
    (excludeId: string) => {
      const g = docGroupRef.current;
      const xs = [0, docWidth / 2, docWidth];
      const ys = [0, docHeight / 2, docHeight];
      if (!g) return { xs, ys };
      for (const o of objects) {
        if (o.id === excludeId) continue;
        if (o.layerVisible === false) continue;
        const n = nodeRefs.current[o.id];
        if (!n) continue;
        const r = n.getClientRect({ relativeTo: g });
        xs.push(r.x, r.x + r.width / 2, r.x + r.width);
        ys.push(r.y, r.y + r.height / 2, r.y + r.height);
      }
      return { xs, ys };
    },
    [objects, docWidth, docHeight]
  );

  const makeDragSnapHandlers = useCallback(
    (id: string): EditorDragSnapHandlers => ({
      onDragStart: () => {
        if (!layerLockedRef.current) onBeforeObjectGesture?.();
        setSnapGuides({ vx: [], hy: [] });
      },
      onDragMove: (e) => {
        const node = e.target;
        const g = docGroupRef.current;
        if (!g) return;
        const rect = node.getClientRect({ relativeTo: g });
        const { xs, ys } = buildSnapTargets(id);
        const thresholdDoc = EDITOR_SNAP_SCREEN_PX / Math.max(zoom, 0.01);
        const { dx, dy, guides } = snapDragRect(rect, xs, ys, thresholdDoc);
        if (dx !== 0 || dy !== 0) {
          node.x(node.x() + dx);
          node.y(node.y() + dy);
        }
        setSnapGuides(guides);
      },
      onDragEnd: (e) => {
        setSnapGuides({ vx: [], hy: [] });
        const n = e.target;
        onObjectsChange((prev) => prev.map((o) => (o.id === id ? { ...o, x: n.x(), y: n.y() } : o)));
      },
    }),
    [buildSnapTargets, zoom, onObjectsChange, onBeforeObjectGesture]
  );

  const guideStroke = 1 / Math.max(zoom, 0.01);

  const cx = Math.max(0, (size.w - docWidth * zoom) / 2) + viewPan.x;
  const cy = Math.max(0, (size.h - docHeight * zoom) / 2) + viewPan.y;
  viewLayoutRef.current = { cx, cy, z: zoom };

  return (
    <div
      ref={wrapRef}
      className="yiman-image-editor-canvas-wrap"
      data-yiman-canvas-wrap=""
      onDragOverCapture={(e) => {
        if (layerLocked || !onDropImageFiles) return;
        const dt = e.dataTransfer;
        const hasFiles =
          dt.types.includes('Files') ||
          dt.types.includes('application/x-moz-file') ||
          Array.from(dt.items ?? []).some((it) => it.kind === 'file');
        if (!hasFiles) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDropCapture={(e) => {
        if (layerLocked || !onDropImageFiles) return;
        const files = e.dataTransfer.files;
        if (!files?.length) return;
        const imageFiles = Array.from(files).filter(
          (f) => f.type.startsWith('image/') || /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(f.name)
        );
        if (!imageFiles.length) return;
        e.preventDefault();
        e.stopPropagation();
        const el = wrapRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const { cx: vtx, cy: vty, z } = viewLayoutRef.current;
        const lx = e.clientX - rect.left;
        const ly = e.clientY - rect.top;
        const docX = (lx - vtx) / Math.max(z, 1e-6);
        const docY = (ly - vty) / Math.max(z, 1e-6);
        onDropImageFiles(imageFiles, { x: docX, y: docY });
      }}
    >
      <Stage
        width={size.w}
        height={size.h}
        onMouseDown={(e) => {
          if (layerLocked) return;
          const stage = e.target.getStage();
          if (!stage || e.target !== stage) return;
          beginMarqueeFromPoint(e.evt.clientX, e.evt.clientY);
        }}
      >
        <Layer>
          {/* 棋盘格在舞台像素空间绘制；画布编辑时可延伸至裁剪框并集 */}
          <Group x={cx + checkerDocRect.x * zoom} y={cy + checkerDocRect.y * zoom} listening={false}>
            <Rect
              ref={checkerboardRef}
              x={0}
              y={0}
              width={checkerDocRect.w * zoom}
              height={checkerDocRect.h * zoom}
              fillPatternImage={checkerPattern as unknown as HTMLImageElement}
              fillPatternRepeat="repeat"
              listening={false}
            />
          </Group>
          <Group x={cx} y={cy} scaleX={zoom} scaleY={zoom} ref={docGroupRef}>
            <Rect
              name="doc-bg"
              x={0}
              y={0}
              width={docWidth}
              height={docHeight}
              fill={docBackgroundToKonvaFill(docBackgroundColor)}
              onMouseDown={(e) => {
                if (layerLocked) return;
                e.cancelBubble = true;
                beginMarqueeFromPoint(e.evt.clientX, e.evt.clientY);
              }}
            />
            {objects.map((obj) => {
              const dragSnap = makeDragSnapHandlers(obj.id);
              const shown = obj.layerVisible !== false;
              let inner: React.ReactNode;
              if (obj.type === 'image')
                inner = (
                  <ImageObjectNode
                    obj={obj}
                    pickObject={pickObject}
                    onContextMenuObject={onContextMenuObject}
                    registerNode={registerNode}
                    dragSnap={dragSnap}
                    cropMode={imageCropModeId === obj.id}
                    cropPreviewZoom={imageCropPreviewZoom}
                    layerLocked={layerLocked}
                    onImageNaturalSize={onImageNaturalSize}
                  />
                );
              else if (obj.type === 'shape')
                inner = (
                  <ShapeObjectNode
                    obj={obj}
                    pickObject={pickObject}
                    onContextMenuObject={onContextMenuObject}
                    registerNode={registerNode}
                    dragSnap={dragSnap}
                    layerLocked={layerLocked}
                    frostedSceneKey={frostedSceneKey}
                    fontFaces={fontFaces}
                  />
                );
              else if (obj.type === 'path')
                inner = (
                  <PathObjectNode
                    obj={obj}
                    pickObject={pickObject}
                    onContextMenuObject={onContextMenuObject}
                    registerNode={registerNode}
                    dragSnap={dragSnap}
                    layerLocked={layerLocked}
                    vectorEditLock={pathVectorEdit?.objectId === obj.id}
                    simplifyPreviewDim={pathSimplifyDimPathId === obj.id}
                  />
                );
              else
                inner = (
                  <TextObjectNode
                    obj={obj}
                    pickObject={pickObject}
                    onContextMenuObject={onContextMenuObject}
                    registerNode={registerNode}
                    dragSnap={dragSnap}
                    layerLocked={layerLocked}
                    fontFaces={fontFaces}
                  />
                );
              return (
                <Group key={obj.id} visible={shown} listening={shown}>
                  {inner}
                </Group>
              );
            })}
          </Group>
          {/* 矢量编辑 UI 与 doc 同变换，但不放入 docGroupRef，避免导出栅格/SVG 混入辅助线 */}
          <Group x={cx} y={cy} scaleX={zoom} scaleY={zoom} listening>
            {pathVectorEdit
              ? (() => {
                  const po = objects.find(
                    (o) => o.id === pathVectorEdit.objectId && o.type === 'path'
                  ) as EditorPathObject | undefined;
                  if (!po) return null;
                  return (
                    <PathVectorEditOverlay
                      obj={po}
                      zoom={zoom}
                      ui={pathVectorEdit.ui}
                      onUiChange={pathVectorEdit.onUiChange}
                      onCommitPathData={pathVectorEdit.onCommitPathData}
                      onGestureStart={pathVectorEdit.onGestureStart}
                      simplifyPreview={pathVectorEdit.simplifyPreview ?? null}
                      suspendInteraction={!!pathVectorEdit.suspendVectorInteraction}
                    />
                  );
                })()
              : null}
          </Group>
          {/* 吸附辅助线：与 doc 同变换，且不放在 docGroupRef 内以免导出 PNG 混入 */}
          <Group x={cx} y={cy} scaleX={zoom} scaleY={zoom} listening={false}>
            {snapGuides.vx.map((xv, i) => (
              <Line
                key={`sgv-${i}-${xv}`}
                points={[xv, 0, xv, docHeight]}
                stroke="rgba(23, 119, 255, 0.92)"
                strokeWidth={guideStroke}
                listening={false}
              />
            ))}
            {snapGuides.hy.map((yh, i) => (
              <Line
                key={`sgh-${i}-${yh}`}
                points={[0, yh, docWidth, yh]}
                stroke="rgba(23, 119, 255, 0.92)"
                strokeWidth={guideStroke}
                listening={false}
              />
            ))}
          </Group>
          <Transformer
            ref={trRef}
            rotateEnabled
            borderStroke="#1777ff"
            anchorStroke="#1777ff"
            onTransformStart={() => {
              if (!layerLockedRef.current) onBeforeObjectGesture?.();
            }}
            onTransformEnd={handleTransformEnd}
            boundBoxFunc={(oldBox, newBox) => {
              if (newBox.width < 10 || newBox.height < 10) return oldBox;
              return newBox;
            }}
          />
          {marqueeUi ? (
            <Rect
              x={Math.min(marqueeUi.x0, marqueeUi.x1)}
              y={Math.min(marqueeUi.y0, marqueeUi.y1)}
              width={Math.abs(marqueeUi.x1 - marqueeUi.x0)}
              height={Math.abs(marqueeUi.y1 - marqueeUi.y0)}
              stroke="rgba(23, 119, 255, 0.95)"
              strokeWidth={1}
              fill="rgba(23, 119, 255, 0.12)"
              listening={false}
            />
          ) : null}
        </Layer>
      </Stage>
      {cropOverlay}
    </div>
  );
});
