/**
 * 图片编辑器页面：状态、模态框、导出与素材操作
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { App, Modal, Form, InputNumber, Select, Input, Spin, Space, Radio, Switch, Button } from 'antd';
import { useNavigate, useLocation } from 'react-router-dom';
import {
  IMAGE_EDITOR_PRESETS,
  IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND,
  editorImageFillDocument,
  editorPathFillDocument,
  editorPathLayerContainAt,
  editorPathLayerContainCentered,
  editorPathLayerNaturalAt,
  editorPathLayerNaturalCentered,
  imageFitsInsideDoc,
  imageLayerNaturalAt,
  imageLayerNaturalCentered,
  imageLayerContainAt,
  imageLayerContainCentered,
  defaultText,
  editorDefaultFontFamily,
  defaultEditorPathFromTrace,
  type EditorObject,
  type EditorImageObject,
  type EditorPathObject,
  type EditorShapeObject,
  type PathSubpathStyleOverride,
  ensureEditorPathSubpathStyles,
} from './editorTypes';
import { cloneDocSnapshot, type EditorDocSnapshot } from './editorHistory';
import { renderShapeMaskedImagePng } from './editorShapeMask';
import { rasterizeEditorImageForPotrace } from './editorImageRasterForTrace';
import { traceDataUrlToSvgPathResult, DEFAULT_POTRACE_OPTIONS } from '@/utils/potraceCore';
import { imageSrcToKnockoutWhiteDataUrl } from '@/utils/knockoutImageWhite';
import { dominantRgbCssFromImageAndPath } from '@/utils/dominantColorFromPath';
import { EditorHeader } from './EditorHeader';
import { EditorWorkspace } from './EditorWorkspace';
import { EditorInspector } from './EditorInspector';
import { EditorCanvas, type EditorCanvasHandle, type EditorSelectAction } from './EditorCanvas';
import type { EditorFontFaceInfo } from './textAppearance';
import { alignSelectedObjects, distributeSelectedObjects, type AlignKind, type DistributeKind } from './editorAlignDistribute';
import { ImageCropOverlay, type ImageCropSession } from './ImageCropOverlay';
import { CanvasCropOverlay, type CanvasEditSession } from './CanvasCropOverlay';
import {
  applyZoomAroundCenter,
  cropDocRectsApproxEqual,
  getFullImageDisplayFrameInDoc,
  getInitialCropDocRectFromLayer,
  mapDocCropRectToSourceCrop,
} from './imageCropHelpers';
import { removeWhiteBackdropFromDataUrl } from '@/utils/instantTransparencyMatting';
import { MattingSettingsPanel } from '@/components/character/MattingSettingsPanel';
// 蘑菇鸭：AI 生图暂时搁置，不引入 imageEditorAi / useAgentModel（依赖 AIChat 子树）。
// TODO: AI 生图后续接入时恢复 import { generateDrawerImageForEditor } from './imageEditorAi';
import type { AIModelConfig } from '@/types/settings';
import './imageEditor.css';
import { zoomAroundScreenPoint } from './editorViewGestures';
import { useImageEditorZoomHeaderDisplay } from './useImageEditorZoomHeader';
import { getEditorObjectsDocBounds } from './editorContentBounds';
import { computeImageFitToCanvasLayout, getImageIntrinsicAspectRatio } from './imageEditorFitHelpers';
import {
  FitContentToolbar,
  FitImageToCanvasToolbar,
  LamaEraseAdjustToolbar,
  PotraceAdjustToolbar,
  POTRACE_PRESETS,
  type PotracePresetId,
  PotracePreviewOverlay,
  RemoveWhiteAdjustToolbar,
  PathSimplifyAdjustToolbar,
  ZoomBlurAdjustToolbar,
} from './ImageEditorAdjustToolbars';
import { ZoomBlurOriginOverlay } from './ZoomBlurOriginOverlay';
import { LamaErasePaintOverlay, type LamaErasePaintOverlayHandle } from './LamaErasePaintOverlay';
import { inpaintViaLamaCleaner } from './lamaInpaintApi';
import { renderZoomBlurDataUrl, ZOOM_BLUR_SAMPLE_STEPS_DEFAULT } from './zoomBlurImage';
import { createShapeFromPreset, type ShapePresetId } from './editorShapePresets';
import { computeImageTrimTransparentPaddingPatch } from './imageTrimTransparentEdges';
import { ImageEditorExportModal } from './ImageEditorExportModal';
import type { PathVertexKey } from './PathVectorEditOverlay';
import {
  tryParsePathData,
  pathDataFromModel,
  setVertexCorner,
  pathDataEditable,
  deleteVerticesAt,
  insertVertexMidEdgeOnSubpath,
  subpathNextVertexIndex,
  areVerticesAdjacentOnSubpath,
  edgeStartForAdjacentPair,
  removeSubpathsFromModel,
  serializeSubpathToD,
} from '@/utils/svgPathEditModel';
import { mergeSubpathsToD, simplifySubpathsByPercent } from '@/utils/pathSubpathSimplify';
import { pathBooleanPathData, type PathBooleanOp } from '@/utils/pathBooleanPaper';
import { subpathIndicesIntersectingDocRect } from '@/utils/pathVectorSubpathDocBounds';
import { EDITOR_IMAGE_DIALOG_FILTER } from '@/utils/editorImageImportPaths';
import { loadImageSize } from '@/utils/loadImageSize';
import { tryDecodeSvgTextFromSrc } from '@/utils/decodeSvgTextFromSrc';
import { importSvgTextToEditorPathPayload, type EditorSvgImportPathPayload } from '@/utils/editorSvgImportPaper';

/** 原色 pattern → 分路径纯色（按子路径轮廓在原 pattern 内取色） */
async function subpathStylesFromPatternDominants(
  obj: EditorPathObject,
  patternSrc: string
): Promise<PathSubpathStyleOverride[] | null> {
  const model = tryParsePathData(obj.pathData);
  if (!model) return null;
  const styles = ensureEditorPathSubpathStyles(
    { ...obj, fillKind: 'solid', patternSrc: undefined },
    model.subpaths.length
  );
  const fills = await Promise.all(
    model.subpaths.map(async (sp) => {
      const d = serializeSubpathToD(sp)?.trim();
      if (!d) return null;
      return dominantRgbCssFromImageAndPath(patternSrc, d, obj.naturalW, obj.naturalH);
    })
  );
  for (let i = 0; i < styles.length; i++) {
    const c = fills[i];
    if (c) styles[i] = { ...styles[i], fill: c };
  }
  return styles;
}

interface ProjectRow {
  id: string;
  name: string;
  project_dir: string;
}

type RemoveWhiteAdjustSession = {
  objectId: string;
  tolerance: number;
  originalSrc: string;
  /** 仅对白/浅灰合成色做反解，缩小作用域 */
  whiteGrayOnly: boolean;
};

type PotraceSession = {
  objectId: string;
  threshold: number;
  useOtsu: boolean;
  turdSize: number;
  simplifyEpsilon: number;
  curveTension: number;
  /** °，邻边转角 ≥ 此值则打断平滑；0 为整圈旧版 Catmull-Rom */
  cornerAngleThreshold: number;
  adaptiveSimplify: boolean;
  /** 原色填充：pattern 对齐位图保留多色 */
  preserveColor: boolean;
  /** 矢量化时强制高亮像素为背景 */
  ignoreWhite: boolean;
  /** 二值前景腐蚀次数，削弱锯齿白边 */
  edgeErosionPasses: number;
  /** min(R,G,B) ≥ 此值的前景改背景，0 关；彩色抗锯齿可试 180–220 */
  fringeSuppressMinRgb: number;
  previewPathData: string | null;
  traceW: number;
  traceH: number;
  docRect: { x: number; y: number; width: number; height: number };
};

type ZoomBlurAdjustSession = {
  objectId: string;
  originalSrc: string;
  /** 进入会话时图层的 sourceCrop 快照（预览/应用均以此为准） */
  sourceCrop?: EditorImageObject['sourceCrop'];
  /** 相对图层局部宽高的缩放原点 0…1 */
  originXN: number;
  originYN: number;
  /** 模糊强度 0…100（百分比） */
  radiusPercent: number;
  /** 径向采样步数上限（越大越细腻、越慢） */
  sampleStepsMax: number;
};

type LamaEraseAdjustSession = {
  objectId: string;
  /** 进入时的位图，inpaint 始终以此为输入 */
  originalSrc: string;
  sourceCrop?: EditorImageObject['sourceCrop'];
  imagePixelW: number;
  imagePixelH: number;
  brushRadiusPx: number;
  baseUrl: string;
};

type FitImageToCanvasAdjustSession = {
  objectId: string;
  edgePadding: number;
  maintainAspect: boolean;
  snapshot: { x: number; y: number; width: number; height: number };
  intrinsicAspect: number;
};

type FitContentAdjustSession = {
  edgePadding: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  snapshot: { docWidth: number; docHeight: number; objects: EditorObject[] };
};

type PathVectorEditSession = {
  objectId: string;
  activeSubpaths: number[];
  selectedVertices: PathVertexKey[];
};

/** 撤销/重做恢复 pathData 后，将矢量编辑会话里的子路径/锚点下标钳到当前模型，避免无效引用 */
function clampPathVectorEditSessionToPathData(
  session: PathVectorEditSession,
  pathData: string
): PathVectorEditSession | null {
  const model = tryParsePathData(pathData);
  if (!model) return null;
  const n = model.subpaths.length;
  const activeSubpaths = [...new Set(session.activeSubpaths)]
    .filter((i) => i >= 0 && i < n)
    .sort((a, b) => a - b);
  const selectedVertices = session.selectedVertices.filter((k) => {
    if (k.subpathIndex < 0 || k.subpathIndex >= n) return false;
    const sp = model.subpaths[k.subpathIndex];
    if (!sp) return false;
    return k.vertexIndex >= 0 && k.vertexIndex < sp.verts.length;
  });
  return {
    objectId: session.objectId,
    activeSubpaths,
    selectedVertices,
  };
}

type LargeImageInsertChoice =
  | { kind: 'original'; autoEnlargeCanvas: boolean }
  | { kind: 'fit' };

type InsertLoadedImageResult = {
  layer: EditorImageObject;
  docW: number;
  docH: number;
  /** 大图且选「原始尺寸」插入后，将视口设为适合画布（与打开本地图一致） */
  zoomFitViewport?: boolean;
};

type InsertLoadedPathResult = {
  layer: EditorPathObject;
  docW: number;
  docH: number;
  zoomFitViewport?: boolean;
};

/** SVG 合并子路径后，子路径数与 pathSubpathStyles 不一致时退回顶层样式，避免侧栏/编辑错位 */
function finalizeSvgImportedPathLayer(layer: EditorPathObject): EditorPathObject {
  const model = tryParsePathData(layer.pathData);
  const st = layer.pathSubpathStyles;
  if (model && st && st.length !== model.subpaths.length) {
    const top = st[0];
    return {
      ...layer,
      pathSubpathStyles: undefined,
      fill: top?.fill ?? layer.fill,
      stroke: top?.stroke ?? layer.stroke,
      strokeWidth: top?.strokeWidth ?? layer.strokeWidth,
    };
  }
  return layer;
}

function readBrowserFileAsUtf8(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

function stripDataUrlToBase64(s: string): string {
  const i = s.indexOf('base64,');
  return i >= 0 ? s.slice(i + 7) : s;
}

/** 导出默认名用：不含年份，精确到秒（月日_时分秒） */
function formatExportUnnamedStem(): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const d = new Date();
  return `未命名_${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function sanitizeExportBasename(name: string): string {
  const t = name.replace(/[/\\?%*:|"<>]/g, '_').trim();
  return t.length > 0 ? t : '未命名';
}

function stripImageExtension(name: string): string {
  return name.replace(/\.(png|jpe?g|gif|webp|bmp)$/i, '');
}

/** 本地路径或文件名 → 导出用主文件名（无扩展名） */
function filePathOrNameToExportStem(pathOrName: string): string {
  const base = pathOrName.split(/[/\\]/).pop() ?? pathOrName;
  return sanitizeExportBasename(stripImageExtension(base));
}

export const ImageEditorPage: React.FC = () => {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const canvasRef = useRef<EditorCanvasHandle>(null);

  const [docWidth, setDocWidth] = useState(1024);
  const [docHeight, setDocHeight] = useState(768);
  const [docBackgroundColor, setDocBackgroundColor] = useState<string>(IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND);
  const [objects, setObjects] = useState<EditorObject[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const onSelectChange = useCallback((action: EditorSelectAction) => {
    setSelectedIds((prev) => {
      switch (action.type) {
        case 'set':
          return action.ids;
        case 'toggle':
          return prev.includes(action.id) ? prev.filter((x) => x !== action.id) : [...prev, action.id];
        case 'add':
          return [...new Set([...prev, ...action.ids])];
        default:
          return prev;
      }
    });
  }, []);
  const [zoomMode, setZoomMode] = useState<'fit' | 'fixed'>('fixed');
  const [viewport, setViewport] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(0.5);
  /** 相对「居中」原点的屏幕像素平移（触控板双指滑动 / 触摸） */
  const [viewPan, setViewPan] = useState({ x: 0, y: 0 });
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const viewPanRef = useRef(viewPan);
  viewPanRef.current = viewPan;

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [assetProjectDir, setAssetProjectDir] = useState<string | null>(null);
  const [mattingPanel, setMattingPanel] = useState<{ objectId: string } | null>(null);
  /** 蘑菇鸭历史项目：从列表页打开时写入 */
  const [historyProjectId, setHistoryProjectId] = useState<string | null>(null);
  const [historyProjectName, setHistoryProjectName] = useState('未命名项目');

  const [newCanvasOpen, setNewCanvasOpen] = useState(false);
  const [assetPickOpen, setAssetPickOpen] = useState(false);
  /** 导出对话框默认文件名（不含 .png） */
  const [exportDefaultStem, setExportDefaultStem] = useState(() => formatExportUnnamedStem());
  /** 有本地源路径时用于在打开「保存为」前在同目录预计算不冲突的默认文件名；无则仅传文件名给对话框 */
  const [exportDefaultDir, setExportDefaultDir] = useState<string | null>(null);
  const [exportModalOpen, setExportModalOpen] = useState(false);
  const [pathVectorEditSession, setPathVectorEditSession] = useState<PathVectorEditSession | null>(null);
  const pathVectorEditSessionRef = useRef<PathVectorEditSession | null>(null);
  pathVectorEditSessionRef.current = pathVectorEditSession;

  type PathSimplifySession = {
    objectId: string;
    subpathIndices: number[];
    baselinePathData: string;
    curvePrecisionPercent: number;
  };
  const [pathSimplifySession, setPathSimplifySession] = useState<PathSimplifySession | null>(null);
  const onPathVectorDeleteActiveSubpathsRef = useRef<() => void>(() => {});
  const [aiOpen, setAiOpen] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [imageProcessing, setImageProcessing] = useState(false);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; objectId: string } | null>(null);

  const [fonts, setFonts] = useState<string[]>([
    editorDefaultFontFamily(),
    'Helvetica Neue',
    'Arial',
    'sans-serif',
  ]);
  const [fontFaces, setFontFaces] = useState<EditorFontFaceInfo[]>([]);

  const [settingsModels, setSettingsModels] = useState<AIModelConfig[] | undefined>();
  // 蘑菇鸭：AI 生图搁置，drawerModelCheck 退化为常量（model 始终为 undefined，AI 弹窗 onOk 会提前 return）。
  const drawerModelCheck = {
    model: undefined as undefined | AIModelConfig,
    hasValidModel: false,
    missingCapabilityLabels: [] as string[],
  };

  const [formNew] = Form.useForm<{ preset: string; w: number; h: number }>();
  const [formAi] = Form.useForm<{ prompt: string }>();
  const [formSave] = Form.useForm<{ projectDir: string }>();
  const [formLargeInsert] = Form.useForm<{
    insertMode: 'original' | 'fit';
    autoEnlargeCanvas: boolean;
  }>();
  const [largeInsertModalOpen, setLargeInsertModalOpen] = useState(false);
  const [largeInsertInfo, setLargeInsertInfo] = useState<{
    iw: number;
    ih: number;
    docW: number;
    docH: number;
  } | null>(null);
  const largeInsertResolveRef = useRef<((v: LargeImageInsertChoice | null) => void) | null>(null);
  const [saveToAssetOpen, setSaveToAssetOpen] = useState(false);
  const [imageCropSession, setImageCropSession] = useState<ImageCropSession | null>(null);
  const [canvasEditSession, setCanvasEditSession] = useState<CanvasEditSession | null>(null);
  const [removeWhiteSession, setRemoveWhiteSession] = useState<RemoveWhiteAdjustSession | null>(null);
  const [removeWhitePreviewTick, setRemoveWhitePreviewTick] = useState(0);
  /** 每张图上次「应用」移除白色时的选项，供再次打开调整条时恢复 */
  const lastRemoveWhiteAdjustByIdRef = useRef<Record<string, { tolerance: number; whiteGrayOnly: boolean }>>({});
  const rwPreviewReqIdRef = useRef(0);
  const removeWhitePreviewRef = useRef<RemoveWhiteAdjustSession | null>(null);
  removeWhitePreviewRef.current = removeWhiteSession;
  const [potraceSession, setPotraceSession] = useState<PotraceSession | null>(null);
  const [potracePreviewTick, setPotracePreviewTick] = useState(0);
  const potraceSessionRef = useRef<PotraceSession | null>(null);
  potraceSessionRef.current = potraceSession;
  const potraceReqIdRef = useRef(0);
  /** 保留颜色 + 忽略白色时：knock-out 后的 PNG，供预览纹理与主色近似采样 */
  const [potraceKnockoutPatternUrl, setPotraceKnockoutPatternUrl] = useState<string | null>(null);
  const [potraceDominantPreviewCss, setPotraceDominantPreviewCss] = useState<string | null>(null);
  /** 矢量化输入：当前图层 src + sourceCrop（遮罩裁切后仍用整图 src 时需据此栅格） */
  const potraceTraceSourceKey = useMemo(() => {
    const oid = potraceSession?.objectId;
    if (!oid) return null;
    const o = objects.find((x): x is EditorImageObject => x.id === oid && x.type === 'image');
    if (!o) return null;
    return `${o.src}\0${JSON.stringify(o.sourceCrop ?? null)}`;
  }, [potraceSession?.objectId, objects]);
  const [fitImageSession, setFitImageSession] = useState<FitImageToCanvasAdjustSession | null>(null);
  const [fitContentSession, setFitContentSession] = useState<FitContentAdjustSession | null>(null);
  const [shapeMaskLoading, setShapeMaskLoading] = useState(false);
  const [zoomBlurSession, setZoomBlurSession] = useState<ZoomBlurAdjustSession | null>(null);
  const zoomBlurReqIdRef = useRef(0);
  const zoomBlurSessionRef = useRef<ZoomBlurAdjustSession | null>(null);
  zoomBlurSessionRef.current = zoomBlurSession;
  const lastZoomBlurByIdRef = useRef<
    Record<
      string,
      { originXN: number; originYN: number; radiusPercent: number; sampleStepsMax: number }
    >
  >({});

  const [lamaEraseSession, setLamaEraseSession] = useState<LamaEraseAdjustSession | null>(null);
  const [lamaEraseResultUrl, setLamaEraseResultUrl] = useState<string | null>(null);
  const [lamaEraseBusy, setLamaEraseBusy] = useState(false);
  const [lamaInstallModalOpen, setLamaInstallModalOpen] = useState(false);
  const [lamaHasMask, setLamaHasMask] = useState(false);
  const lamaPendingIdRef = useRef<string | null>(null);
  const lamaPaintRef = useRef<LamaErasePaintOverlayHandle | null>(null);

  const exitLamaEraseSession = useCallback(() => {
    setLamaEraseSession(null);
    setLamaEraseResultUrl(null);
    setLamaHasMask(false);
  }, []);

  const closeZoomBlurDiscardPreview = useCallback(() => {
    const zb = zoomBlurSessionRef.current;
    if (!zb) return;
    zoomBlurReqIdRef.current += 1;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === zb.objectId && o.type === 'image'
          ? {
              ...o,
              src: zb.originalSrc,
              sourceCrop: zb.sourceCrop ? { ...zb.sourceCrop } : undefined,
            }
          : o
      )
    );
    setZoomBlurSession(null);
  }, []);

  const docStateRef = useRef({
    docWidth,
    docHeight,
    docBackgroundColor,
    objects,
  });
  useEffect(() => {
    docStateRef.current = { docWidth, docHeight, docBackgroundColor, objects };
  });

  const isUndoRedoRef = useRef(false);
  const historyPastRef = useRef<EditorDocSnapshot[]>([]);
  const historyFutureRef = useRef<EditorDocSnapshot[]>([]);
  const [historyTick, setHistoryTick] = useState(0);

  const recordHistory = useCallback(() => {
    if (isUndoRedoRef.current) return;
    const s = docStateRef.current;
    historyPastRef.current = [
      ...historyPastRef.current.slice(-49),
      cloneDocSnapshot({
        docWidth: s.docWidth,
        docHeight: s.docHeight,
        docBackgroundColor: s.docBackgroundColor,
        objects: s.objects,
      }),
    ];
    historyFutureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  const clearHistoryStacks = useCallback(() => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    setHistoryTick((t) => t + 1);
  }, []);

  /** 从项目列表打开：读取路由 state / sessionStorage 中的项目 id 并加载文档。
   * 注意：StrictMode 会双挂载；必须等加载成功后再清掉 id，否则第二次挂载会丢项目。 */
  useEffect(() => {
    const fromState =
      location.state && typeof location.state === 'object' && 'openProjectId' in location.state
        ? String((location.state as { openProjectId?: string }).openProjectId ?? '')
        : '';
    const id = fromState || sessionStorage.getItem('mogoyya:openProjectId') || '';
    if (!id || !window.yiman?.imageProjects) return;

    let cancelled = false;
    (async () => {
      const doc = await window.yiman!.imageProjects.loadDoc(id);
      if (cancelled) return;
      if (!doc.ok) {
        message.error(doc.error ?? '加载项目失败');
        return;
      }
      sessionStorage.removeItem('mogoyya:openProjectId');
      // 清掉 state，避免返回后再进编辑器重复加载
      navigate(location.pathname, { replace: true, state: null });
      clearHistoryStacks();
      setHistoryProjectId(id);
      setHistoryProjectName(doc.name);
      setDocWidth(doc.docWidth);
      setDocHeight(doc.docHeight);
      setDocBackgroundColor(doc.docBackgroundColor || IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND);
      setObjects((doc.objects ?? []) as EditorObject[]);
      setSelectedIds([]);
      setZoomMode('fit');
      setViewPan({ x: 0, y: 0 });
    })().catch((e) => {
      console.error('[ImageEditor] load history project', e);
      message.error('加载项目失败');
    });
    return () => {
      cancelled = true;
    };
    // 仅在进入编辑器时加载一次；id 来自本次导航
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveHistoryProject = useCallback(async () => {
    if (!historyProjectId || !window.yiman?.imageProjects) {
      message.warning('当前没有打开的历史项目');
      return;
    }
    const s = docStateRef.current;
    const res = await window.yiman.imageProjects.saveDoc({
      id: historyProjectId,
      name: historyProjectName,
      docWidth: s.docWidth,
      docHeight: s.docHeight,
      docBackgroundColor: s.docBackgroundColor,
      objects: s.objects,
    });
    if (res?.ok) message.success('已保存');
    else message.error(res?.error ?? '保存失败');
  }, [historyProjectId, historyProjectName, message]);

  const applySnapshot = useCallback((snap: EditorDocSnapshot) => {
    isUndoRedoRef.current = true;
    const s = cloneDocSnapshot(snap);
    setDocWidth(s.docWidth);
    setDocHeight(s.docHeight);
    setDocBackgroundColor(s.docBackgroundColor);
    setObjects(s.objects);
    queueMicrotask(() => {
      isUndoRedoRef.current = false;
    });
  }, []);

  const undo = useCallback(() => {
    const past = historyPastRef.current;
    if (past.length === 0) return;
    const pvBefore = pathVectorEditSessionRef.current;
    const prevSnap = past[past.length - 1]!;
    historyPastRef.current = past.slice(0, -1);
    const cur = docStateRef.current;
    historyFutureRef.current = [
      cloneDocSnapshot({
        docWidth: cur.docWidth,
        docHeight: cur.docHeight,
        docBackgroundColor: cur.docBackgroundColor,
        objects: cur.objects,
      }),
      ...historyFutureRef.current,
    ].slice(0, 50);
    applySnapshot(prevSnap);

    if (pvBefore) {
      const still = prevSnap.objects.find((o) => o.id === pvBefore.objectId && o.type === 'path');
      if (still && still.type === 'path') {
        const nextSession = clampPathVectorEditSessionToPathData(pvBefore, still.pathData);
        if (nextSession) {
          setPathVectorEditSession(nextSession);
          setSelectedIds([pvBefore.objectId]);
        } else {
          setPathVectorEditSession(null);
          setSelectedIds([]);
        }
      } else {
        setPathVectorEditSession(null);
        setSelectedIds([]);
      }
    } else {
      setSelectedIds([]);
    }
    setHistoryTick((t) => t + 1);
  }, [applySnapshot]);

  const redo = useCallback(() => {
    const fut = historyFutureRef.current;
    if (fut.length === 0) return;
    const pvBefore = pathVectorEditSessionRef.current;
    const nextSnap = fut[0]!;
    historyFutureRef.current = fut.slice(1);
    const cur = docStateRef.current;
    historyPastRef.current = [
      ...historyPastRef.current.slice(-49),
      cloneDocSnapshot({
        docWidth: cur.docWidth,
        docHeight: cur.docHeight,
        docBackgroundColor: cur.docBackgroundColor,
        objects: cur.objects,
      }),
    ];
    applySnapshot(nextSnap);

    if (pvBefore) {
      const still = nextSnap.objects.find((o) => o.id === pvBefore.objectId && o.type === 'path');
      if (still && still.type === 'path') {
        const nextSession = clampPathVectorEditSessionToPathData(pvBefore, still.pathData);
        if (nextSession) {
          setPathVectorEditSession(nextSession);
          setSelectedIds([pvBefore.objectId]);
        } else {
          setPathVectorEditSession(null);
          setSelectedIds([]);
        }
      } else {
        setPathVectorEditSession(null);
        setSelectedIds([]);
      }
    } else {
      setSelectedIds([]);
    }
    setHistoryTick((t) => t + 1);
  }, [applySnapshot]);

  void historyTick;
  const canUndo = historyPastRef.current.length > 0;
  const canRedo = historyFutureRef.current.length > 0;

  const selected = useMemo(() => {
    if (selectedIds.length !== 1) return null;
    return objects.find((o) => o.id === selectedIds[0]) ?? null;
  }, [objects, selectedIds]);

  const pathVectorSimplifyPreview = useMemo(() => {
    if (!pathSimplifySession) return null;
    const next = simplifySubpathsByPercent(
      pathSimplifySession.baselinePathData,
      pathSimplifySession.subpathIndices,
      pathSimplifySession.curvePrecisionPercent
    );
    const orig = mergeSubpathsToD(pathSimplifySession.baselinePathData, pathSimplifySession.subpathIndices);
    if (!next || !orig) return null;
    return { previewPathData: next, originalSelectedD: orig };
  }, [pathSimplifySession]);

  const onAlignMulti = useCallback(
    (kind: AlignKind) => {
      recordHistory();
      setObjects((prev) => alignSelectedObjects(prev, selectedIds, kind));
    },
    [selectedIds, recordHistory]
  );

  const onDistributeMulti = useCallback(
    (kind: DistributeKind) => {
      if (selectedIds.length < 3) {
        message.warning('分布至少需要选中 3 个对象');
        return;
      }
      recordHistory();
      setObjects((prev) => distributeSelectedObjects(prev, selectedIds, kind));
    },
    [selectedIds, message, recordHistory]
  );

  const shapeMaskEligible = useMemo(() => {
    if (selectedIds.length !== 2) return false;
    const a = objects.find((o) => o.id === selectedIds[0]);
    const b = objects.find((o) => o.id === selectedIds[1]);
    if (!a || !b) return false;
    const hasImage = a.type === 'image' || b.type === 'image';
    const hasShape = a.type === 'shape' || b.type === 'shape';
    return hasImage && hasShape;
  }, [selectedIds, objects]);

  const applyShapeMaskFromSelection = useCallback(async () => {
    if (selectedIds.length !== 2) {
      message.warning('请恰好选中一张图片和一个形状');
      return;
    }
    const picked = selectedIds
      .map((id) => objects.find((o) => o.id === id))
      .filter((o): o is EditorObject => !!o);
    if (picked.length !== 2) return;
    const img = picked.find((o): o is EditorImageObject => o.type === 'image');
    const shp = picked.find((o): o is EditorShapeObject => o.type === 'shape');
    if (!img || !shp) {
      message.warning('请恰好选中一张图片和一个形状');
      return;
    }
    closeZoomBlurDiscardPreview();
    exitLamaEraseSession();
    setShapeMaskLoading(true);
    try {
      const pr = typeof window !== 'undefined' ? Math.min(2, window.devicePixelRatio || 1) : 1;
      const r = await renderShapeMaskedImagePng(img, shp, docWidth, docHeight, pr);
      if (!r) {
        message.warning('无法生成蒙版（请确认形状与画布相交）');
        return;
      }
      // 避免「移除白底 / 矢量化预览」等异步任务在蒙版完成后仍用旧 src 覆盖结果
      rwPreviewReqIdRef.current += 1;
      potraceReqIdRef.current += 1;
      zoomBlurReqIdRef.current += 1;
      setImageCropSession(null);
      setCanvasEditSession(null);
      setRemoveWhiteSession(null);
      setFitImageSession(null);
      setFitContentSession(null);
      setPotraceSession(null);
      setZoomBlurSession(null);
      recordHistory();
      setObjects((prev) => {
        const cur = prev.find((o) => o.id === img.id);
        if (!cur || cur.type !== 'image') return prev;
        const nextImg: EditorImageObject = {
          ...cur,
          x: r.x,
          y: r.y,
          width: r.width,
          height: r.height,
          rotation: 0,
          src: r.dataUrl,
          sourceCrop: undefined,
          naturalW: undefined,
          naturalH: undefined,
        };
        // 形状若叠在图片之上会遮住 destination-in 后的透明衬底上的图像；蒙版结果仅来自栅格化 PNG，故移除蒙版用形状并顶置图片
        return [...prev.filter((o) => o.id !== shp.id && o.id !== img.id), nextImg];
      });
      setSelectedIds([img.id]);
      message.success('已按形状应用蒙版');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '生成失败');
    } finally {
      setShapeMaskLoading(false);
    }
  }, [selectedIds, objects, docWidth, docHeight, message, recordHistory, closeZoomBlurDiscardPreview, exitLamaEraseSession]);

  const cropTargetImage = useMemo(() => {
    if (!imageCropSession) return null;
    const o = objects.find((x) => x.id === imageCropSession.objectId);
    return o?.type === 'image' ? o : null;
  }, [imageCropSession, objects]);

  const zoomBlurTargetImage = useMemo(() => {
    if (!zoomBlurSession) return null;
    const o = objects.find((x): x is EditorImageObject => x.id === zoomBlurSession.objectId && x.type === 'image');
    return o ?? null;
  }, [zoomBlurSession, objects]);

  const lamaEraseLiveLayer = useMemo(() => {
    if (!lamaEraseSession) return null;
    const o = objects.find((x): x is EditorImageObject => x.id === lamaEraseSession.objectId && x.type === 'image');
    return o ?? null;
  }, [lamaEraseSession, objects]);

  const lamaPaintImageLayer = useMemo((): EditorImageObject | null => {
    if (!lamaEraseSession || !lamaEraseLiveLayer) return null;
    return {
      ...lamaEraseLiveLayer,
      naturalW: lamaEraseSession.imagePixelW,
      naturalH: lamaEraseSession.imagePixelH,
      sourceCrop: lamaEraseSession.sourceCrop,
    };
  }, [lamaEraseSession, lamaEraseLiveLayer]);

  /** 遮罩模式下整图（含预览缩放）在文档中的外接框，用于浮层约束与映射 */
  const cropEditFrame = useMemo(() => {
    if (!cropTargetImage || !imageCropSession) return null;
    const F = getFullImageDisplayFrameInDoc(cropTargetImage);
    return applyZoomAroundCenter(F, imageCropSession.imageZoom);
  }, [cropTargetImage, imageCropSession]);

  const fitZoom = useMemo(() => {
    if (viewport.w <= 0 || viewport.h <= 0 || docWidth <= 0 || docHeight <= 0) return 0.5;
    const pad = 0.98;
    const z = Math.min((viewport.w * pad) / docWidth, (viewport.h * pad) / docHeight);
    return Math.min(4, Math.max(0.05, z));
  }, [viewport, docWidth, docHeight]);

  useEffect(() => {
    if (zoomMode !== 'fit') return;
    setZoom((z) => (Math.abs(z - fitZoom) < 1e-6 ? z : fitZoom));
  }, [zoomMode, fitZoom]);

  const onViewportSize = useCallback((w: number, h: number) => {
    setViewport((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
  }, []);

  const { zoomPercentRounded, zoomSelectValue, zoomTooltipTitle } = useImageEditorZoomHeaderDisplay({
    zoom,
    zoomMode,
    fitZoom,
  });

  const canvasInset = useMemo(() => {
    const cx0 = Math.max(0, (viewport.w - docWidth * zoom) / 2);
    const cy0 = Math.max(0, (viewport.h - docHeight * zoom) / 2);
    return { cx: cx0 + viewPan.x, cy: cy0 + viewPan.y };
  }, [viewport.w, viewport.h, docWidth, docHeight, zoom, viewPan]);

  const onViewPanGestureDelta = useCallback((dx: number, dy: number) => {
    setZoomMode('fixed');
    setViewPan((p) => ({ x: p.x + dx, y: p.y + dy }));
  }, []);

  const onZoomGestureAt = useCallback(
    (newZoom: number, screenX: number, screenY: number, vw: number, vh: number) => {
      if (vw <= 0 || vh <= 0) return;
      setZoomMode('fixed');
      const r = zoomAroundScreenPoint({
        viewportW: vw,
        viewportH: vh,
        docW: docWidth,
        docH: docHeight,
        zoom: zoomRef.current,
        viewPan: viewPanRef.current,
        screenX,
        screenY,
        newZoom,
      });
      setZoom(r.zoom);
      setViewPan(r.viewPan);
    },
    [docWidth, docHeight]
  );

  const onImageNaturalSize = useCallback((id: string, nw: number, nh: number) => {
    setObjects((prev) =>
      prev.map((o) => (o.id === id && o.type === 'image' && (o.naturalW !== nw || o.naturalH !== nh) ? { ...o, naturalW: nw, naturalH: nh } : o))
    );
  }, []);

  const fitContentPreview = useMemo(() => {
    if (!fitContentSession) return { w: 0, h: 0 };
    const b = fitContentSession.bounds;
    const p = fitContentSession.edgePadding;
    return {
      w: Math.max(16, b.maxX - b.minX + 2 * p),
      h: Math.max(16, b.maxY - b.minY + 2 * p),
    };
  }, [fitContentSession]);

  /** 适合画布：随留白 / 等比选项实时更新图层几何 */
  useEffect(() => {
    if (!fitImageSession) return;
    const layout = computeImageFitToCanvasLayout(
      docWidth,
      docHeight,
      fitImageSession.edgePadding,
      fitImageSession.maintainAspect,
      fitImageSession.intrinsicAspect
    );
    setObjects((prev) =>
      prev.map((o) => (o.id === fitImageSession.objectId && o.type === 'image' ? { ...o, ...layout } : o))
    );
  }, [
    fitImageSession?.objectId,
    fitImageSession?.edgePadding,
    fitImageSession?.maintainAspect,
    fitImageSession?.intrinsicAspect,
    docWidth,
    docHeight,
  ]);

  const adjustOverlayLock =
    !!removeWhiteSession ||
    !!fitImageSession ||
    !!fitContentSession ||
    !!potraceSession ||
    !!zoomBlurSession ||
    !!lamaEraseSession ||
    !!pathVectorEditSession;

  const enterLamaEraseSession = useCallback(
    async (id: string, baseUrl: string) => {
      const o = objects.find((x): x is EditorImageObject => x.id === id && x.type === 'image');
      if (!o) return;
      if (Math.abs(o.rotation) > 1e-3) {
        message.warning('请先复位旋转为 0° 再使用 Lama 擦除');
        return;
      }
      const { w, h } = await loadImageSize(o.src);
      closeZoomBlurDiscardPreview();
      setImageCropSession(null);
      setCanvasEditSession(null);
      setRemoveWhiteSession(null);
      setFitImageSession(null);
      setFitContentSession(null);
      setPotraceSession(null);
      setZoomBlurSession(null);
      setLamaEraseResultUrl(null);
      setLamaHasMask(false);
      setLamaEraseSession({
        objectId: id,
        originalSrc: o.src,
        sourceCrop: o.sourceCrop ? { ...o.sourceCrop } : undefined,
        imagePixelW: w,
        imagePixelH: h,
        brushRadiusPx: 28,
        baseUrl,
      });
      setSelectedIds([]);
    },
    [objects, message, closeZoomBlurDiscardPreview]
  );

  const onStartLamaEraseAdjust = useCallback(
    async (id: string) => {
      const plug = window.yiman?.plugins;
      if (!plug?.lamaCleanerEnsure) {
        message.error('请在芝绘桌面版中使用擦除（Lama Cleaner）');
        return;
      }
      lamaPendingIdRef.current = id;
      const r = await plug.lamaCleanerEnsure();
      if (r.ok) {
        await enterLamaEraseSession(id, r.baseUrl);
        return;
      }
      if ('needInstall' in r && r.needInstall) {
        setLamaInstallModalOpen(true);
        return;
      }
      message.error('error' in r ? r.error : '无法连接 Lama Cleaner');
    },
    [enterLamaEraseSession, message]
  );

  const runLamaInpaint = useCallback(async () => {
    const sess = lamaEraseSession;
    if (!sess) return;
    const mask = lamaPaintRef.current?.exportMaskPngDataUrl();
    if (!mask) {
      message.warning('请先涂抹要擦除的区域');
      return;
    }
    setLamaEraseBusy(true);
    try {
      const out = await inpaintViaLamaCleaner(sess.baseUrl, sess.originalSrc, mask);
      setLamaEraseResultUrl(out);
    } catch (e) {
      message.error(e instanceof Error ? e.message : '擦除失败');
    } finally {
      setLamaEraseBusy(false);
    }
  }, [lamaEraseSession, message]);

  const clearLamaErasePaint = useCallback(() => {
    lamaPaintRef.current?.clearMask();
    setLamaHasMask(false);
    setLamaEraseResultUrl(null);
  }, []);

  const applyLamaErase = useCallback(() => {
    if (!lamaEraseSession || !lamaEraseResultUrl) return;
    recordHistory();
    const id = lamaEraseSession.objectId;
    const url = lamaEraseResultUrl;
    setObjects((prev) =>
      prev.map((o) =>
        o.id === id && o.type === 'image'
          ? { ...o, src: url, sourceCrop: undefined, naturalW: undefined, naturalH: undefined }
          : o
      )
    );
    exitLamaEraseSession();
    message.success('已应用擦除结果');
  }, [lamaEraseSession, lamaEraseResultUrl, recordHistory, exitLamaEraseSession, message]);

  const openLamaInstallInTerminal = useCallback(async () => {
    const plug = window.yiman?.plugins;
    if (!plug?.lamaCleanerOpenInstallTerminal) return;
    const x = await plug.lamaCleanerOpenInstallTerminal();
    if (!x.ok) message.error(x.error ?? '打开终端失败');
    else message.info('已打开终端：可按提示输入环境相关 shell（空行继续安装）；完成后可点「重试连接」');
  }, [message]);

  const retryLamaConnection = useCallback(async () => {
    const plug = window.yiman?.plugins;
    const id = lamaPendingIdRef.current;
    if (!plug?.lamaCleanerEnsure || !id) return;
    const r = await plug.lamaCleanerEnsure();
    if (r.ok) {
      setLamaInstallModalOpen(false);
      await enterLamaEraseSession(id, r.baseUrl);
    } else {
      message.warning('error' in r ? r.error : '仍未就绪，请确认安装成功且服务已监听 9380 端口');
    }
  }, [enterLamaEraseSession, message]);

  useEffect(() => {
    if (lamaEraseSession && !lamaEraseLiveLayer) exitLamaEraseSession();
  }, [lamaEraseSession, lamaEraseLiveLayer, exitLamaEraseSession]);

  const trimImageTransparentEdges = useCallback(
    async (id: string) => {
      const o = objects.find((x): x is EditorImageObject => x.id === id && x.type === 'image');
      if (!o) return;
      if (Math.abs(o.rotation) > 1e-3) {
        message.warning('请先复位旋转为 0° 再移除透明四周');
        return;
      }
      const nw = o.naturalW;
      const nh = o.naturalH;
      if (!nw || !nh) {
        message.warning('请等待图片解码完成后再试');
        return;
      }
      const result = await computeImageTrimTransparentPaddingPatch(o, { paddingPx: 10 });
      if (!result.ok) {
        message.warning(result.reason);
        return;
      }
      recordHistory();
      setObjects((prev) =>
        prev.map((p) => (p.id === id && p.type === 'image' ? ({ ...p, ...result.patch } as EditorImageObject) : p))
      );
      setSelectedIds([]);
      requestAnimationFrame(() => {
        setSelectedIds([id]);
      });
      message.success('已按透明边裁剪');
    },
    [objects, message, recordHistory]
  );

  const startRemoveWhiteAdjust = useCallback((id: string) => {
    const o = objects.find((x): x is EditorImageObject => x.id === id && x.type === 'image');
    if (!o) return;
    closeZoomBlurDiscardPreview();
    exitLamaEraseSession();
    recordHistory();
    setImageCropSession(null);
    setCanvasEditSession(null);
    setFitImageSession(null);
    setFitContentSession(null);
    setPotraceSession(null);
    const last = lastRemoveWhiteAdjustByIdRef.current[id];
    setRemoveWhiteSession({
      objectId: id,
      tolerance: last?.tolerance ?? 60,
      whiteGrayOnly: last?.whiteGrayOnly ?? false,
      originalSrc: o.src,
    });
    setSelectedIds([]);
  }, [objects, recordHistory, closeZoomBlurDiscardPreview, exitLamaEraseSession]);

  const cancelRemoveWhiteAdjust = useCallback(() => {
    rwPreviewReqIdRef.current += 1;
    setRemoveWhiteSession((sess) => {
      if (sess) {
        setObjects((prev) =>
          prev.map((o) => (o.id === sess.objectId && o.type === 'image' ? { ...o, src: sess.originalSrc } : o))
        );
      }
      return null;
    });
  }, []);

  const applyRemoveWhiteAdjust = useCallback(async () => {
    if (!removeWhiteSession) return;
    const { objectId, tolerance, originalSrc, whiteGrayOnly } = removeWhiteSession;
    rwPreviewReqIdRef.current += 1;
    setImageProcessing(true);
    try {
      const b64 = await removeWhiteBackdropFromDataUrl(originalSrc, tolerance, whiteGrayOnly);
      const url = `data:image/png;base64,${b64}`;
      setObjects((prev) => prev.map((o) => (o.id === objectId ? { ...o, src: url } : o)));
      lastRemoveWhiteAdjustByIdRef.current[objectId] = { tolerance, whiteGrayOnly };
      setRemoveWhiteSession(null);
      message.success('已按白底线性反解：平滑 Alpha + 还原前景色');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setImageProcessing(false);
    }
  }, [removeWhiteSession, message]);

  /** 打开调整条或滑块拖拽结束（tick）后：按 originalSrc + 当前容差生成预览，不在滑块拖动过程中重复计算 */
  useEffect(() => {
    if (!removeWhiteSession) return;
    const sess = removeWhitePreviewRef.current;
    if (!sess) return;
    const { objectId, originalSrc, tolerance, whiteGrayOnly } = sess;
    const reqId = ++rwPreviewReqIdRef.current;
    let cancelled = false;
    (async () => {
      try {
        setImageProcessing(true);
        const b64 = await removeWhiteBackdropFromDataUrl(originalSrc, tolerance, whiteGrayOnly);
        if (cancelled || reqId !== rwPreviewReqIdRef.current) return;
        const url = `data:image/png;base64,${b64}`;
        setObjects((prev) =>
          prev.map((o) => (o.id === objectId && o.type === 'image' ? { ...o, src: url } : o))
        );
      } catch (e) {
        if (!cancelled && reqId === rwPreviewReqIdRef.current) {
          message.error(e instanceof Error ? e.message : '预览失败');
        }
      } finally {
        if (!cancelled && reqId === rwPreviewReqIdRef.current) {
          setImageProcessing(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    removeWhiteSession?.objectId,
    removeWhiteSession?.originalSrc,
    removeWhiteSession?.whiteGrayOnly,
    removeWhitePreviewTick,
    message,
  ]);

  const startPotraceAdjust = useCallback((id: string) => {
    const o = objects.find((x): x is EditorImageObject => x.id === id && x.type === 'image');
    if (!o) return;
    closeZoomBlurDiscardPreview();
    exitLamaEraseSession();
    setImageCropSession(null);
    setCanvasEditSession(null);
    setRemoveWhiteSession(null);
    setFitImageSession(null);
    setFitContentSession(null);
    setPotraceSession({
      objectId: id,
      threshold: 128,
      useOtsu: true,
      turdSize: 16,
      simplifyEpsilon: 1.6,
      curveTension: 0.5,
      cornerAngleThreshold: 38,
      adaptiveSimplify: false,
      preserveColor: true,
      ignoreWhite: true,
      edgeErosionPasses: 1,
      fringeSuppressMinRgb: 0,
      previewPathData: null,
      traceW: 1,
      traceH: 1,
      docRect: { x: o.x, y: o.y, width: o.width, height: o.height },
    });
    setPotracePreviewTick((t) => t + 1);
    setSelectedIds([]);
  }, [objects, closeZoomBlurDiscardPreview, exitLamaEraseSession]);

  const cancelPotraceAdjust = useCallback(() => {
    potraceReqIdRef.current += 1;
    setPotraceSession(null);
  }, []);

  const cancelZoomBlurAdjust = closeZoomBlurDiscardPreview;

  const startZoomBlurAdjust = useCallback(
    (id: string) => {
      const o = objects.find((x): x is EditorImageObject => x.id === id && x.type === 'image');
      if (!o) return;
      closeZoomBlurDiscardPreview();
      exitLamaEraseSession();
      recordHistory();
      setImageCropSession(null);
      setCanvasEditSession(null);
      setRemoveWhiteSession(null);
      setFitImageSession(null);
      setFitContentSession(null);
      setPotraceSession(null);
      const last = lastZoomBlurByIdRef.current[id];
      const sc = o.sourceCrop ? { ...o.sourceCrop } : undefined;
      setZoomBlurSession({
        objectId: id,
        originalSrc: o.src,
        sourceCrop: sc,
        originXN: last?.originXN ?? 0.5,
        originYN: last?.originYN ?? 0.5,
        radiusPercent: last?.radiusPercent ?? 28,
        sampleStepsMax: last?.sampleStepsMax ?? ZOOM_BLUR_SAMPLE_STEPS_DEFAULT,
      });
      setSelectedIds([]);
    },
    [objects, recordHistory, closeZoomBlurDiscardPreview, exitLamaEraseSession]
  );

  const applyZoomBlurAdjust = useCallback(async () => {
    const zb = zoomBlurSession;
    if (!zb) return;
    zoomBlurReqIdRef.current += 1;
    const token = zoomBlurReqIdRef.current;
    setImageProcessing(true);
    try {
      const url = await renderZoomBlurDataUrl(zb.originalSrc, {
        originXN: zb.originXN,
        originYN: zb.originYN,
        radiusPercent: zb.radiusPercent,
        sourceCrop: zb.sourceCrop,
        sampleStepsMax: zb.sampleStepsMax,
        maxSide: undefined,
      });
      if (token !== zoomBlurReqIdRef.current) return;
      setObjects((prev) =>
        prev.map((o) =>
          o.id === zb.objectId && o.type === 'image'
            ? { ...o, src: url, sourceCrop: undefined, naturalW: undefined, naturalH: undefined }
            : o
        )
      );
      lastZoomBlurByIdRef.current[zb.objectId] = {
        originXN: zb.originXN,
        originYN: zb.originYN,
        radiusPercent: zb.radiusPercent,
        sampleStepsMax: zb.sampleStepsMax,
      };
      setZoomBlurSession(null);
      message.success('已应用缩放模糊');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '处理失败');
    } finally {
      setImageProcessing(false);
    }
  }, [zoomBlurSession, message]);

  const applyPotraceAdjust = useCallback(async () => {
    if (!potraceSession) return;
    recordHistory();
    const s = potraceSession;
    const imgObj = objects.find((x): x is EditorImageObject => x.id === s.objectId && x.type === 'image');
    if (!imgObj) {
      message.error('找不到要矢量化的图片图层');
      return;
    }
    potraceReqIdRef.current += 1;
    setImageProcessing(true);
    try {
      const raster = await rasterizeEditorImageForPotrace(imgObj);
      const r = await traceDataUrlToSvgPathResult(raster.dataUrl, {
        threshold: s.useOtsu ? -1 : s.threshold,
        turdSize: s.turdSize,
        simplifyEpsilon: s.simplifyEpsilon,
        curveTension: s.curveTension,
        cornerAngleThreshold: s.cornerAngleThreshold,
        adaptiveSimplify: s.adaptiveSimplify,
        ignoreWhite: s.ignoreWhite,
        edgeErosionPasses: s.edgeErosionPasses,
        fringeSuppressMinRgb: s.fringeSuppressMinRgb,
        maxTraceSide: 2048,
      });
      if (!r.pathData.trim()) {
        message.warning('未得到有效路径，可尝试调整阈值或去噪');
        return;
      }
      let fill: string | undefined;
      let fillKind: 'solid' | 'pattern' | undefined;
      let patternSrc: string | undefined;
      let pathSubpathStyles: PathSubpathStyleOverride[] | undefined;
      if (s.preserveColor) {
        const sampleSrc = s.ignoreWhite
          ? await imageSrcToKnockoutWhiteDataUrl(raster.dataUrl, DEFAULT_POTRACE_OPTIONS.ignoreWhiteMinLuma)
          : raster.dataUrl;
        fillKind = 'solid';
        const tempObj = defaultEditorPathFromTrace({
          pathData: r.pathData,
          naturalW: r.width,
          naturalH: r.height,
          x: s.docRect.x,
          y: s.docRect.y,
          width: s.docRect.width,
          height: s.docRect.height,
          fill: 'rgba(128,128,128,1)',
          fillKind: 'solid',
        });
        const styles = await subpathStylesFromPatternDominants(tempObj, sampleSrc);
        pathSubpathStyles = styles ?? undefined;
      }
      const pathObj = defaultEditorPathFromTrace({
        pathData: r.pathData,
        naturalW: r.width,
        naturalH: r.height,
        x: s.docRect.x,
        y: s.docRect.y,
        width: s.docRect.width,
        height: s.docRect.height,
        fill,
        fillKind,
        patternSrc,
      });
      const finalPathObj = pathSubpathStyles
        ? { ...pathObj, pathSubpathStyles, fillKind: 'solid' as const, patternSrc: undefined }
        : pathObj;
      setObjects((prev) => [...prev, finalPathObj]);
      setPotraceSession(null);
      message.success('已添加矢量图层');
    } catch (e) {
      message.error(e instanceof Error ? e.message : '矢量化失败');
    } finally {
      setImageProcessing(false);
    }
  }, [potraceSession, objects, message, recordHistory]);

  useEffect(() => {
    if (!potraceSession || potraceTraceSourceKey == null) return;
    const reqId = ++potraceReqIdRef.current;
    let cancelled = false;
    (async () => {
      try {
        setImageProcessing(true);
        const cur = potraceSessionRef.current;
        if (!cur) return;
        const o = objects.find((x): x is EditorImageObject => x.id === cur.objectId && x.type === 'image');
        if (!o) return;
        const raster = await rasterizeEditorImageForPotrace(o);
        if (cancelled || reqId !== potraceReqIdRef.current) return;
        const r = await traceDataUrlToSvgPathResult(raster.dataUrl, {
          threshold: cur.useOtsu ? -1 : cur.threshold,
          turdSize: cur.turdSize,
          simplifyEpsilon: cur.simplifyEpsilon,
          curveTension: cur.curveTension,
          cornerAngleThreshold: cur.cornerAngleThreshold,
          adaptiveSimplify: cur.adaptiveSimplify,
          ignoreWhite: cur.ignoreWhite,
          edgeErosionPasses: cur.edgeErosionPasses,
          fringeSuppressMinRgb: cur.fringeSuppressMinRgb,
        });
        if (cancelled || reqId !== potraceReqIdRef.current) return;
        setPotraceSession((prev) =>
          prev && prev.objectId === cur.objectId
            ? { ...prev, previewPathData: r.pathData, traceW: r.width, traceH: r.height }
            : prev
        );
      } catch (e) {
        if (!cancelled && reqId === potraceReqIdRef.current) {
          message.error(e instanceof Error ? e.message : '矢量化预览失败');
        }
      } finally {
        if (reqId === potraceReqIdRef.current) setImageProcessing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // 勿依赖整个 potraceSession：更新 previewPathData 会改引用并导致本 effect 死循环 + loading 闪烁
  }, [
    potraceSession?.objectId,
    potraceSession?.threshold,
    potraceSession?.useOtsu,
    potraceSession?.turdSize,
    potraceSession?.simplifyEpsilon,
    potraceSession?.curveTension,
    potraceSession?.cornerAngleThreshold,
    potraceSession?.adaptiveSimplify,
    potraceSession?.ignoreWhite,
    potraceSession?.edgeErosionPasses,
    potraceSession?.fringeSuppressMinRgb,
    potraceTraceSourceKey,
    potracePreviewTick,
    message,
  ]);

  useEffect(() => {
    if (!potraceSession) {
      setPotraceKnockoutPatternUrl(null);
      return;
    }
    if (!potraceSession.preserveColor || !potraceSession.ignoreWhite) {
      setPotraceKnockoutPatternUrl(null);
      return;
    }
    if (potraceTraceSourceKey == null) {
      setPotraceKnockoutPatternUrl(null);
      return;
    }
    const objectId = potraceSession.objectId;
    let cancelled = false;
    setPotraceKnockoutPatternUrl(null);
    void (async () => {
      try {
        const o = objects.find((x): x is EditorImageObject => x.id === objectId && x.type === 'image');
        if (!o) return;
        const raster = await rasterizeEditorImageForPotrace(o);
        if (cancelled) return;
        const url = await imageSrcToKnockoutWhiteDataUrl(
          raster.dataUrl,
          DEFAULT_POTRACE_OPTIONS.ignoreWhiteMinLuma
        );
        if (!cancelled) setPotraceKnockoutPatternUrl(url);
      } catch {
        if (!cancelled) setPotraceKnockoutPatternUrl(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    potraceSession?.objectId,
    potraceTraceSourceKey,
    potraceSession?.preserveColor,
    potraceSession?.ignoreWhite,
  ]);

  useEffect(() => {
    if (!potraceSession?.preserveColor || !potraceSession.previewPathData?.trim()) {
      setPotraceDominantPreviewCss(null);
      return;
    }
    const s = potraceSession;
    const pathD = s.previewPathData;
    const tw = s.traceW;
    const th = s.traceH;
    if (tw < 1 || th < 1) {
      setPotraceDominantPreviewCss(null);
      return;
    }
    if (s.ignoreWhite && !potraceKnockoutPatternUrl) {
      setPotraceDominantPreviewCss(null);
      return;
    }
    if (!s.ignoreWhite && potraceTraceSourceKey == null) {
      setPotraceDominantPreviewCss(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        let sampleSrc: string;
        if (s.ignoreWhite) {
          sampleSrc = potraceKnockoutPatternUrl as string;
        } else {
          const o = objects.find((x): x is EditorImageObject => x.id === s.objectId && x.type === 'image');
          if (!o) return;
          const raster = await rasterizeEditorImageForPotrace(o);
          if (cancelled) return;
          sampleSrc = raster.dataUrl;
        }
        const css = await dominantRgbCssFromImageAndPath(sampleSrc, pathD as string, tw, th);
        if (!cancelled) setPotraceDominantPreviewCss(css);
      } catch {
        if (!cancelled) setPotraceDominantPreviewCss(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    potraceSession?.objectId,
    potraceSession?.preserveColor,
    potraceSession?.previewPathData,
    potraceSession?.traceW,
    potraceSession?.traceH,
    potraceTraceSourceKey,
    potraceSession?.ignoreWhite,
    potraceKnockoutPatternUrl,
    potracePreviewTick,
    objects,
  ]);

  /** 缩放模糊：实时预览（限长边以控制耗时） */
  useEffect(() => {
    if (!zoomBlurSession) return;
    const zb = { ...zoomBlurSession };
    const reqId = ++zoomBlurReqIdRef.current;
    let cancelled = false;
    void (async () => {
      try {
        const url = await renderZoomBlurDataUrl(zb.originalSrc, {
          originXN: zb.originXN,
          originYN: zb.originYN,
          radiusPercent: zb.radiusPercent,
          sourceCrop: zb.sourceCrop,
          sampleStepsMax: zb.sampleStepsMax,
          maxSide: 720,
        });
        if (cancelled || reqId !== zoomBlurReqIdRef.current) return;
        setObjects((prev) =>
          prev.map((o) =>
            o.id === zb.objectId && o.type === 'image'
              ? {
                  ...o,
                  src: url,
                  // 预览图已是裁切后的位图，若保留旧 sourceCrop（原图坐标）会与低分辨率 src 错配，导致整图外接框算错、画面异常缩小
                  ...(zb.sourceCrop ? { sourceCrop: undefined } : {}),
                }
              : o
          )
        );
      } catch {
        /* 预览失败时保留当前帧 */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [zoomBlurSession]);

  const startFitImageToCanvas = useCallback(
    (id: string) => {
      const o = objects.find((x) => x.id === id && x.type === 'image') as EditorImageObject | undefined;
      if (!o) return;
      if (Math.abs(o.rotation) > 1e-3) {
        message.warning('请先复位旋转为 0° 再使用适合画布');
        return;
      }
      closeZoomBlurDiscardPreview();
      exitLamaEraseSession();
      const intrinsicAspect = getImageIntrinsicAspectRatio(o);
      recordHistory();
      setImageCropSession(null);
      setCanvasEditSession(null);
      setRemoveWhiteSession(null);
      setFitContentSession(null);
      setPotraceSession(null);
      setFitImageSession({
        objectId: id,
        edgePadding: 0,
        maintainAspect: true,
        snapshot: { x: o.x, y: o.y, width: o.width, height: o.height },
        intrinsicAspect,
      });
      setSelectedIds([]);
    },
    [objects, message, recordHistory, closeZoomBlurDiscardPreview, exitLamaEraseSession]
  );

  const cancelFitImageToCanvas = useCallback(() => {
    setFitImageSession((sess) => {
      if (sess) {
        setObjects((prev) =>
          prev.map((o) => (o.id === sess.objectId && o.type === 'image' ? { ...o, ...sess.snapshot } : o))
        );
      }
      return null;
    });
  }, []);

  const applyFitImageToCanvas = useCallback(() => {
    if (!fitImageSession) return;
    setFitImageSession(null);
    message.success('已适合画布');
  }, [fitImageSession, message]);

  const startFitContentAdjust = useCallback(() => {
    const bounds = getEditorObjectsDocBounds(objects);
    if (!bounds) {
      message.warning('先添加图层后再试');
      return;
    }
    closeZoomBlurDiscardPreview();
    exitLamaEraseSession();
    recordHistory();
    setImageCropSession(null);
    setCanvasEditSession(null);
    setRemoveWhiteSession(null);
    setFitImageSession(null);
    setPotraceSession(null);
    setFitContentSession({
      edgePadding: 0,
      bounds: { minX: bounds.minX, minY: bounds.minY, maxX: bounds.maxX, maxY: bounds.maxY },
      snapshot: {
        docWidth,
        docHeight,
        objects: objects.map((o) => ({ ...o })),
      },
    });
    setSelectedIds([]);
  }, [objects, docWidth, docHeight, message, recordHistory, closeZoomBlurDiscardPreview, exitLamaEraseSession]);

  const cancelFitContentAdjust = useCallback(() => {
    setFitContentSession((sess) => {
      if (sess) {
        setDocWidth(sess.snapshot.docWidth);
        setDocHeight(sess.snapshot.docHeight);
        setObjects(sess.snapshot.objects.map((o) => ({ ...o })));
      }
      return null;
    });
  }, []);

  const applyFitContentAdjust = useCallback(() => {
    if (!fitContentSession) return;
    const { bounds, edgePadding: pad } = fitContentSession;
    const nw = Math.max(16, Math.round(bounds.maxX - bounds.minX + 2 * pad));
    const nh = Math.max(16, Math.round(bounds.maxY - bounds.minY + 2 * pad));
    const dx = pad - bounds.minX;
    const dy = pad - bounds.minY;
    setDocWidth(nw);
    setDocHeight(nh);
    setObjects((prev) => prev.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy })));
    setFitContentSession(null);
    message.success('已按内容调整画布');
  }, [fitContentSession, message]);

  const startImageCrop = useCallback(
    (id: string) => {
      const o = objects.find((x) => x.id === id && x.type === 'image') as EditorImageObject | undefined;
      if (!o) return;
      if (Math.abs(o.rotation) > 1e-3) {
        message.warning('请先复位旋转为 0° 再使用遮罩裁切');
        return;
      }
      if (!o.naturalW || !o.naturalH) {
        message.warning('请等待图片加载完成后再试');
        return;
      }
      closeZoomBlurDiscardPreview();
      exitLamaEraseSession();
      const rect = getInitialCropDocRectFromLayer(o);
      setRemoveWhiteSession(null);
      setFitImageSession(null);
      setFitContentSession(null);
      setPotraceSession(null);
      setCanvasEditSession(null);
      setImageCropSession({
        objectId: id,
        rect: { ...rect },
        initialRect: { ...rect },
        imageZoom: 1,
      });
    },
    [objects, message, closeZoomBlurDiscardPreview, exitLamaEraseSession]
  );

  const cancelImageCrop = useCallback(() => setImageCropSession(null), []);

  const openCanvasEdit = useCallback(() => {
    closeZoomBlurDiscardPreview();
    exitLamaEraseSession();
    setImageCropSession(null);
    setRemoveWhiteSession(null);
    setFitImageSession(null);
    setFitContentSession(null);
    setPotraceSession(null);
    setSelectedIds([]);
    setCanvasEditSession({
      rect: { x: 0, y: 0, w: docWidth, h: docHeight },
      initialRect: { x: 0, y: 0, w: docWidth, h: docHeight },
    });
  }, [docWidth, docHeight, closeZoomBlurDiscardPreview, exitLamaEraseSession]);

  const cancelCanvasEdit = useCallback(() => setCanvasEditSession(null), []);

  const applyCanvasEdit = useCallback(() => {
    if (!canvasEditSession) return;
    const r = canvasEditSession.rect;
    const nx = Math.round(r.x);
    const ny = Math.round(r.y);
    const nw = Math.min(8192, Math.max(16, Math.round(r.w)));
    const nh = Math.min(8192, Math.max(16, Math.round(r.h)));
    const applied = { x: nx, y: ny, w: nw, h: nh };
    if (cropDocRectsApproxEqual(applied, canvasEditSession.initialRect)) {
      setCanvasEditSession(null);
      return;
    }
    recordHistory();
    setObjects((prev) => prev.map((o) => ({ ...o, x: o.x - nx, y: o.y - ny })));
    setDocWidth(nw);
    setDocHeight(nh);
    setCanvasEditSession(null);
    message.success('已应用画布裁剪');
  }, [canvasEditSession, message, recordHistory]);

  const applyImageCrop = useCallback(() => {
    if (!imageCropSession) return;
    const sess = imageCropSession;
    if (cropDocRectsApproxEqual(sess.rect, sess.initialRect)) {
      setImageCropSession(null);
      return;
    }
    recordHistory();
    setObjects((prev) => {
      const o = prev.find((x) => x.id === sess.objectId);
      if (!o || o.type !== 'image' || !o.naturalW || !o.naturalH) return prev;
      const F = getFullImageDisplayFrameInDoc(o);
      const Fz = applyZoomAroundCenter(F, sess.imageZoom);
      const sourceCrop = mapDocCropRectToSourceCrop(sess.rect, Fz, o.naturalW, o.naturalH);
      const { x: rx, y: ry, w: rw, h: rh } = sess.rect;
      return prev.map((p) =>
        p.id === o.id ? { ...p, x: rx, y: ry, width: Math.max(1, rw), height: Math.max(1, rh), sourceCrop } : p
      );
    });
    setImageCropSession(null);
    message.success('已应用裁切');
  }, [imageCropSession, message, recordHistory]);

  const onZoomSelect = useCallback((v: string) => {
    if (v === 'fit') {
      setZoomMode('fit');
      setViewPan({ x: 0, y: 0 });
      return;
    }
    setZoomMode('fixed');
    const pct = Number(v);
    if (!Number.isFinite(pct) || pct <= 0) return;
    setZoom(Math.min(4, Math.max(0.05, pct / 100)));
  }, []);

  /** 文件菜单：新建 / 打开本地图 / 从素材库打开后自动适合画布 */
  const zoomToFitCanvas = useCallback(() => {
    setZoomMode('fit');
    setViewPan({ x: 0, y: 0 });
  }, []);

  useEffect(() => {
    window.yiman?.settings?.get().then((s) => setSettingsModels(s.models));
  }, []);

  useEffect(() => {
    window.yiman?.projects?.list().then((list) => {
      if (list) setProjects(list as ProjectRow[]);
    });
    window.yiman?.system?.getFontFaces?.().then((rows) => {
      if (rows?.length) {
        setFontFaces(rows);
        const u = new Set(rows.map((r) => r.familyName));
        setFonts(Array.from(u).sort((a, b) => a.localeCompare(b, 'zh', { sensitivity: 'base' })));
      } else {
        window.yiman?.system?.getFonts?.().then((f) => f?.length && setFonts(f));
      }
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      const meta = e.metaKey || e.ctrlKey;
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const pv = pathVectorEditSessionRef.current;
        if (pv?.selectedVertices.length) {
          const { objectId, selectedVertices } = pv;
          const obj = objects.find((o) => o.id === objectId && o.type === 'path');
          if (!obj || obj.type !== 'path') return;
          const model = tryParsePathData(obj.pathData);
          if (!model) return;
          const next = deleteVerticesAt(model, selectedVertices);
          if (!next) return;
          e.preventDefault();
          recordHistory();
          setObjects((prev) =>
            prev.map((o) => (o.id === objectId ? { ...o, pathData: pathDataFromModel(next) } : o))
          );
          setPathVectorEditSession((s) => (s ? { ...s, selectedVertices: [] } : null));
          return;
        }
        if (pv?.activeSubpaths.length) {
          e.preventDefault();
          onPathVectorDeleteActiveSubpathsRef.current();
          return;
        }
        if (pv) {
          e.preventDefault();
          return;
        }
        if (selectedIds.length === 0) return;
        e.preventDefault();
        recordHistory();
        setObjects((prev) => prev.filter((o) => !selectedIds.includes(o.id)));
        setSelectedIds([]);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, selectedIds, recordHistory, pathVectorEditSession, objects]);

  useEffect(() => {
    if (!pathVectorEditSession) return;
    if (selectedIds.length !== 1 || selectedIds[0] !== pathVectorEditSession.objectId) {
      setPathVectorEditSession(null);
    }
  }, [selectedIds, pathVectorEditSession]);

  useEffect(() => {
    if (!pathVectorEditSession) return;
    const o = objects.find((x) => x.id === pathVectorEditSession.objectId);
    if (!o || o.type !== 'path') setPathVectorEditSession(null);
  }, [objects, pathVectorEditSession]);

  useEffect(() => {
    if (!pathVectorEditSession) setPathSimplifySession(null);
  }, [pathVectorEditSession]);

  useEffect(() => {
    if (!contextMenu) return;
    const onDown = (e: MouseEvent) => {
      const menu = document.getElementById('yiman-image-editor-ctx-menu');
      if (menu?.contains(e.target as Node)) return;
      setContextMenu(null);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [contextMenu]);

  const onUpdateObject = useCallback((id: string, patch: Partial<EditorObject>) => {
    setObjects((prev) => prev.map((o) => (o.id === id ? ({ ...o, ...patch } as EditorObject) : o)));
  }, []);

  const pathVectorEditIdRef = useRef<string | null>(null);
  pathVectorEditIdRef.current = pathVectorEditSession?.objectId ?? null;

  const togglePathVectorEdit = useCallback(() => {
    if (selected?.type !== 'path') return;
    const po = selected as EditorPathObject;
    if (!pathDataEditable(po.pathData)) {
      message.warning('当前路径含不支持的指令，无法进入矢量编辑');
      return;
    }
    setPathVectorEditSession((s) =>
      s?.objectId === po.id ? null : { objectId: po.id, activeSubpaths: [], selectedVertices: [] }
    );
  }, [selected, message]);

  const startPathSimplify = useCallback(() => {
    const pv = pathVectorEditSessionRef.current;
    if (!pv?.activeSubpaths.length) return;
    const obj = objects.find((o) => o.id === pv.objectId && o.type === 'path');
    if (!obj || obj.type !== 'path') return;
    setPathSimplifySession({
      objectId: pv.objectId,
      subpathIndices: [...new Set(pv.activeSubpaths)].sort((a, b) => a - b),
      baselinePathData: obj.pathData,
      curvePrecisionPercent: 18,
    });
  }, [objects]);

  const cancelPathSimplify = useCallback(() => setPathSimplifySession(null), []);

  const applyPathSimplify = useCallback(() => {
    if (!pathSimplifySession) return;
    const nextData = simplifySubpathsByPercent(
      pathSimplifySession.baselinePathData,
      pathSimplifySession.subpathIndices,
      pathSimplifySession.curvePrecisionPercent
    );
    if (!nextData) {
      message.warning('无法生成简化路径');
      return;
    }
    recordHistory();
    const oid = pathSimplifySession.objectId;
    setObjects((prev) =>
      prev.map((o) => (o.id === oid && o.type === 'path' ? { ...o, pathData: nextData } : o))
    );
    setPathSimplifySession(null);
  }, [pathSimplifySession, recordHistory, message]);

  const onPathVectorCommitPathData = useCallback((pathData: string) => {
    const id = pathVectorEditIdRef.current;
    if (!id) return;
    setObjects((prev) =>
      prev.map((o) => (o.id === id && o.type === 'path' ? { ...o, pathData } : o))
    );
  }, []);

  const onPathVectorDeleteActiveSubpaths = useCallback(() => {
    if (!pathVectorEditSession?.activeSubpaths.length) return;
    const { objectId, activeSubpaths } = pathVectorEditSession;
    const toRemoveSorted = [...new Set(activeSubpaths)].sort((a, b) => a - b);
    const toRemoveSet = new Set(toRemoveSorted);
    const obj = objects.find((o) => o.id === objectId && o.type === 'path');
    if (!obj || obj.type !== 'path') return;
    const model = tryParsePathData(obj.pathData);
    if (!model) return;

    const mapSi = (osi: number): number | null => {
      if (toRemoveSet.has(osi)) return null;
      let dec = 0;
      for (const r of toRemoveSorted) {
        if (r < osi) dec++;
      }
      return osi - dec;
    };

    const nextModel = removeSubpathsFromModel(model, toRemoveSorted);

    if (nextModel.subpaths.length === 0) {
      recordHistory();
      setObjects((prev) => prev.filter((o) => o.id !== objectId));
      setPathVectorEditSession(null);
      setSelectedIds((prev) => prev.filter((id) => id !== objectId));
      return;
    }

    let newStyles = obj.pathSubpathStyles;
    if (obj.pathSubpathStyles && obj.pathSubpathStyles.length === model.subpaths.length) {
      newStyles = obj.pathSubpathStyles.filter((_, i) => !toRemoveSet.has(i));
      if (newStyles.length !== nextModel.subpaths.length) newStyles = undefined;
    }

    recordHistory();
    setObjects((prev) =>
      prev.map((o) =>
        o.id === objectId && o.type === 'path'
          ? {
              ...o,
              pathData: pathDataFromModel(nextModel),
              ...(newStyles && newStyles.length === nextModel.subpaths.length
                ? { pathSubpathStyles: newStyles }
                : { pathSubpathStyles: undefined }),
            }
          : o
      )
    );

    setPathVectorEditSession((s) => {
      if (!s) return null;
      const nextActive = s.activeSubpaths.map(mapSi).filter((x): x is number => x != null);
      const nextVerts = s.selectedVertices
        .map((k) => {
          const nsi = mapSi(k.subpathIndex);
          if (nsi == null) return null;
          return { subpathIndex: nsi, vertexIndex: k.vertexIndex };
        })
        .filter(Boolean) as PathVertexKey[];
      return { ...s, activeSubpaths: nextActive, selectedVertices: nextVerts };
    });
  }, [pathVectorEditSession, objects, recordHistory]);

  const onPathVectorMarqueeSelectSubpaths = useCallback(
    (
      docRect: { minX: number; minY: number; maxX: number; maxY: number },
      shiftKey: boolean
    ) => {
      const oid = pathVectorEditSessionRef.current?.objectId;
      if (!oid) return;
      const obj = objects.find((o) => o.id === oid && o.type === 'path') as EditorPathObject | undefined;
      if (!obj) return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;
      const hit = subpathIndicesIntersectingDocRect(obj, model, docRect);
      setPathVectorEditSession((s) => {
        if (!s || s.objectId !== oid) return s;
        const nextActive = shiftKey
          ? [...new Set([...s.activeSubpaths, ...hit])].sort((a, b) => a - b)
          : hit;
        return { ...s, activeSubpaths: nextActive, selectedVertices: [] };
      });
    },
    [objects]
  );

  const onPathVectorBoolean = useCallback(
    (op: PathBooleanOp) => {
      if (!pathVectorEditSession) return;
      const { objectId, activeSubpaths } = pathVectorEditSession;
      if (activeSubpaths.length !== 2 || new Set(activeSubpaths).size !== 2) return;
      const [i0, i1] = activeSubpaths;
      const lo = Math.min(i0, i1);
      const hi = Math.max(i0, i1);
      const obj = objects.find((o) => o.id === objectId && o.type === 'path');
      if (!obj || obj.type !== 'path') return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;

      const spLo = model.subpaths[lo];
      const spHi = model.subpaths[hi];
      if (!spLo || !spHi) return;
      if (!spLo.closed || !spHi.closed) {
        message.warning('布尔运算仅支持封闭 path');
        return;
      }
      /** 见 docs/14 §7.1：pathData 序号小=下层先绘，大=上层后绘；打孔为 下层 − 上层（trace 布尔见 pathBooleanPaper） */
      const dLo = serializeSubpathToD(spLo);
      const dHi = serializeSubpathToD(spHi);
      const resultD = pathBooleanPathData(dLo, dHi, op);
      if (!resultD) {
        message.warning('运算结果为空');
        return;
      }
      const parsedResult = tryParsePathData(resultD);
      if (!parsedResult || parsedResult.subpaths.length === 0) {
        message.warning('无法解析运算结果，请尝试简化路径');
        return;
      }
      /** 只去掉选中的 lo、hi 两段，保留 (lo,hi) 之间的子路径；此前误用 slice(0,lo)+slice(hi+1) 会删掉中间全部轮廓 */
      const subpathsBetween = model.subpaths.slice(lo + 1, hi);
      const newSubpaths = [
        ...model.subpaths.slice(0, lo),
        ...parsedResult.subpaths,
        ...subpathsBetween,
        ...model.subpaths.slice(hi + 1),
      ];

      /** 复合轮廓（外环+内孔）必须在同一 `<path d>` / 单 Konva Path 内用 evenodd 填充；per-subpath 分拆渲染会把孔洞涂实 */
      const compoundBoolean = parsedResult.subpaths.length > 1;

      let newStyles: EditorPathObject['pathSubpathStyles'] = undefined;
      if (!compoundBoolean) {
        const oldLen = model.subpaths.length;
        if (obj.pathSubpathStyles && obj.pathSubpathStyles.length === oldLen) {
          const before = obj.pathSubpathStyles.slice(0, lo);
          const stylesBetween = obj.pathSubpathStyles.slice(lo + 1, hi);
          const after = obj.pathSubpathStyles.slice(hi + 1);
          const tpl = { ...obj.pathSubpathStyles[lo]! };
          const resultStyles = parsedResult.subpaths.map(() => ({ ...tpl }));
          const merged = [...before, ...resultStyles, ...stylesBetween, ...after];
          if (merged.length === newSubpaths.length) newStyles = merged;
        }
      }

      const nextObj: EditorPathObject = {
        ...obj,
        pathData: pathDataFromModel({ subpaths: newSubpaths }),
        ...(newStyles && newStyles.length === newSubpaths.length
          ? { pathSubpathStyles: newStyles }
          : { pathSubpathStyles: undefined }),
      };

      recordHistory();
      setObjects((prev) => prev.map((o) => (o.id === objectId ? nextObj : o)));

      const newCount = parsedResult.subpaths.length;
      setPathVectorEditSession({
        objectId,
        activeSubpaths: Array.from({ length: newCount }, (_, k) => lo + k),
        selectedVertices: [],
      });
    },
    [pathVectorEditSession, objects, recordHistory, message]
  );

  onPathVectorDeleteActiveSubpathsRef.current = onPathVectorDeleteActiveSubpaths;

  const onPathVectorDeleteAnchor = useCallback(() => {
    if (!pathVectorEditSession?.selectedVertices.length) return;
    const { objectId, selectedVertices } = pathVectorEditSession;
    const obj = objects.find((o) => o.id === objectId && o.type === 'path');
    if (!obj || obj.type !== 'path') return;
    const model = tryParsePathData(obj.pathData);
    if (!model) return;
    const next = deleteVerticesAt(model, selectedVertices);
    if (!next) return;
    recordHistory();
    setObjects((prev) =>
      prev.map((o) => (o.id === objectId ? { ...o, pathData: pathDataFromModel(next) } : o))
    );
    setPathVectorEditSession((s) => (s ? { ...s, selectedVertices: [] } : null));
  }, [pathVectorEditSession, objects, recordHistory]);

  const onPathVectorSetCorner = useCallback(
    (corner: boolean) => {
      if (!pathVectorEditSession?.selectedVertices.length) return;
      const { objectId, selectedVertices } = pathVectorEditSession;
      const obj = objects.find((o) => o.id === objectId && o.type === 'path');
      if (!obj || obj.type !== 'path') return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;
      recordHistory();
      let next = model;
      for (const k of selectedVertices) {
        next = setVertexCorner(next, k.subpathIndex, k.vertexIndex, corner);
      }
      setObjects((prev) =>
        prev.map((o) => (o.id === objectId ? { ...o, pathData: pathDataFromModel(next) } : o))
      );
    },
    [pathVectorEditSession, objects, recordHistory]
  );

  const pathVectorCanAddMidAnchor = useMemo(() => {
    if (!pathVectorEditSession || pathVectorEditSession.selectedVertices.length !== 2) return false;
    const obj = objects.find((o) => o.id === pathVectorEditSession.objectId && o.type === 'path');
    if (!obj || obj.type !== 'path') return false;
    const m = tryParsePathData(obj.pathData);
    if (!m) return false;
    const [a, b] = pathVectorEditSession.selectedVertices;
    if (a.subpathIndex !== b.subpathIndex) return false;
    const sp = m.subpaths[a.subpathIndex];
    if (!sp) return false;
    return areVerticesAdjacentOnSubpath(sp, a.vertexIndex, b.vertexIndex);
  }, [pathVectorEditSession, objects]);

  const onPathVectorInsertMidAnchor = useCallback(() => {
    if (!pathVectorEditSession || pathVectorEditSession.selectedVertices.length !== 2) return;
    const { objectId, selectedVertices } = pathVectorEditSession;
    const obj = objects.find((o) => o.id === objectId && o.type === 'path');
    if (!obj || obj.type !== 'path') return;
    const m = tryParsePathData(obj.pathData);
    if (!m) return;
    const [a, b] = selectedVertices;
    if (a.subpathIndex !== b.subpathIndex) return;
    const si = a.subpathIndex;
    const spBefore = m.subpaths[si];
    if (!spBefore) return;
    if (!areVerticesAdjacentOnSubpath(spBefore, a.vertexIndex, b.vertexIndex)) return;
    const es = edgeStartForAdjacentPair(spBefore, a.vertexIndex, b.vertexIndex);
    if (es == null) return;
    const nextIdx = subpathNextVertexIndex(spBefore, es);
    if (nextIdx == null) return;
    const next = insertVertexMidEdgeOnSubpath(m, si, es);
    if (!next) return;
    const spAfter = next.subpaths[si]!;
    const wrapEdge =
      spBefore.closed && es === spBefore.verts.length - 1 && subpathNextVertexIndex(spBefore, es) === 0;
    const newVi = wrapEdge ? spAfter.verts.length - 1 : nextIdx;
    recordHistory();
    setObjects((prev) =>
      prev.map((o) => (o.id === objectId && o.type === 'path' ? { ...o, pathData: pathDataFromModel(next) } : o))
    );
    setPathVectorEditSession((s) =>
      s ? { ...s, selectedVertices: [{ subpathIndex: si, vertexIndex: newVi }] } : null
    );
  }, [pathVectorEditSession, objects, recordHistory]);

  const onPathVectorApplyFillToSelection = useCallback(
    (fill: string) => {
      const pv = pathVectorEditSession;
      if (!pv) return;
      const fromVerts = [...new Set(pv.selectedVertices.map((k) => k.subpathIndex))];
      const sis = [...new Set(fromVerts.length > 0 ? fromVerts : pv.activeSubpaths)]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (sis.length === 0) return;
      const { objectId } = pv;
      const obj = objects.find((o) => o.id === objectId && o.type === 'path');
      if (!obj || obj.type !== 'path') return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;

      recordHistory();
      void (async () => {
        try {
          const tm = tryParsePathData(obj.pathData);
          if (!tm) return;
          let styles: PathSubpathStyleOverride[];
          let clearPattern = false;
          if (obj.fillKind === 'pattern' && obj.patternSrc?.trim()) {
            const built = await subpathStylesFromPatternDominants(obj, obj.patternSrc);
            if (!built) return;
            styles = built;
            clearPattern = true;
          } else {
            styles = ensureEditorPathSubpathStyles(obj, tm.subpaths.length);
          }
          for (const i of sis) {
            if (i >= 0 && i < styles.length) styles[i] = { ...styles[i]!, fill };
          }
          setObjects((prev) =>
            prev.map((o) =>
              o.id === objectId && o.type === 'path'
                ? {
                    ...o,
                    ...(clearPattern ? { fillKind: 'solid' as const, patternSrc: undefined } : {}),
                    pathSubpathStyles: styles,
                  }
                : o
            )
          );
        } catch (e) {
          message.error(e instanceof Error ? e.message : '更新填充失败');
        }
      })();
    },
    [pathVectorEditSession, objects, recordHistory, message]
  );

  const onPathVectorApplyStrokeToSelection = useCallback(
    (stroke: string) => {
      const pv = pathVectorEditSession;
      if (!pv) return;
      const fromVerts = [...new Set(pv.selectedVertices.map((k) => k.subpathIndex))];
      const sis = [...new Set(fromVerts.length > 0 ? fromVerts : pv.activeSubpaths)]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (sis.length === 0) return;
      const { objectId } = pv;
      const obj = objects.find((o) => o.id === objectId && o.type === 'path');
      if (!obj || obj.type !== 'path') return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;

      recordHistory();
      void (async () => {
        try {
          const tm = tryParsePathData(obj.pathData);
          if (!tm) return;
          let styles: PathSubpathStyleOverride[];
          let clearPattern = false;
          if (obj.fillKind === 'pattern' && obj.patternSrc?.trim()) {
            const built = await subpathStylesFromPatternDominants(obj, obj.patternSrc);
            if (!built) return;
            styles = built;
            clearPattern = true;
          } else {
            styles = ensureEditorPathSubpathStyles(obj, tm.subpaths.length);
          }
          for (const i of sis) {
            if (i >= 0 && i < styles.length) styles[i] = { ...styles[i]!, stroke };
          }
          setObjects((prev) =>
            prev.map((o) =>
              o.id === objectId && o.type === 'path'
                ? {
                    ...o,
                    ...(clearPattern ? { fillKind: 'solid' as const, patternSrc: undefined } : {}),
                    pathSubpathStyles: styles,
                  }
                : o
            )
          );
        } catch (e) {
          message.error(e instanceof Error ? e.message : '更新描边失败');
        }
      })();
    },
    [pathVectorEditSession, objects, recordHistory, message]
  );

  const onPathVectorApplyStrokeWidthToSelection = useCallback(
    (strokeWidth: number) => {
      const pv = pathVectorEditSession;
      if (!pv) return;
      const fromVerts = [...new Set(pv.selectedVertices.map((k) => k.subpathIndex))];
      const sis = [...new Set(fromVerts.length > 0 ? fromVerts : pv.activeSubpaths)]
        .filter((i) => i >= 0)
        .sort((a, b) => a - b);
      if (sis.length === 0) return;
      const { objectId } = pv;
      const obj = objects.find((o) => o.id === objectId && o.type === 'path');
      if (!obj || obj.type !== 'path') return;
      const model = tryParsePathData(obj.pathData);
      if (!model) return;

      recordHistory();
      void (async () => {
        try {
          const tm = tryParsePathData(obj.pathData);
          if (!tm) return;
          let styles: PathSubpathStyleOverride[];
          let clearPattern = false;
          if (obj.fillKind === 'pattern' && obj.patternSrc?.trim()) {
            const built = await subpathStylesFromPatternDominants(obj, obj.patternSrc);
            if (!built) return;
            styles = built;
            clearPattern = true;
          } else {
            styles = ensureEditorPathSubpathStyles(obj, tm.subpaths.length);
          }
          for (const i of sis) {
            if (i >= 0 && i < styles.length) styles[i] = { ...styles[i]!, strokeWidth };
          }
          setObjects((prev) =>
            prev.map((o) =>
              o.id === objectId && o.type === 'path'
                ? {
                    ...o,
                    ...(clearPattern ? { fillKind: 'solid' as const, patternSrc: undefined } : {}),
                    pathSubpathStyles: styles,
                  }
                : o
            )
          );
        } catch (e) {
          message.error(e instanceof Error ? e.message : '更新描边宽度失败');
        }
      })();
    },
    [pathVectorEditSession, objects, recordHistory, message]
  );

  const addObject = useCallback(
    (o: EditorObject) => {
      recordHistory();
      setObjects((prev) => [...prev, o]);
      setSelectedIds([o.id]);
    },
    [recordHistory]
  );

  const addShapeFromPreset = useCallback(
    (presetId: ShapePresetId) => {
      addObject(createShapeFromPreset(presetId, docWidth, docHeight));
    },
    [addObject, docWidth, docHeight]
  );

  const moveLayer = useCallback((id: string, dir: 'up' | 'down' | 'top' | 'bottom') => {
    recordHistory();
    setObjects((prev) => {
      const idx = prev.findIndex((o) => o.id === id);
      if (idx < 0) return prev;
      const next = [...prev];
      const [item] = next.splice(idx, 1);
      if (!item) return prev;
      let insertAt = idx;
      if (dir === 'up') insertAt = Math.min(idx + 1, next.length);
      else if (dir === 'down') insertAt = Math.max(idx - 1, 0);
      else if (dir === 'top') insertAt = next.length;
      else insertAt = 0;
      next.splice(insertAt, 0, item);
      return next;
    });
  }, [recordHistory]);

  const toggleLayerVisibility = useCallback((id: string) => {
    recordHistory();
    setObjects((prev) =>
      prev.map((o) => (o.id === id ? { ...o, layerVisible: o.layerVisible === false ? true : false } : o))
    );
  }, [recordHistory]);

  const contextDelete = useCallback((id: string) => {
    recordHistory();
    setObjects((prev) => prev.filter((o) => o.id !== id));
    setSelectedIds((prev) => prev.filter((pid) => pid !== id));
    setContextMenu(null);
  }, [recordHistory]);

  const promptLargeImageInsert = useCallback(
    (iw: number, ih: number, docW: number, docH: number): Promise<LargeImageInsertChoice | null> => {
      setLargeInsertInfo({ iw, ih, docW, docH });
      formLargeInsert.setFieldsValue({ insertMode: 'original', autoEnlargeCanvas: true });
      setLargeInsertModalOpen(true);
      return new Promise((resolve) => {
        largeInsertResolveRef.current = resolve;
      });
    },
    [formLargeInsert]
  );

  const confirmLargeInsertModal = useCallback(async () => {
    try {
      const v = await formLargeInsert.validateFields();
      const resolve = largeInsertResolveRef.current;
      largeInsertResolveRef.current = null;
      setLargeInsertModalOpen(false);
      setLargeInsertInfo(null);
      if (!resolve) return;
      if (v.insertMode === 'fit') resolve({ kind: 'fit' });
      else resolve({ kind: 'original', autoEnlargeCanvas: !!v.autoEnlargeCanvas });
    } catch {
      /* 校验未通过 */
    }
  }, [formLargeInsert]);

  const cancelLargeInsertModal = useCallback(() => {
    largeInsertResolveRef.current?.(null);
    largeInsertResolveRef.current = null;
    setLargeInsertModalOpen(false);
    setLargeInsertInfo(null);
  }, []);

  const insertLoadedImage = useCallback(
    async (
      src: string,
      nw: number,
      nh: number,
      docW: number,
      docH: number,
      placeAt: { x: number; y: number } | null
    ): Promise<InsertLoadedImageResult | null> => {
      if (imageFitsInsideDoc(nw, nh, docW, docH)) {
        const layer = placeAt
          ? imageLayerNaturalAt(src, nw, nh, placeAt.x, placeAt.y)
          : imageLayerNaturalCentered(src, nw, nh, docW, docH);
        return { layer, docW, docH };
      }
      const choice = await promptLargeImageInsert(nw, nh, docW, docH);
      if (!choice) return null;
      if (choice.kind === 'fit') {
        const layer = placeAt
          ? imageLayerContainAt(src, nw, nh, docW, docH, placeAt.x, placeAt.y)
          : imageLayerContainCentered(src, nw, nh, docW, docH);
        return { layer, docW, docH };
      }
      if (choice.autoEnlargeCanvas) {
        const newW = Math.max(docW, nw);
        const newH = Math.max(docH, nh);
        const layer = imageLayerNaturalCentered(src, nw, nh, newW, newH);
        return { layer, docW: newW, docH: newH, zoomFitViewport: true };
      }
      const layer = placeAt
        ? imageLayerNaturalAt(src, nw, nh, placeAt.x, placeAt.y)
        : imageLayerNaturalCentered(src, nw, nh, docW, docH);
      return { layer, docW, docH, zoomFitViewport: true };
    },
    [promptLargeImageInsert]
  );

  const insertLoadedPathObject = useCallback(
    async (
      payload: EditorSvgImportPathPayload,
      docW: number,
      docH: number,
      placeAt: { x: number; y: number } | null
    ): Promise<InsertLoadedPathResult | null> => {
      const { pathData, naturalW, naturalH, pathSubpathStyles } = payload;
      const nw = Math.max(1, naturalW);
      const nh = Math.max(1, naturalH);
      if (imageFitsInsideDoc(nw, nh, docW, docH)) {
        const layer = placeAt
          ? editorPathLayerNaturalAt(pathData, nw, nh, placeAt.x, placeAt.y, pathSubpathStyles)
          : editorPathLayerNaturalCentered(pathData, nw, nh, docW, docH, pathSubpathStyles);
        return { layer: finalizeSvgImportedPathLayer(layer), docW, docH };
      }
      const choice = await promptLargeImageInsert(nw, nh, docW, docH);
      if (!choice) return null;
      if (choice.kind === 'fit') {
        const layer = placeAt
          ? editorPathLayerContainAt(pathData, nw, nh, docW, docH, placeAt.x, placeAt.y, pathSubpathStyles)
          : editorPathLayerContainCentered(pathData, nw, nh, docW, docH, pathSubpathStyles);
        return { layer: finalizeSvgImportedPathLayer(layer), docW, docH };
      }
      if (choice.autoEnlargeCanvas) {
        const newW = Math.max(docW, nw);
        const newH = Math.max(docH, nh);
        const layer = editorPathLayerNaturalCentered(pathData, nw, nh, newW, newH, pathSubpathStyles);
        return {
          layer: finalizeSvgImportedPathLayer(layer),
          docW: newW,
          docH: newH,
          zoomFitViewport: true,
        };
      }
      const layer = placeAt
        ? editorPathLayerNaturalAt(pathData, nw, nh, placeAt.x, placeAt.y, pathSubpathStyles)
        : editorPathLayerNaturalCentered(pathData, nw, nh, docW, docH, pathSubpathStyles);
      return { layer: finalizeSvgImportedPathLayer(layer), docW, docH, zoomFitViewport: true };
    },
    [promptLargeImageInsert]
  );

  const handleInsertImageFromSrc = useCallback(
    async (
      src: string,
      options?: { stem?: string; exportDir?: string | null }
    ): Promise<boolean> => {
      try {
        if (options?.stem != null && options.stem !== '') {
          setExportDefaultStem(sanitizeExportBasename(options.stem));
        }
        if (options && 'exportDir' in options) {
          setExportDefaultDir(options.exportDir ?? null);
        }
        const svgText = tryDecodeSvgTextFromSrc(src);
        if (svgText) {
          const payload = importSvgTextToEditorPathPayload(svgText);
          if (payload) {
            const r = await insertLoadedPathObject(payload, docWidth, docHeight, null);
            if (!r) return false;
            if (r.docW !== docWidth || r.docH !== docHeight) {
              recordHistory();
              setDocWidth(r.docW);
              setDocHeight(r.docH);
              setObjects((prev) => [...prev, r.layer]);
              setSelectedIds([r.layer.id]);
            } else {
              addObject(r.layer);
            }
            if (r.zoomFitViewport) zoomToFitCanvas();
            return true;
          }
        }
        const { w, h } = await loadImageSize(src);
        const r = await insertLoadedImage(src, w, h, docWidth, docHeight, null);
        if (!r) return false;
        if (r.docW !== docWidth || r.docH !== docHeight) {
          recordHistory();
          setDocWidth(r.docW);
          setDocHeight(r.docH);
          setObjects((prev) => [...prev, r.layer]);
          setSelectedIds([r.layer.id]);
        } else {
          addObject(r.layer);
        }
        if (r.zoomFitViewport) zoomToFitCanvas();
        return true;
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error('[ImageEditor] handleInsertImageFromSrc', e);
        message.error(`无法加载图片：${detail}`);
        return false;
      }
    },
    [
      addObject,
      docWidth,
      docHeight,
      message,
      recordHistory,
      insertLoadedImage,
      insertLoadedPathObject,
      zoomToFitCanvas,
    ]
  );

  const loadEditorImportFromDisk = useCallback(
    async (filePath: string): Promise<{ kind: 'raster'; dataUrl: string } | { kind: 'svg'; svgText: string } | null> => {
      const yf = window.yiman?.fs;
      if (yf?.readImageFileForEditor) {
        const r = await yf.readImageFileForEditor(filePath);
        if (!r.ok) {
          message.error(r.error);
          return null;
        }
        if (r.kind === 'svg') return { kind: 'svg', svgText: r.svgText };
        return { kind: 'raster', dataUrl: r.dataUrl };
      }
      const legacy = await yf?.readFileAsDataUrl?.(filePath);
      if (!legacy) {
        message.error('读取文件失败');
        return null;
      }
      if (filePath.toLowerCase().endsWith('.svg')) {
        const svg = tryDecodeSvgTextFromSrc(legacy);
        if (svg) return { kind: 'svg', svgText: svg };
      }
      return { kind: 'raster', dataUrl: legacy };
    },
    [message]
  );

  const onDropImageFiles = useCallback(
    async (files: File[], docPoint: { x: number; y: number }) => {
      const imageFiles = files.filter(
        (f) =>
          f.type.startsWith('image/') ||
          /\.(png|jpe?g|gif|webp|bmp|tiff?|svgz?|pdf|eps|ps|odg)$/i.test(f.name)
      );
      if (!imageFiles.length) return;
      let curDocW = docWidth;
      let curDocH = docHeight;
      let x = docPoint.x;
      let y = docPoint.y;
      const newObjects: EditorObject[] = [];
      let zoomFitAfterDrop = false;
      for (let fi = 0; fi < imageFiles.length; fi++) {
        const f = imageFiles[fi]!;
        try {
          const ext = (f.name.split('.').pop() || '').toLowerCase();
          const absPath = window.yiman?.fs?.getPathForFile?.(f);
          const isSvg = ext === 'svg' || f.type === 'image/svg+xml';

          if (isSvg) {
            let svgText: string | null = null;
            if (absPath && window.yiman?.fs?.readImageFileForEditor) {
              const r = await window.yiman.fs.readImageFileForEditor(absPath);
              if (r.ok && r.kind === 'svg') svgText = r.svgText;
              else if (!r.ok) message.error(`${f.name}：${r.error}`);
            } else if (ext === 'svgz' && !absPath) {
              message.warning(`${f.name}：SVGZ 需在桌面端拖入本地文件（需绝对路径解压）`);
              x += 20;
              y += 20;
              continue;
            } else {
              svgText = await readBrowserFileAsUtf8(f);
            }
            if (!svgText?.trim()) {
              x += 20;
              y += 20;
              continue;
            }
            const payload = importSvgTextToEditorPathPayload(svgText);
            if (!payload) {
              message.warning(`「${f.name}」中未解析到可编辑矢量路径（可能仅有位图或文本）`);
              x += 20;
              y += 20;
              continue;
            }
            const r = await insertLoadedPathObject(payload, curDocW, curDocH, { x, y });
            if (!r) {
              x += 20;
              y += 20;
              continue;
            }
            newObjects.push(r.layer);
            if (r.zoomFitViewport) zoomFitAfterDrop = true;
            curDocW = r.docW;
            curDocH = r.docH;
            if (fi === 0) {
              setExportDefaultStem(filePathOrNameToExportStem(f.name));
              if (absPath && window.yiman?.fs?.pathDirname) {
                const d = await window.yiman.fs.pathDirname(absPath);
                setExportDefaultDir(d?.trim() ? d : null);
              } else {
                setExportDefaultDir(null);
              }
            }
            x += 20;
            y += 20;
            continue;
          }

          let dataUrl: string | null = null;
          if (absPath && window.yiman?.fs?.readImageFileForEditor) {
            const r = await window.yiman.fs.readImageFileForEditor(absPath);
            if (r.ok && r.kind === 'raster') dataUrl = r.dataUrl;
            else if (!r.ok) message.error(`${f.name}：${r.error}`);
          } else if (['pdf', 'eps', 'ps', 'odg', 'svgz'].includes(ext)) {
            message.warning(
              `${f.name}：PDF/EPS/ODG/SVGZ 需从访达/资源管理器拖入，或使用菜单「打开本地图片」`
            );
            x += 20;
            y += 20;
            continue;
          } else {
            dataUrl = await new Promise<string>((resolve, reject) => {
              const r = new FileReader();
              r.onload = () => resolve(String(r.result));
              r.onerror = () => reject(r.error);
              r.readAsDataURL(f);
            });
          }
          if (!dataUrl) {
            x += 20;
            y += 20;
            continue;
          }
          const { w, h } = await loadImageSize(dataUrl);
          const r = await insertLoadedImage(dataUrl, w, h, curDocW, curDocH, { x, y });
          if (!r) {
            x += 20;
            y += 20;
            continue;
          }
          newObjects.push(r.layer);
          if (r.zoomFitViewport) zoomFitAfterDrop = true;
          curDocW = r.docW;
          curDocH = r.docH;
          if (fi === 0) {
            setExportDefaultStem(filePathOrNameToExportStem(f.name));
            if (absPath && window.yiman?.fs?.pathDirname) {
              const d = await window.yiman.fs.pathDirname(absPath);
              setExportDefaultDir(d?.trim() ? d : null);
            } else {
              setExportDefaultDir(null);
            }
          }
          x += 20;
          y += 20;
        } catch (e) {
          const detail = e instanceof Error ? e.message : String(e);
          console.error('[ImageEditor] onDropImageFiles', f.name, e);
          message.error(`无法加载「${f.name}」：${detail}`);
        }
      }
      if (!newObjects.length) return;
      recordHistory();
      if (curDocW !== docWidth || curDocH !== docHeight) {
        setDocWidth(curDocW);
        setDocHeight(curDocH);
      }
      setObjects((prev) => [...prev, ...newObjects]);
      setSelectedIds([newObjects[newObjects.length - 1]!.id]);
      if (zoomFitAfterDrop) zoomToFitCanvas();
    },
    [
      docWidth,
      docHeight,
      message,
      recordHistory,
      insertLoadedImage,
      insertLoadedPathObject,
      zoomToFitCanvas,
    ]
  );

  const onInsertImageClick = useCallback(async () => {
    const path = await window.yiman?.dialog.openFile({
      filters: [{ name: EDITOR_IMAGE_DIALOG_FILTER.name, extensions: [...EDITOR_IMAGE_DIALOG_FILTER.extensions] }],
    });
    if (!path) return;
    const imp = await loadEditorImportFromDisk(path);
    if (!imp) return;
    if (imp.kind === 'svg') {
      const payload = importSvgTextToEditorPathPayload(imp.svgText);
      if (!payload) {
        message.error('未能从 SVG 解析出可编辑路径（可能仅有位图、文本或未支持元素）');
        return;
      }
      setExportDefaultStem(filePathOrNameToExportStem(path));
      {
        const d = (await window.yiman?.fs?.pathDirname?.(path)) ?? '';
        setExportDefaultDir(d.trim() ? d : null);
      }
      const r = await insertLoadedPathObject(payload, docWidth, docHeight, null);
      if (!r) return;
      if (r.docW !== docWidth || r.docH !== docHeight) {
        recordHistory();
        setDocWidth(r.docW);
        setDocHeight(r.docH);
        setObjects((prev) => [...prev, r.layer]);
        setSelectedIds([r.layer.id]);
      } else {
        addObject(r.layer);
      }
      if (r.zoomFitViewport) zoomToFitCanvas();
      return;
    }
    {
      const d = (await window.yiman?.fs?.pathDirname?.(path)) ?? '';
      await handleInsertImageFromSrc(imp.dataUrl, {
        stem: filePathOrNameToExportStem(path),
        exportDir: d.trim() ? d : null,
      });
    }
  }, [
    addObject,
    docWidth,
    docHeight,
    handleInsertImageFromSrc,
    insertLoadedPathObject,
    loadEditorImportFromDisk,
    message,
    recordHistory,
    zoomToFitCanvas,
  ]);

  const onOpenLocalImage = useCallback(async () => {
    const path = await window.yiman?.dialog.openFile({
      filters: [{ name: EDITOR_IMAGE_DIALOG_FILTER.name, extensions: [...EDITOR_IMAGE_DIALOG_FILTER.extensions] }],
    });
    if (!path) return;
    const imp = await loadEditorImportFromDisk(path);
    if (!imp) return;
    if (imp.kind === 'svg') {
      const payload = importSvgTextToEditorPathPayload(imp.svgText);
      if (!payload) {
        message.error('未能从 SVG 解析出可编辑路径（可能仅有位图、文本或未支持元素）');
        return;
      }
      try {
        clearHistoryStacks();
        setExportDefaultStem(filePathOrNameToExportStem(path));
        {
          const d = (await window.yiman?.fs?.pathDirname?.(path)) ?? '';
          setExportDefaultDir(d.trim() ? d : null);
        }
        const layer = finalizeSvgImportedPathLayer(
          editorPathFillDocument(payload.pathData, payload.naturalW, payload.naturalH, payload.pathSubpathStyles)
        );
        setDocWidth(payload.naturalW);
        setDocHeight(payload.naturalH);
        setObjects([layer]);
        setSelectedIds([layer.id]);
        zoomToFitCanvas();
      } catch (e) {
        const detail = e instanceof Error ? e.message : String(e);
        console.error('[ImageEditor] onOpenLocalImage svg', e);
        message.error(`打开 SVG 失败：${detail}`);
      }
      return;
    }
    try {
      const { w, h } = await loadImageSize(imp.dataUrl);
      clearHistoryStacks();
      setExportDefaultStem(filePathOrNameToExportStem(path));
      {
        const d = (await window.yiman?.fs?.pathDirname?.(path)) ?? '';
        setExportDefaultDir(d.trim() ? d : null);
      }
      const layer = editorImageFillDocument(imp.dataUrl, w, h);
      setDocWidth(w);
      setDocHeight(h);
      setObjects([layer]);
      setSelectedIds([layer.id]);
      zoomToFitCanvas();
    } catch (e) {
      const detail = e instanceof Error ? e.message : String(e);
      console.error('[ImageEditor] onOpenLocalImage', e);
      message.error(`打开图片失败：${detail}`);
    }
  }, [clearHistoryStacks, loadEditorImportFromDisk, message, zoomToFitCanvas]);

  const onExport = useCallback(() => {
    setExportModalOpen(true);
  }, []);

  const openSaveToAsset = useCallback(() => {
    const first = projects[0]?.project_dir;
    formSave.setFieldsValue({
      projectDir: assetProjectDir ?? first ?? '',
    });
    setSaveToAssetOpen(true);
  }, [assetProjectDir, formSave, projects]);

  const confirmSaveToAsset = useCallback(async () => {
    const v = await formSave.validateFields().catch(() => null);
    if (!v?.projectDir) return;
    const dataUrl = canvasRef.current?.exportDocPngDataUrl(2);
    if (!dataUrl) {
      message.error('导出失败');
      return;
    }
    const raw = stripDataUrlToBase64(dataUrl);
    const yp = window.yiman?.project;
    if (!yp?.saveAssetFromBase64) return;
    const res = await yp.saveAssetFromBase64(v.projectDir, raw, '.png', 'prop');
    if (!res?.ok) message.error(res?.error ?? '保存失败');
    else {
      setAssetProjectDir(v.projectDir);
      setSaveToAssetOpen(false);
      message.success('已保存到素材库');
    }
  }, [formSave, message]);

  const onImageOpenMatting = useCallback((objectId: string) => {
    const obj = objects.find((o) => o.id === objectId && o.type === 'image');
    if (!obj || obj.type !== 'image') return;
    if (!window.yiman?.project?.matteImageFromDataUrl) {
      message.warning('当前环境不支持抠图主进程接口');
      return;
    }
    setMattingPanel({ objectId });
  }, [objects, message]);

  const confirmNewCanvas = useCallback(() => {
    formNew
      .validateFields()
      .then((v) => {
        let w = Number(v.w);
        let h = Number(v.h);
        if (v.preset !== 'custom') {
          const p = IMAGE_EDITOR_PRESETS.find((x) => `${x.w}x${x.h}` === v.preset);
          if (p) {
            w = p.w;
            h = p.h;
          }
        }
        clearHistoryStacks();
        setDocWidth(w);
        setDocHeight(h);
        setDocBackgroundColor(IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND);
        setObjects([]);
        setSelectedIds([]);
        setExportDefaultStem(formatExportUnnamedStem());
        setExportDefaultDir(null);
        setNewCanvasOpen(false);
        zoomToFitCanvas();
        message.success('已新建画布');
      })
      .catch(() => {});
  }, [formNew, message, zoomToFitCanvas, clearHistoryStacks]);

  const mattingImageLayer = mattingPanel
    ? (objects.find((o) => o.id === mattingPanel.objectId && o.type === 'image') as EditorImageObject | undefined)
    : undefined;

  const mattingStandalone = useMemo(() => {
    if (!mattingPanel || !mattingImageLayer?.src || !window.yiman?.project?.matteImageFromDataUrl) return null;
    const srcSnapshot = mattingImageLayer.src;
    return {
      sourceDataUrl: srcSnapshot,
      onApply: (itemId: string, dataUrl: string) => {
        recordHistory();
        setObjects((p) => p.map((o) => (o.id === itemId ? { ...o, src: dataUrl } : o)));
      },
      matteImageFromDataUrl: (u: string, o?: { mattingModel?: string; downsampleRatio?: number }) =>
        window.yiman!.project.matteImageFromDataUrl(u, o),
    };
  }, [mattingPanel?.objectId, mattingImageLayer?.src, recordHistory]);

  useEffect(() => {
    if (mattingPanel && !mattingImageLayer) setMattingPanel(null);
  }, [mattingPanel, mattingImageLayer]);

  return (
    <div className="yiman-image-editor">
      <EditorHeader
        onBack={() => navigate(-1)}
        zoomPercentRounded={zoomPercentRounded}
        zoomSelectValue={zoomSelectValue}
        zoomTooltipTitle={zoomTooltipTitle}
        onZoomSelect={onZoomSelect}
        onInsertImage={onInsertImageClick}
        onInsertShapePreset={addShapeFromPreset}
        onInsertText={() => addObject(defaultText())}
        onAiGenerate={() => setAiOpen(true)}
        aiDisabled={!drawerModelCheck.hasValidModel}
        aiDisabledReason={
          drawerModelCheck.missingCapabilityLabels.length ? '请在设置中添加具备「绘图」能力且已填 API 的模型' : undefined
        }
        onExport={onExport}
        onSaveToAsset={openSaveToAsset}
        saveToAssetDisabled={projects.length === 0}
        onOpenNewCanvas={() => setNewCanvasOpen(true)}
        onOpenLocalImage={onOpenLocalImage}
        onOpenFromLibrary={() => setAssetPickOpen(true)}
        libraryDisabled={projects.length === 0}
        onSave={saveHistoryProject}
        hasOpenProject={!!historyProjectId}
        onUndo={undo}
        onRedo={redo}
        undoDisabled={!canUndo}
        redoDisabled={!canRedo}
      />
      <div className="yiman-image-editor-body">
        <EditorWorkspace
          objects={objects}
          selectedIds={selectedIds}
          onPickLayer={onSelectChange}
          onMoveLayer={moveLayer}
          onToggleLayerVisibility={toggleLayerVisibility}
        />
        <EditorCanvas
          ref={canvasRef}
          docWidth={docWidth}
          docHeight={docHeight}
          docBackgroundColor={docBackgroundColor}
          fontFaces={fontFaces}
          objects={objects}
          onObjectsChange={setObjects}
          selectedIds={selectedIds}
          onSelectChange={onSelectChange}
          zoom={zoom}
          viewPan={viewPan}
          onViewPanGestureDelta={onViewPanGestureDelta}
          onZoomGestureAt={onZoomGestureAt}
          onContextMenu={(e) => setContextMenu(e)}
          onViewportSize={onViewportSize}
          imageCropModeId={imageCropSession?.objectId ?? null}
          imageCropPreviewZoom={imageCropSession?.imageZoom ?? 1}
          canvasEditMode={!!canvasEditSession}
          adjustOverlayLock={adjustOverlayLock}
          canvasEditRect={canvasEditSession?.rect ?? null}
          onImageNaturalSize={onImageNaturalSize}
          onBeforeObjectGesture={recordHistory}
          onDropImageFiles={onDropImageFiles}
          pathSimplifyDimPathId={pathSimplifySession?.objectId ?? null}
          pathVectorEdit={
            pathVectorEditSession
              ? {
                  objectId: pathVectorEditSession.objectId,
                  ui: {
                    activeSubpaths: pathVectorEditSession.activeSubpaths,
                    selectedVertices: pathVectorEditSession.selectedVertices,
                  },
                  onUiChange: (patch) =>
                    setPathVectorEditSession((prev) => (prev ? { ...prev, ...patch } : null)),
                  onCommitPathData: onPathVectorCommitPathData,
                  onGestureStart: recordHistory,
                  onMarqueeSelectSubpaths: onPathVectorMarqueeSelectSubpaths,
                  simplifyPreview: pathSimplifySession ? pathVectorSimplifyPreview : null,
                  suspendVectorInteraction: !!pathSimplifySession,
                }
              : null
          }
          cropOverlay={
            <>
              {imageCropSession && cropTargetImage && cropEditFrame ? (
                <ImageCropOverlay
                  session={imageCropSession}
                  imageBounds={cropEditFrame}
                  cx={canvasInset.cx}
                  cy={canvasInset.cy}
                  zoom={zoom}
                  onSessionChange={setImageCropSession}
                  onDone={applyImageCrop}
                  onCancel={cancelImageCrop}
                />
              ) : null}
              {canvasEditSession && !imageCropSession ? (
                <CanvasCropOverlay
                  session={canvasEditSession}
                  cx={canvasInset.cx}
                  cy={canvasInset.cy}
                  zoom={zoom}
                  onSessionChange={setCanvasEditSession}
                  onCancel={cancelCanvasEdit}
                />
              ) : null}
              {potraceSession ? (
                <PotracePreviewOverlay
                  show
                  cx={canvasInset.cx}
                  cy={canvasInset.cy}
                  zoom={zoom}
                  docRect={potraceSession.docRect}
                  pathD={potraceSession.previewPathData}
                  traceW={potraceSession.traceW}
                  traceH={potraceSession.traceH}
                  preserveColor={potraceSession.preserveColor}
                  dominantFillCss={potraceDominantPreviewCss}
                />
              ) : null}
              {zoomBlurSession && zoomBlurTargetImage ? (
                <ZoomBlurOriginOverlay
                  imageLayer={zoomBlurTargetImage}
                  originXN={zoomBlurSession.originXN}
                  originYN={zoomBlurSession.originYN}
                  onOriginChange={(nx, ny) =>
                    setZoomBlurSession((s) => (s ? { ...s, originXN: nx, originYN: ny } : s))
                  }
                  cx={canvasInset.cx}
                  cy={canvasInset.cy}
                  zoom={zoom}
                />
              ) : null}
              {removeWhiteSession ? (
                <RemoveWhiteAdjustToolbar
                  tolerance={removeWhiteSession.tolerance}
                  whiteGrayOnly={removeWhiteSession.whiteGrayOnly}
                  onToleranceChange={(tolerance) =>
                    setRemoveWhiteSession((s) => (s ? { ...s, tolerance } : s))
                  }
                  onToleranceChangeComplete={(tolerance) => {
                    setRemoveWhiteSession((s) => (s ? { ...s, tolerance } : s));
                    setRemoveWhitePreviewTick((t) => t + 1);
                  }}
                  onWhiteGrayOnlyChange={(whiteGrayOnly) => {
                    setRemoveWhiteSession((s) => (s ? { ...s, whiteGrayOnly } : s));
                    setRemoveWhitePreviewTick((t) => t + 1);
                  }}
                  onCancel={cancelRemoveWhiteAdjust}
                  onApply={() => void applyRemoveWhiteAdjust()}
                  loading={imageProcessing}
                />
              ) : null}
              {pathSimplifySession ? (
                <PathSimplifyAdjustToolbar
                  curvePrecisionPercent={pathSimplifySession.curvePrecisionPercent}
                  onCurvePrecisionChange={(curvePrecisionPercent) =>
                    setPathSimplifySession((s) => (s ? { ...s, curvePrecisionPercent } : s))
                  }
                  onCurvePrecisionChangeComplete={(curvePrecisionPercent) =>
                    setPathSimplifySession((s) => (s ? { ...s, curvePrecisionPercent } : s))
                  }
                  onCancel={cancelPathSimplify}
                  onApply={applyPathSimplify}
                />
              ) : null}
              {fitImageSession ? (
                <FitImageToCanvasToolbar
                  edgePadding={fitImageSession.edgePadding}
                  maintainAspect={fitImageSession.maintainAspect}
                  onEdgePaddingChange={(edgePadding) =>
                    setFitImageSession((s) => (s ? { ...s, edgePadding } : s))
                  }
                  onMaintainAspectChange={(maintainAspect) =>
                    setFitImageSession((s) => (s ? { ...s, maintainAspect } : s))
                  }
                  onCancel={cancelFitImageToCanvas}
                  onApply={applyFitImageToCanvas}
                />
              ) : null}
              {fitContentSession ? (
                <FitContentToolbar
                  edgePadding={fitContentSession.edgePadding}
                  previewW={fitContentPreview.w}
                  previewH={fitContentPreview.h}
                  onEdgePaddingChange={(edgePadding) =>
                    setFitContentSession((s) => (s ? { ...s, edgePadding } : s))
                  }
                  onCancel={cancelFitContentAdjust}
                  onApply={applyFitContentAdjust}
                />
              ) : null}
              {potraceSession ? (
                <PotraceAdjustToolbar
                  threshold={potraceSession.threshold}
                  useOtsu={potraceSession.useOtsu}
                  turdSize={potraceSession.turdSize}
                  simplifyEpsilon={potraceSession.simplifyEpsilon}
                  curveTension={potraceSession.curveTension}
                  cornerAngleThreshold={potraceSession.cornerAngleThreshold}
                  adaptiveSimplify={potraceSession.adaptiveSimplify}
                  preserveColor={potraceSession.preserveColor}
                  ignoreWhite={potraceSession.ignoreWhite}
                  edgeErosionPasses={potraceSession.edgeErosionPasses}
                  fringeSuppressMinRgb={potraceSession.fringeSuppressMinRgb}
                  onThresholdChange={(threshold) =>
                    setPotraceSession((s) => (s ? { ...s, threshold } : s))
                  }
                  onUseOtsuChange={(useOtsu) => {
                    setPotraceSession((s) => (s ? { ...s, useOtsu } : s));
                    setPotracePreviewTick((t) => t + 1);
                  }}
                  onTurdSizeChange={(turdSize) =>
                    setPotraceSession((s) => (s ? { ...s, turdSize } : s))
                  }
                  onSimplifyChange={(simplifyEpsilon) =>
                    setPotraceSession((s) => (s ? { ...s, simplifyEpsilon } : s))
                  }
                  onCurveTensionChange={(curveTension) =>
                    setPotraceSession((s) => (s ? { ...s, curveTension } : s))
                  }
                  onCornerAngleThresholdChange={(cornerAngleThreshold) =>
                    setPotraceSession((s) => (s ? { ...s, cornerAngleThreshold } : s))
                  }
                  onAdaptiveSimplifyChange={(adaptiveSimplify) =>
                    setPotraceSession((s) => (s ? { ...s, adaptiveSimplify } : s))
                  }
                  onPreserveColorChange={(preserveColor) => {
                    setPotraceSession((s) => (s ? { ...s, preserveColor } : s));
                    setPotracePreviewTick((t) => t + 1);
                  }}
                  onIgnoreWhiteChange={(ignoreWhite) => {
                    setPotraceSession((s) => (s ? { ...s, ignoreWhite } : s));
                    setPotracePreviewTick((t) => t + 1);
                  }}
                  onEdgeErosionPassesChange={(edgeErosionPasses) =>
                    setPotraceSession((s) => (s ? { ...s, edgeErosionPasses } : s))
                  }
                  onFringeSuppressMinRgbChange={(fringeSuppressMinRgb) =>
                    setPotraceSession((s) => (s ? { ...s, fringeSuppressMinRgb } : s))
                  }
                  onPresetChange={(presetId: PotracePresetId) => {
                    const preset = POTRACE_PRESETS[presetId];
                    if (preset) {
                      setPotraceSession((s) =>
                        s ? { ...s, ...preset.config } : s
                      );
                      setPotracePreviewTick((t) => t + 1);
                    }
                  }}
                  onParamCommit={() => setPotracePreviewTick((t) => t + 1)}
                  onCancel={cancelPotraceAdjust}
                  onApply={() => void applyPotraceAdjust()}
                  loading={imageProcessing}
                />
              ) : null}
              {zoomBlurSession ? (
                <ZoomBlurAdjustToolbar
                  radiusPercent={zoomBlurSession.radiusPercent}
                  onRadiusChange={(radiusPercent) =>
                    setZoomBlurSession((s) => (s ? { ...s, radiusPercent } : s))
                  }
                  sampleStepsMax={zoomBlurSession.sampleStepsMax}
                  onSampleStepsMaxChange={(sampleStepsMax) =>
                    setZoomBlurSession((s) => (s ? { ...s, sampleStepsMax } : s))
                  }
                  onCancel={cancelZoomBlurAdjust}
                  onApply={() => void applyZoomBlurAdjust()}
                  loading={imageProcessing}
                />
              ) : null}
              {lamaEraseSession && lamaPaintImageLayer ? (
                <LamaErasePaintOverlay
                  ref={lamaPaintRef}
                  imageLayer={lamaPaintImageLayer}
                  cx={canvasInset.cx}
                  cy={canvasInset.cy}
                  zoom={zoom}
                  imagePixelW={lamaEraseSession.imagePixelW}
                  imagePixelH={lamaEraseSession.imagePixelH}
                  brushRadiusPx={lamaEraseSession.brushRadiusPx}
                  paintingLocked={lamaEraseBusy}
                  resultPreviewUrl={lamaEraseResultUrl}
                  onMaskDirty={() => setLamaHasMask(lamaPaintRef.current?.hasMask() ?? false)}
                />
              ) : null}
              {lamaEraseSession ? (
                <LamaEraseAdjustToolbar
                  brushRadiusPx={lamaEraseSession.brushRadiusPx}
                  onBrushRadiusChange={(brushRadiusPx) =>
                    setLamaEraseSession((s) => (s ? { ...s, brushRadiusPx } : s))
                  }
                  hasMask={lamaHasMask}
                  onClearEraser={clearLamaErasePaint}
                  onStartErase={() => void runLamaInpaint()}
                  resultReady={!!lamaEraseResultUrl}
                  onDiscardResult={() => setLamaEraseResultUrl(null)}
                  onApply={applyLamaErase}
                  onExitAdjust={exitLamaEraseSession}
                  eraseLoading={lamaEraseBusy}
                />
              ) : null}
            </>
          }
        />
        <EditorInspector
          selected={selected}
          selectedIds={selectedIds}
          onAlignMulti={onAlignMulti}
          onDistributeMulti={onDistributeMulti}
          docWidth={docWidth}
          docHeight={docHeight}
          docBackgroundColor={docBackgroundColor}
          onDocBackgroundColorChange={setDocBackgroundColor}
          recordHistory={recordHistory}
          shapeMaskEligible={shapeMaskEligible}
          onApplyShapeMask={() => void applyShapeMaskFromSelection()}
          shapeMaskLoading={shapeMaskLoading}
          systemFonts={fonts}
          fontFaces={fontFaces}
          onUpdate={onUpdateObject}
          onImageOpenMatting={onImageOpenMatting}
          onStartRemoveWhiteAdjust={startRemoveWhiteAdjust}
          onTrimImageTransparentEdges={trimImageTransparentEdges}
          onStartPotraceAdjust={startPotraceAdjust}
          onStartZoomBlurAdjust={startZoomBlurAdjust}
          onStartLamaEraseAdjust={onStartLamaEraseAdjust}
          onStartFitImageToCanvas={startFitImageToCanvas}
          onStartFitContent={startFitContentAdjust}
          imageSidebarToolsLocked={
            !!imageCropSession ||
            !!canvasEditSession ||
            !!removeWhiteSession ||
            !!potraceSession ||
            !!zoomBlurSession ||
            !!fitImageSession ||
            !!fitContentSession ||
            !!lamaEraseSession ||
            !!pathVectorEditSession ||
            !!pathSimplifySession
          }
          fitContentDisabled={
            objects.length === 0 ||
            !!canvasEditSession ||
            !!fitContentSession ||
            !!imageCropSession ||
            !!removeWhiteSession ||
            !!potraceSession ||
            !!zoomBlurSession ||
            !!fitImageSession ||
            !!lamaEraseSession
          }
          onStartImageCrop={startImageCrop}
          onOpenCanvasEdit={openCanvasEdit}
          canvasEditSession={canvasEditSession}
          setCanvasEditSession={setCanvasEditSession}
          onApplyCanvasEdit={applyCanvasEdit}
          onCancelCanvasEdit={cancelCanvasEdit}
          pathVectorEditActive={!!pathVectorEditSession && pathVectorEditSession.objectId === selected?.id}
          pathVectorUi={
            pathVectorEditSession
              ? {
                  activeSubpaths: pathVectorEditSession.activeSubpaths,
                  selectedVertices: pathVectorEditSession.selectedVertices,
                }
              : null
          }
          pathVectorPathEditable={selected?.type === 'path' ? pathDataEditable(selected.pathData) : false}
          pathVectorCanAddMidAnchor={pathVectorCanAddMidAnchor}
          onTogglePathVectorEdit={togglePathVectorEdit}
          onPathVectorDeleteAnchor={onPathVectorDeleteAnchor}
          onPathVectorSetCorner={onPathVectorSetCorner}
          onPathVectorInsertMidAnchor={onPathVectorInsertMidAnchor}
          onPathVectorDeleteActiveSubpaths={onPathVectorDeleteActiveSubpaths}
          onPathVectorBoolean={onPathVectorBoolean}
          onPathVectorApplyFillToSelection={onPathVectorApplyFillToSelection}
          onPathVectorApplyStrokeToSelection={onPathVectorApplyStrokeToSelection}
          onPathVectorApplyStrokeWidthToSelection={onPathVectorApplyStrokeWidthToSelection}
          pathSimplifyPanelOpen={!!pathSimplifySession}
          onStartPathSimplify={startPathSimplify}
        />
      </div>

      {contextMenu && (
        <div
          id="yiman-image-editor-ctx-menu"
          className="yiman-image-editor-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button type="button" onClick={() => contextDelete(contextMenu.objectId)}>
            删除
          </button>
          <button type="button" onClick={() => moveLayer(contextMenu.objectId, 'top')}>
            置于顶层
          </button>
          <button type="button" onClick={() => moveLayer(contextMenu.objectId, 'up')}>
            上移一层
          </button>
          <button type="button" onClick={() => moveLayer(contextMenu.objectId, 'down')}>
            下移一层
          </button>
          <button type="button" onClick={() => moveLayer(contextMenu.objectId, 'bottom')}>
            置于底层
          </button>
        </div>
      )}

      <ImageEditorExportModal
        open={exportModalOpen}
        onClose={() => setExportModalOpen(false)}
        canvasRef={canvasRef}
        objects={objects}
        docWidth={docWidth}
        docHeight={docHeight}
        docBackgroundColor={docBackgroundColor}
        exportDefaultStem={exportDefaultStem}
        exportDefaultDir={exportDefaultDir}
        stripDataUrlToBase64Fn={stripDataUrlToBase64}
        onSuccess={() => message.success('已导出')}
        onError={(msg) => message.error(msg)}
      />

      <Modal
        title="安装 IOPaint（智能擦除）"
        open={lamaInstallModalOpen}
        centered
        onCancel={() => setLamaInstallModalOpen(false)}
        destroyOnHidden
        footer={[
          <Button key="close" onClick={() => setLamaInstallModalOpen(false)}>
            稍后
          </Button>,
          <Button key="term" type="primary" onClick={() => void openLamaInstallInTerminal()}>
            在终端安装并启动
          </Button>,
          <Button key="retry" onClick={() => void retryLamaConnection()}>
            重试连接
          </Button>,
        ]}
      >
        <p style={{ marginBottom: 0, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6 }}>
          未在芝绘专用虚拟环境中检测到 IOPaint（PyPI 包名 <code style={{ color: 'rgba(255,255,255,0.9)' }}>iopaint</code>
          ，旧名 lama-cleaner）。请点击「在终端安装并启动」：终端会先让你按需输入环境设置（代理、镜像等，每行一条 shell；不需要则直接回车），再<strong style={{ fontWeight: 600 }}>仅使用本机已安装的 Python 3.10</strong>
          （<code style={{ color: 'rgba(255,255,255,0.9)' }}>python3.10</code>
          ）创建 venv，依次安装 PyTorch（含 macOS MPS）与 <code style={{ color: 'rgba(255,255,255,0.9)' }}>iopaint</code>
          并启动。
          在 <strong style={{ fontWeight: 600 }}>Apple Silicon</strong> 上会使用 <strong style={{ fontWeight: 600 }}>MPS</strong> 加速；应用自动拉起服务时同样会在 Apple Silicon 上使用 MPS。
          若日志里出现 <code style={{ color: 'rgba(255,255,255,0.9)' }}>python3.11</code>
          、<code style={{ color: 'rgba(255,255,255,0.9)' }}>python3.13</code>
          等路径或 Pillow 构建失败，说明旧 venv 不是 3.10：请先关闭终端，在访达或终端中删除目录
          <code style={{ color: 'rgba(255,255,255,0.9)' }}>~/Library/Application Support/芝绘/yiman/venv-lama-cleaner</code>
          （若数据在备用路径则为 <code style={{ color: 'rgba(255,255,255,0.9)' }}>~/.yiman/venv-lama-cleaner</code>
          ），并确保已安装 <code style={{ color: 'rgba(255,255,255,0.9)' }}>python3.10</code>
          （如 <code style={{ color: 'rgba(255,255,255,0.9)' }}>brew install python@3.10</code>
          ），再点「在终端安装并启动」。
          首次拉取模型可能较慢，完成后请点击「重试连接」。安装过程中请勿关闭本窗口。
        </p>
      </Modal>

      <Modal
        title="图片大于当前画布"
        centered
        open={largeInsertModalOpen}
        onOk={() => void confirmLargeInsertModal()}
        onCancel={cancelLargeInsertModal}
        destroyOnHidden
        okText="确定"
        cancelText="取消"
      >
        {largeInsertInfo ? (
          <div style={{ marginBottom: 12, fontSize: 13, color: 'rgba(255,255,255,0.55)' }}>
            画布 {largeInsertInfo.docW}×{largeInsertInfo.docH}，图片 {largeInsertInfo.iw}×{largeInsertInfo.ih}
          </div>
        ) : null}
        <Form form={formLargeInsert} layout="vertical" initialValues={{ insertMode: 'original', autoEnlargeCanvas: true }}>
          <Form.Item name="insertMode" label="插入方式">
            <Radio.Group>
              <Space orientation="vertical" size="middle">
                <Radio value="original">使用图片原始尺寸</Radio>
                <Form.Item noStyle dependencies={['insertMode']}>
                  {() =>
                    formLargeInsert.getFieldValue('insertMode') === 'original' ? (
                      <Form.Item
                        name="autoEnlargeCanvas"
                        valuePropName="checked"
                        style={{ marginBottom: 0, marginLeft: 24 }}
                      >
                        <Space>
                          <span style={{ color: 'rgba(255,255,255,0.85)' }}>自动放大画布</span>
                          <Switch defaultChecked />
                        </Space>
                      </Form.Item>
                    ) : null
                  }
                </Form.Item>
                <Radio value="fit">等比缩放到画布</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="保存到素材库"
        centered
        open={saveToAssetOpen}
        onOk={() => void confirmSaveToAsset()}
        onCancel={() => setSaveToAssetOpen(false)}
        destroyOnHidden
        okText="保存"
      >
        <Form form={formSave} layout="vertical">
          <Form.Item name="projectDir" label="保存到漫剧项目" rules={[{ required: true, message: '请选择项目' }]}>
            <Select
              placeholder="选择项目"
              options={projects.map((p) => ({ value: p.project_dir, label: p.name }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal title="新建空白画布" centered open={newCanvasOpen} onOk={confirmNewCanvas} onCancel={() => setNewCanvasOpen(false)} destroyOnHidden>
        <Form form={formNew} layout="vertical" initialValues={{ preset: '1024x768', w: 1024, h: 768 }}>
          <Form.Item name="preset" label="预设">
            <Select
              options={[
                ...IMAGE_EDITOR_PRESETS.map((p) => ({ value: `${p.w}x${p.h}`, label: p.label })),
                { value: 'custom', label: '自定义宽高' },
              ]}
            />
          </Form.Item>
          <Form.Item noStyle shouldUpdate={(a, b) => a.preset !== b.preset}>
            {() =>
              formNew.getFieldValue('preset') === 'custom' ? (
                <Space>
                  <Form.Item name="w" label="宽" rules={[{ required: true }]}>
                    <InputNumber min={16} max={8192} />
                  </Form.Item>
                  <Form.Item name="h" label="高" rules={[{ required: true }]}>
                    <InputNumber min={16} max={8192} />
                  </Form.Item>
                </Space>
              ) : null
            }
          </Form.Item>
        </Form>
      </Modal>

      <AssetPickModal
        open={assetPickOpen}
        onCancel={() => setAssetPickOpen(false)}
        projects={projects}
        initialProjectDir={assetProjectDir}
        onPick={async (projectDir, dataUrl, assetPath) => {
          setAssetPickOpen(false);
          setAssetProjectDir(projectDir);
          const fs = window.yiman?.fs;
          let exportDir: string | null = null;
          if (fs?.pathJoin && fs.pathDirname) {
            const full = await fs.pathJoin(projectDir, assetPath);
            const d = await fs.pathDirname(full);
            exportDir = d?.trim() ? d : projectDir.trim() ? projectDir : null;
          } else {
            exportDir = projectDir.trim() ? projectDir : null;
          }
          if (await handleInsertImageFromSrc(dataUrl, { stem: filePathOrNameToExportStem(assetPath), exportDir })) {
            zoomToFitCanvas();
          }
        }}
      />

      {mattingPanel && mattingStandalone ? (
        <MattingSettingsPanel
          open
          onClose={() => setMattingPanel(null)}
          itemId={mattingPanel.objectId}
          standalone={mattingStandalone}
        />
      ) : null}

      <Modal
        title="AI 生成图片"
        open={aiOpen}
        centered
        confirmLoading={aiLoading}
        onOk={async () => {
          const v = await formAi.validateFields().catch(() => null);
          if (!v || !drawerModelCheck.model) return;
          setAiLoading(true);
          try {
            const res = await generateDrawerImageForEditor(drawerModelCheck.model, v.prompt, {
              docWidth,
              docHeight,
              aspectRatio: 'canvas',
            });
            if (!res.ok) {
              message.error(res.error);
              return;
            }
            await handleInsertImageFromSrc(res.url, {
              stem: formatExportUnnamedStem(),
              exportDir: null,
            });
            setAiOpen(false);
            formAi.resetFields();
            message.success('已插入画布');
          } finally {
            setAiLoading(false);
          }
        }}
        onCancel={() => setAiOpen(false)}
        destroyOnHidden
      >
        <Spin spinning={aiLoading}>
          <Form form={formAi} layout="vertical">
            <Form.Item name="prompt" label="描述画面" rules={[{ required: true, message: '请输入内容' }]}>
              <Input.TextArea rows={4} placeholder="例如：阳光下的卡通小猫，扁平插画" />
            </Form.Item>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)' }}>
              出图比例将尽量接近当前画布 {docWidth}×{docHeight}
            </div>
          </Form>
        </Spin>
      </Modal>
    </div>
  );
};

function AssetThumb({ projectDir, path }: { projectDir: string; path: string }) {
  const [src, setSrc] = useState('');
  useEffect(() => {
    let cancelled = false;
    window.yiman?.project.getAssetDataUrl(projectDir, path).then((u) => {
      if (!cancelled && u) setSrc(u);
    });
    return () => {
      cancelled = true;
    };
  }, [projectDir, path]);
  if (!src) return <div style={{ width: '100%', height: '100%', background: '#2a2a2a' }} />;
  return <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />;
}

function AssetPickModal({
  open,
  onCancel,
  projects,
  initialProjectDir,
  onPick,
}: {
  open: boolean;
  onCancel: () => void;
  projects: ProjectRow[];
  initialProjectDir: string | null;
  onPick: (projectDir: string, dataUrl: string, assetPath: string) => void | Promise<void>;
}) {
  const [projectDir, setProjectDir] = useState<string | null>(null);
  const [assets, setAssets] = useState<{ id: string; path: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const { message } = App.useApp();

  useEffect(() => {
    if (open && initialProjectDir) setProjectDir(initialProjectDir);
  }, [open, initialProjectDir]);

  useEffect(() => {
    if (!open || !projectDir) {
      setAssets([]);
      return;
    }
    setLoading(true);
    window.yiman?.project
      ?.getAssets(projectDir)
      .then((list) => {
        const imgs = (list ?? []).filter((a: { path: string }) => /\.(png|jpg|jpeg|gif|webp)$/i.test(a.path));
        setAssets(imgs);
      })
      .finally(() => setLoading(false));
  }, [open, projectDir]);

  return (
    <Modal title="从素材库插入图片" centered open={open} onCancel={onCancel} footer={null} width={560} destroyOnHidden>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Select
          style={{ width: '100%' }}
          placeholder="选择漫剧项目"
          value={projectDir ?? undefined}
          onChange={(v) => setProjectDir(v)}
          options={projects.map((p) => ({ value: p.project_dir, label: p.name }))}
        />
        <Spin spinning={loading}>
          <div style={{ maxHeight: 320, overflow: 'auto', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {assets.map((a) => (
              <button
                key={a.id}
                type="button"
                style={{
                  width: 88,
                  height: 88,
                  padding: 0,
                  border: '1px solid rgba(255,255,255,0.12)',
                  borderRadius: 8,
                  overflow: 'hidden',
                  cursor: 'pointer',
                  background: '#1f1f1f',
                }}
                onClick={async () => {
                  if (!projectDir) return;
                  const url = await window.yiman?.project.getAssetDataUrl(projectDir, a.path);
                  if (!url) {
                    message.error('读取素材失败');
                    return;
                  }
                  await onPick(projectDir, url, a.path);
                }}
              >
                <AssetThumb projectDir={projectDir!} path={a.path} />
              </button>
            ))}
          </div>
        </Spin>
      </Space>
    </Modal>
  );
}
