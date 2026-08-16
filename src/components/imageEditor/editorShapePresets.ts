/**
 * 插入形状：预设几何（与顶栏 Popover 一一对应）
 * path 类预设的 pathData 定义在 100×100 局部坐标系内
 */
import { createId, editorDefaultFontFamily, type EditorShapeObject, type EditorShapeGeometryKind } from './editorTypes';

export type ShapePresetId =
  | 'square'
  | 'roundedSquare'
  | 'circle'
  | 'triangle'
  | 'rightTriangle'
  | 'arrowRight'
  | 'arrowDouble'
  | 'diamond'
  | 'speechOval'
  | 'speechRounded'
  | 'pentagon'
  | 'star';

export type ShapePresetMeta = {
  id: ShapePresetId;
  label: string;
};

export const SHAPE_PRESET_LIST: ShapePresetMeta[] = [
  { id: 'square', label: '方形' },
  { id: 'roundedSquare', label: '圆角方' },
  { id: 'circle', label: '圆形' },
  { id: 'triangle', label: '三角形' },
  { id: 'rightTriangle', label: '直角三角' },
  { id: 'arrowRight', label: '右箭头' },
  { id: 'arrowDouble', label: '双箭头' },
  { id: 'diamond', label: '菱形' },
  { id: 'speechOval', label: '椭圆对话' },
  { id: 'speechRounded', label: '圆角对话' },
  { id: 'pentagon', label: '五边形' },
  { id: 'star', label: '五角星' },
];

const PATH_NATURAL = 100;

type PathPresetId = Exclude<ShapePresetId, 'square' | 'roundedSquare' | 'circle'>;

const PATH_DATA: Record<PathPresetId, string> = {
  triangle: 'M 50 10 L 90 86 L 10 86 Z',
  rightTriangle: 'M 12 88 L 12 12 L 88 88 Z',
  arrowRight: 'M 8 36 L 56 36 L 56 22 L 94 50 L 56 78 L 56 64 L 8 64 Z',
  arrowDouble: 'M 22 50 L 38 32 L 38 42 L 62 42 L 62 32 L 78 50 L 62 68 L 62 58 L 38 58 L 38 68 Z',
  diamond: 'M 50 6 L 94 50 L 50 94 L 6 50 Z',
  speechOval:
    'M 8 78 L 20 64 C 14 58 14 38 26 28 C 40 14 68 14 82 28 C 94 40 94 58 82 70 C 72 80 56 82 44 78 L 32 92 L 28 72 C 18 68 10 72 8 78 Z',
  speechRounded:
    'M 12 24 L 72 24 Q 80 24 80 32 L 80 50 Q 80 58 72 58 L 46 58 L 34 74 L 36 58 L 12 58 Q 8 58 8 50 L 8 32 Q 8 24 12 24 Z',
  pentagon: 'M 50 8 L 90 40 L 74 86 L 26 86 L 10 40 Z',
  star: 'M 50 6 L 60 38 L 94 38 L 66 58 L 78 92 L 50 72 L 22 92 L 34 58 L 6 38 L 40 38 Z',
};

function baseShape(overrides: {
  geometryKind: EditorShapeGeometryKind;
  cornerRadius?: number;
  pathData?: string;
  naturalW?: number;
  naturalH?: number;
  width?: number;
  height?: number;
}): EditorShapeObject {
  const w = overrides.width ?? 120;
  const h = overrides.height ?? 120;
  return {
    type: 'shape',
    id: createId(),
    x: 80,
    y: 80,
    width: w,
    height: h,
    rotation: 0,
    geometryKind: overrides.geometryKind,
    pathData: overrides.pathData,
    naturalW: overrides.naturalW,
    naturalH: overrides.naturalH,
    cornerRadius: overrides.cornerRadius ?? 8,
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
    shapeText: '',
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

export function placeShapeInDoc(o: EditorShapeObject, docW: number, docH: number): EditorShapeObject {
  const x = Math.round(Math.max(0, (docW - o.width) / 2));
  const y = Math.round(Math.max(0, (docH - o.height) / 2));
  return { ...o, x, y };
}

export function createShapeFromPreset(id: ShapePresetId, docW: number, docH: number): EditorShapeObject {
  let o: EditorShapeObject;
  if (id === 'square') {
    o = baseShape({ geometryKind: 'rect', cornerRadius: 0 });
  } else if (id === 'roundedSquare') {
    o = baseShape({ geometryKind: 'rect', cornerRadius: 28 });
  } else if (id === 'circle') {
    o = baseShape({ geometryKind: 'circle', cornerRadius: 0 });
  } else if (id === 'arrowRight') {
    o = baseShape({
      geometryKind: 'path',
      pathData: PATH_DATA.arrowRight,
      naturalW: PATH_NATURAL,
      naturalH: PATH_NATURAL,
      cornerRadius: 0,
      width: 160,
      height: 100,
    });
  } else {
    o = baseShape({
      geometryKind: 'path',
      pathData: PATH_DATA[id],
      naturalW: PATH_NATURAL,
      naturalH: PATH_NATURAL,
      cornerRadius: 0,
    });
  }
  return placeShapeInDoc(o, docW, docH);
}

export function shapePresetThumbnailD(
  id: ShapePresetId
): { kind: 'rect' | 'rounded' | 'circle' | 'path'; d?: string } {
  switch (id) {
    case 'square':
      return { kind: 'rect' };
    case 'roundedSquare':
      return { kind: 'rounded' };
    case 'circle':
      return { kind: 'circle' };
    default:
      return { kind: 'path', d: PATH_DATA[id] };
  }
}
