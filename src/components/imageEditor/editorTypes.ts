/**
 * 图片编辑器：文档与画布对象类型（见 docs/12-图片编辑功能设计.md）
 */

export const IMAGE_EDITOR_PRESETS = [
  { w: 1024, h: 768, label: '1024×768（默认）' },
  { w: 1080, h: 1920, label: '竖屏 1080×1920' },
  { w: 1920, h: 1080, label: '横屏 1920×1080' },
  { w: 1080, h: 1080, label: '方形 1080×1080' },
  { w: 800, h: 600, label: '800×600' },
] as const;

/** 画布底色：默认透明，也可为 ColorPicker 产出的 CSS 颜色串 */
export const IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND = 'transparent' as const;

/** 文档底 Rect 的 Konva fill；透明时与棋盘格叠显 */
export function docBackgroundToKonvaFill(docBackgroundCss: string): string {
  const t = docBackgroundCss.trim().toLowerCase();
  if (t === 'transparent' || t === '') return 'rgba(0,0,0,0)';
  return docBackgroundCss;
}

export type ImageStylePreset =
  | 'none'
  | 'vivid'
  | 'gray'
  | 'warm'
  | 'cool'
  /** Konva Sepia */
  | 'sepia'
  /** Konva Invert */
  | 'invert'
  /** 低对比、略压暗 */
  | 'soft'
  /** 高对比 */
  | 'dramatic'
  /** 低饱和、略提亮 */
  | 'fade'
  /** 灰阶 + 对比 + 略压暗 */
  | 'noir';

/** 花字一键样式 id（画布侧用描边/阴影近似；卡片预览可用更丰富的 CSS） */
export const TEXT_FLOURISH_PRESET_IDS = [
  'flourish-01',
  'flourish-02',
  'flourish-03',
  'flourish-04',
  'flourish-05',
  'flourish-06',
  'flourish-07',
  'flourish-08',
  'flourish-09',
  'flourish-10',
  'flourish-11',
  'flourish-12',
  'flourish-13',
  'flourish-14',
  'flourish-15',
  'flourish-16',
] as const;

export type TextFlourishPresetId = (typeof TEXT_FLOURISH_PRESET_IDS)[number];

export type TextStylePreset = 'none' | 'title' | 'body' | 'outline' | TextFlourishPresetId;

type BaseObject = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** false 时画布不绘制该图层；缺省为显示 */
  layerVisible?: boolean;
};

export type EditorImageObject = BaseObject & {
  type: 'image';
  src: string;
  opacity: number;
  blurRadius: number;
  stylePreset: ImageStylePreset;
  /** 源图像素尺寸，由画布在图片解码后写入 */
  naturalW?: number;
  naturalH?: number;
  /** 相对源图的裁切矩形（像素）；未设置表示使用整图 */
  sourceCrop?: { x: number; y: number; width: number; height: number };
};

/** rect=矩形/圆角矩（由 cornerRadius 区分）；circle=椭圆；path=自定义轮廓 */
export type EditorShapeGeometryKind = 'rect' | 'circle' | 'path';

/** solid=纯色；gradient=线性渐变；gradient_radial=放射状渐变（由中心向外） */
export type EditorShapeFillMode = 'solid' | 'gradient' | 'gradient_radial';

export type EditorShapeObject = BaseObject & {
  type: 'shape';
  geometryKind: EditorShapeGeometryKind;
  /** geometryKind 为 path 时有效：局部坐标 0…naturalW/H 下的 SVG d */
  pathData?: string;
  naturalW?: number;
  naturalH?: number;
  cornerRadius: number;
  fillMode: EditorShapeFillMode;
  /** 纯色填充（含透明度），如 #rrggbb 或 rgba(r,g,b,a) */
  fill: string;
  gradientColor1: string;
  gradientColor2: string;
  /** 线性渐变方向（度），0° 向右、90° 向下，与 AngleDegreeControl 一致 */
  gradientAngleDeg: number;
  /** @deprecated 旧快照；无 gradientAngleDeg 时按此项：true 视为 90° */
  gradientVertical?: boolean;
  shadowEnabled: boolean;
  shadowBlur: number;
  /** 画布近似：Konva 阴影半径 ≈ shadowBlur + shadowSpread */
  shadowSpread: number;
  shadowColor: string;
  shadowOffsetX: number;
  shadowOffsetY: number;
  /** 简版「毛玻璃感」：矩形自身模糊 + 透明度 */
  frostedBlur: number;
  frostedOpacity: number;
  /** false 时关闭毛玻璃（保留 frostedBlur 便于再次开启）；缺省按旧文档：仅 frostedBlur>0 时生效 */
  frostedEnabled?: boolean;
  shapeText: string;
  shapeTextFontFamily: string;
  /** 字体内置样式（PostScript 名，与 font-list getFonts2 一致）；空串表示该族默认字面 */
  shapeTextFontPostScriptName: string;
  shapeTextFontSize: number;
  shapeTextColor: string;
  shapeTextFlipY: boolean;
  shapeTextBlur: number;
  shapeTextOpacity: number;
  shapeTextOutlineEnabled: boolean;
  shapeTextOutlineColor: string;
  shapeTextOutlineWidthPt: number;
  shapeTextShadowEnabled: boolean;
  shapeTextShadowBlurPt: number;
  /** @deprecated 由 shapeTextShadowOffsetX/Y 替代 */
  shapeTextShadowOffsetPt?: number;
  shapeTextShadowOpacity: number;
  /** @deprecated 由 shapeTextShadowOffsetX/Y 替代 */
  shapeTextShadowAngleDeg?: number;
  shapeTextShadowOffsetX?: number;
  shapeTextShadowOffsetY?: number;
  shapeTextShadowSpreadPt?: number;
  shapeTextShadowColor: string;
  shapeTextLetterSpacingPercent: number;
  /** 与文本图层 textPreset 一致：用于一键花字选中态；缺省按 none */
  shapeTextPreset?: TextStylePreset;
  /** 缩放形状时，框内文字字号随框等比变化 */
  shapeTextFontSizeTracksBox?: boolean;
};

export type EditorTextObject = BaseObject & {
  type: 'text';
  text: string;
  fontSize: number;
  fontFamily: string;
  /** 字体内置样式（PostScript 名）；空串表示该族默认字面 */
  fontPostScriptName: string;
  /** @deprecated 旧快照；迁移见 textAppearance */
  fontStyle?: '' | 'bold' | 'italic' | 'bold italic';
  fontWeight?: number;
  fontBold?: boolean;
  fontItalic?: boolean;
  fill: string;
  opacity: number;
  blurRadius: number;
  textPreset: TextStylePreset;
  outlineEnabled: boolean;
  outlineColor: string;
  /** 外框粗细（点，与画布逻辑像素一致） */
  outlineWidthPt: number;
  textShadowEnabled: boolean;
  textShadowBlurPt: number;
  /** @deprecated 由 textShadowOffsetX/Y 替代 */
  textShadowOffsetPt?: number;
  textShadowOpacity: number;
  /** @deprecated 由 textShadowOffsetX/Y 替代 */
  textShadowAngleDeg?: number;
  textShadowOffsetX?: number;
  textShadowOffsetY?: number;
  textShadowSpreadPt?: number;
  textShadowColor: string;
  /** 字符间距，相对字号的百分数（0 为默认） */
  letterSpacingPercent: number;
  /** 缩放文本框时，字号随框等比变化 */
  fontSizeTracksBox?: boolean;
};

/** 矢量图层单个子路径的填充/描边覆盖；缺省字段回落到图层顶层 fill/stroke/strokeWidth */
export type PathSubpathStyleOverride = Partial<{
  fill: string;
  stroke: string;
  strokeWidth: number;
}>;

/** Potrace 矢量化路径图层：pathData 为 natrualW×naturalH 局部坐标下的 SVG d */
export type EditorPathObject = BaseObject & {
  type: 'path';
  pathData: string;
  naturalW: number;
  naturalH: number;
  /** solid：纯色 fill；pattern：用 patternSrc 位图对齐 path 局部坐标，保留原图色与栅格渐变 */
  fillKind?: 'solid' | 'pattern';
  /** 与 pathData 同尺寸的 dataUrl，仅 fillKind==='pattern' 时使用 */
  patternSrc?: string;
  fill: string;
  stroke: string;
  strokeWidth: number;
  /** 与 pathData 解析出的子路径顺序一致；未设时整层共用顶层样式 */
  pathSubpathStyles?: PathSubpathStyleOverride[];
  opacity: number;
  blurRadius: number;
};

/** 为子路径样式补丁准备与 model 等长的数组（从顶层样式初始化） */
export function ensureEditorPathSubpathStyles(
  o: EditorPathObject,
  subpathCount: number
): PathSubpathStyleOverride[] {
  const cur = o.pathSubpathStyles;
  if (cur && cur.length === subpathCount) return cur.map((e) => ({ ...(e ?? {}) }));
  return Array.from({ length: subpathCount }, () => ({
    fill: o.fill,
    stroke: o.stroke,
    strokeWidth: o.strokeWidth,
  }));
}

export type EditorObject = EditorImageObject | EditorShapeObject | EditorTextObject | EditorPathObject;

export function createId(): string {
  return crypto.randomUUID();
}

/** 新建文本/形状内文字默认族名：Mac 上与 system_profiler 中文族一致；其它平台用通用西文族 */
export function editorDefaultFontFamily(): string {
  if (typeof navigator !== 'undefined' && /Mac/i.test(navigator.userAgent)) {
    return '苹方-简';
  }
  return 'Arial';
}

export function defaultShape(): EditorShapeObject {
  return {
    type: 'shape',
    id: createId(),
    x: 80,
    y: 80,
    width: 240,
    height: 160,
    rotation: 0,
    geometryKind: 'rect',
    cornerRadius: 8,
    fillMode: 'solid',
    fill: 'rgba(66, 133, 244, 0.65)',
    gradientColor1: '#1777ff',
    gradientColor2: '#722ed1',
    gradientAngleDeg: 0,
    shadowEnabled: true,
    shadowBlur: 12,
    shadowSpread: 0,
    shadowColor: 'rgba(0,0,0,0.35)',
    shadowOffsetX: 4,
    shadowOffsetY: 6,
    frostedBlur: 0,
    frostedOpacity: 0.75,
    frostedEnabled: false,
    shapeText: '双击侧栏可改字',
    shapeTextFontFamily: editorDefaultFontFamily(),
    shapeTextFontPostScriptName: '',
    shapeTextFontSize: 22,
    shapeTextColor: 'rgba(255,255,255,0.95)',
    shapeTextFlipY: false,
    shapeTextBlur: 0,
    shapeTextOpacity: 1,
    shapeTextOutlineEnabled: false,
    shapeTextOutlineColor: '#000000',
    shapeTextOutlineWidthPt: 1,
    shapeTextShadowEnabled: false,
    shapeTextShadowBlurPt: 1,
    shapeTextShadowOffsetX: 3.5355339059327378,
    shapeTextShadowOffsetY: 3.5355339059327378,
    shapeTextShadowSpreadPt: 0,
    shapeTextShadowOpacity: 1,
    shapeTextShadowColor: 'rgba(0,0,0,0.85)',
    shapeTextLetterSpacingPercent: 0,
    shapeTextPreset: 'none',
    shapeTextFontSizeTracksBox: false,
  };
}

export function defaultText(): EditorTextObject {
  return {
    type: 'text',
    id: createId(),
    x: 100,
    y: 120,
    width: 280,
    height: 48,
    rotation: 0,
    text: '输入文字',
    fontSize: 28,
    fontFamily: editorDefaultFontFamily(),
    fontPostScriptName: '',
    fill: 'rgba(255,255,255,0.92)',
    opacity: 1,
    blurRadius: 0,
    textPreset: 'none',
    outlineEnabled: false,
    outlineColor: '#000000',
    outlineWidthPt: 1,
    textShadowEnabled: false,
    textShadowBlurPt: 1,
    textShadowOffsetX: 3.5355339059327378,
    textShadowOffsetY: 3.5355339059327378,
    textShadowSpreadPt: 0,
    textShadowOpacity: 1,
    textShadowColor: 'rgba(0,0,0,0.85)',
    letterSpacingPercent: 0,
    fontSizeTracksBox: false,
  };
}

/** 图片层与文档矩形完全重合（左上 0,0，宽高即画布）— 用于「打开本地图片」等画布尺寸与图一致的分镜 */
export function editorImageFillDocument(src: string, docW: number, docH: number): EditorImageObject {
  return {
    type: 'image',
    id: createId(),
    x: 0,
    y: 0,
    width: Math.max(1, Math.round(docW)),
    height: Math.max(1, Math.round(docH)),
    rotation: 0,
    src,
    opacity: 1,
    blurRadius: 0,
    stylePreset: 'none',
  };
}

/** 图片像素尺寸是否完全落在文档矩形内（宽、高均不超过画布） */
export function imageFitsInsideDoc(naturalW: number, naturalH: number, docW: number, docH: number): boolean {
  return naturalW <= docW && naturalH <= docH;
}

function newImageLayerBase(src: string): Omit<EditorImageObject, 'x' | 'y' | 'width' | 'height'> {
  return {
    type: 'image',
    id: createId(),
    src,
    rotation: 0,
    opacity: 1,
    blurRadius: 0,
    stylePreset: 'none',
  };
}

/** 以原始像素尺寸插入，在文档内居中 */
export function imageLayerNaturalCentered(
  src: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number
): EditorImageObject {
  const w = Math.max(1, Math.round(naturalW));
  const h = Math.max(1, Math.round(naturalH));
  return {
    ...newImageLayerBase(src),
    x: Math.round((docW - w) / 2),
    y: Math.round((docH - h) / 2),
    width: w,
    height: h,
  };
}

/** 以原始像素尺寸插入，左上角落在 (docX, docY)（拖放落点） */
export function imageLayerNaturalAt(
  src: string,
  naturalW: number,
  naturalH: number,
  docX: number,
  docY: number
): EditorImageObject {
  const w = Math.max(1, Math.round(naturalW));
  const h = Math.max(1, Math.round(naturalH));
  return {
    ...newImageLayerBase(src),
    x: Math.round(docX),
    y: Math.round(docY),
    width: w,
    height: h,
  };
}

/** 等比缩放使整个图片落在文档内（contain），居中 */
export function imageLayerContainCentered(
  src: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number
): EditorImageObject {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const r = Math.min(docW / nw, docH / nh, 1);
  const w = Math.max(1, Math.round(nw * r));
  const h = Math.max(1, Math.round(nh * r));
  return {
    ...newImageLayerBase(src),
    x: Math.round((docW - w) / 2),
    y: Math.round((docH - h) / 2),
    width: w,
    height: h,
  };
}

/** 等比缩放使整个图片落在文档内（contain），左上角在 (docX, docY) */
export function imageLayerContainAt(
  src: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  docX: number,
  docY: number
): EditorImageObject {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const r = Math.min(docW / nw, docH / nh, 1);
  const w = Math.max(1, Math.round(nw * r));
  const h = Math.max(1, Math.round(nh * r));
  return {
    ...newImageLayerBase(src),
    x: Math.round(docX),
    y: Math.round(docY),
    width: w,
    height: h,
  };
}

/** @deprecated 插入规则已改为「小于画布用原尺寸、大于画布弹窗」；保留供旧逻辑或外部引用 */
export function defaultImageFromSrc(src: string, naturalW: number, naturalH: number, docW: number, docH: number): EditorImageObject {
  if (imageFitsInsideDoc(naturalW, naturalH, docW, docH)) {
    return imageLayerNaturalCentered(src, naturalW, naturalH, docW, docH);
  }
  return imageLayerContainCentered(src, naturalW, naturalH, docW, docH);
}

/** @deprecated 同 defaultImageFromSrc */
export function defaultImageFromSrcAt(
  src: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  docX: number,
  docY: number
): EditorImageObject {
  if (imageFitsInsideDoc(naturalW, naturalH, docW, docH)) {
    return imageLayerNaturalAt(src, naturalW, naturalH, docX, docY);
  }
  return imageLayerContainAt(src, naturalW, naturalH, docW, docH, docX, docY);
}

export function defaultEditorPathFromTrace(params: {
  pathData: string;
  naturalW: number;
  naturalH: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 纯色填充；未使用 pattern 时生效 */
  fill?: string;
  /** solid=纯色；pattern=patternSrc 与 path 局部坐标对齐，保留原图多色（矢量化「原色填充」） */
  fillKind?: 'solid' | 'pattern';
  patternSrc?: string;
}): EditorPathObject {
  const usePattern = params.fillKind === 'pattern' && !!params.patternSrc?.trim();
  return {
    type: 'path',
    id: createId(),
    x: params.x,
    y: params.y,
    width: params.width,
    height: params.height,
    rotation: 0,
    pathData: params.pathData,
    naturalW: params.naturalW,
    naturalH: params.naturalH,
    fillKind: usePattern ? 'pattern' : 'solid',
    patternSrc: usePattern ? params.patternSrc : undefined,
    fill: usePattern ? 'rgba(0,0,0,0.88)' : (params.fill ?? 'rgba(0,0,0,0.88)'),
    stroke: 'transparent',
    strokeWidth: 0,
    opacity: 1,
    blurRadius: 0,
  };
}

function editorPathWithSubpathStyles(
  base: EditorPathObject,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  if (!pathSubpathStyles?.length) return base;
  const top = pathSubpathStyles[0]!;
  return {
    ...base,
    fill: top.fill ?? base.fill,
    stroke: top.stroke ?? base.stroke,
    strokeWidth: top.strokeWidth ?? base.strokeWidth,
    pathSubpathStyles,
  };
}

/** 与文档同尺寸的 path 图层（打开本地 SVG 等新会话） */
export function editorPathFillDocument(
  pathData: string,
  naturalW: number,
  naturalH: number,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  const w = Math.max(1, Math.round(naturalW));
  const h = Math.max(1, Math.round(naturalH));
  const o = defaultEditorPathFromTrace({
    pathData,
    naturalW,
    naturalH,
    x: 0,
    y: 0,
    width: w,
    height: h,
    fill: pathSubpathStyles?.[0]?.fill,
  });
  return editorPathWithSubpathStyles(o, pathSubpathStyles);
}

/** 以原始矢量尺寸插入，在文档内居中（规则同图片图层） */
export function editorPathLayerNaturalCentered(
  pathData: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  const w = Math.max(1, Math.round(naturalW));
  const h = Math.max(1, Math.round(naturalH));
  const o = defaultEditorPathFromTrace({
    pathData,
    naturalW,
    naturalH,
    x: Math.round((docW - w) / 2),
    y: Math.round((docH - h) / 2),
    width: w,
    height: h,
    fill: pathSubpathStyles?.[0]?.fill,
  });
  return editorPathWithSubpathStyles(o, pathSubpathStyles);
}

/** 以原始矢量尺寸插入，左上角落在 (docX, docY) */
export function editorPathLayerNaturalAt(
  pathData: string,
  naturalW: number,
  naturalH: number,
  docX: number,
  docY: number,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  const w = Math.max(1, Math.round(naturalW));
  const h = Math.max(1, Math.round(naturalH));
  const o = defaultEditorPathFromTrace({
    pathData,
    naturalW,
    naturalH,
    x: Math.round(docX),
    y: Math.round(docY),
    width: w,
    height: h,
    fill: pathSubpathStyles?.[0]?.fill,
  });
  return editorPathWithSubpathStyles(o, pathSubpathStyles);
}

/** 等比缩放使整个矢量外接框落在文档内（contain），居中 */
export function editorPathLayerContainCentered(
  pathData: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const r = Math.min(docW / nw, docH / nh, 1);
  const w = Math.max(1, Math.round(nw * r));
  const h = Math.max(1, Math.round(nh * r));
  const o = defaultEditorPathFromTrace({
    pathData,
    naturalW,
    naturalH,
    x: Math.round((docW - w) / 2),
    y: Math.round((docH - h) / 2),
    width: w,
    height: h,
    fill: pathSubpathStyles?.[0]?.fill,
  });
  return editorPathWithSubpathStyles(o, pathSubpathStyles);
}

/** 等比 contain，左上角在 (docX, docY) */
export function editorPathLayerContainAt(
  pathData: string,
  naturalW: number,
  naturalH: number,
  docW: number,
  docH: number,
  docX: number,
  docY: number,
  pathSubpathStyles?: PathSubpathStyleOverride[]
): EditorPathObject {
  const nw = Math.max(1, naturalW);
  const nh = Math.max(1, naturalH);
  const r = Math.min(docW / nw, docH / nh, 1);
  const w = Math.max(1, Math.round(nw * r));
  const h = Math.max(1, Math.round(nh * r));
  const o = defaultEditorPathFromTrace({
    pathData,
    naturalW,
    naturalH,
    x: Math.round(docX),
    y: Math.round(docY),
    width: w,
    height: h,
    fill: pathSubpathStyles?.[0]?.fill,
  });
  return editorPathWithSubpathStyles(o, pathSubpathStyles);
}

/** 是否实际应用毛玻璃（与侧栏 Checkbox 一致） */
export function isShapeFrostedActive(o: EditorShapeObject): boolean {
  if (o.frostedBlur <= 0) return false;
  if (o.frostedEnabled === false) return false;
  return true;
}

/** 侧栏毛玻璃区块是否展开；legacy：未写字段且 frostedBlur>0 视为开启 */
export function shapeFrostedInspectorExpanded(o: EditorShapeObject): boolean {
  if (o.frostedEnabled === false) return false;
  if (o.frostedEnabled === true) return true;
  return o.frostedBlur > 0;
}

export function objectLabel(obj: EditorObject, index: number): string {
  if (obj.type === 'image') return `图片 ${index + 1}`;
  if (obj.type === 'shape') return `形状 ${index + 1}`;
  if (obj.type === 'path') return `矢量 ${index + 1}`;
  return `文字 ${index + 1}`;
}
