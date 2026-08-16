/**
 * 图片编辑器「一键花字」：卡片 CSS 预览 + 画布 Konva 可用字段近似
 */
import type { CSSProperties } from 'react';
import type { TextFlourishPresetId, TextStylePreset } from './editorTypes';
import {
  pickBoldishFace,
  shadowOffsetFromAngle,
  type EditorFontFaceInfo,
  type EditorTextAppearanceModel,
} from './textAppearance';

/** 花字条目仍可用旧字段 offset+角度，在应用时换算为 X/Y */
type KonvaFlourishPatch = Partial<EditorTextAppearanceModel> & {
  textShadowOffsetPt?: number;
  textShadowAngleDeg?: number;
};

function flourishShadowToModel(p: KonvaFlourishPatch): Partial<EditorTextAppearanceModel> {
  if (typeof p.textShadowOffsetX === 'number' && typeof p.textShadowOffsetY === 'number') {
    const { textShadowOffsetPt: _a, textShadowAngleDeg: _b, ...rest } = p;
    return rest;
  }
  if (p.textShadowOffsetPt === undefined && p.textShadowAngleDeg === undefined) {
    return p;
  }
  const { offsetX, offsetY } = shadowOffsetFromAngle(p.textShadowOffsetPt ?? 5, p.textShadowAngleDeg ?? 45);
  const { textShadowOffsetPt: _a, textShadowAngleDeg: _b, ...rest } = p;
  return { ...rest, textShadowOffsetX: offsetX, textShadowOffsetY: offsetY, textShadowSpreadPt: p.textShadowSpreadPt ?? 0 };
}

export const FLOURISH_PREVIEW_SAMPLE = '花字';

const BOLD_PS = (faces: EditorFontFaceInfo[], family: string) => pickBoldishFace(faces, family);

export type TextOneClickItem =
  | { kind: 'reset'; preset: Extract<TextStylePreset, 'none'>; label: string; previewStyle: CSSProperties }
  | {
      kind: 'flourish';
      preset: TextFlourishPresetId;
      label: string;
      previewStyle: CSSProperties;
    };

/** Konva 单边 approx：用描边 + 单阴影模仿截图中的层次 */
const FLOURISH_KONVA: Record<TextFlourishPresetId, KonvaFlourishPatch> = {
  'flourish-01': {
    fill: '#ffb86c',
    outlineEnabled: true,
    outlineColor: '#c44f1a',
    outlineWidthPt: 1.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(180, 60, 20, 0.45)',
    textShadowBlurPt: 2,
    textShadowOffsetPt: 3,
    textShadowAngleDeg: 115,
    textShadowOpacity: 1,
    letterSpacingPercent: 2,
  },
  'flourish-02': {
    fill: '#ffffff',
    outlineEnabled: true,
    outlineColor: '#2563eb',
    outlineWidthPt: 4,
    textShadowEnabled: false,
    letterSpacingPercent: 0,
  },
  'flourish-03': {
    fill: '#ffe566',
    outlineEnabled: true,
    outlineColor: '#1a1a1a',
    outlineWidthPt: 3.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowBlurPt: 1,
    textShadowOffsetPt: 4,
    textShadowAngleDeg: 90,
    textShadowOpacity: 1,
    letterSpacingPercent: 0,
  },
  'flourish-04': {
    fill: '#fff8e7',
    outlineEnabled: true,
    outlineColor: '#f59e0b',
    outlineWidthPt: 2.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(180, 83, 9, 0.55)',
    textShadowBlurPt: 4,
    textShadowOffsetPt: 5,
    textShadowAngleDeg: 125,
    textShadowOpacity: 0.95,
    letterSpacingPercent: 4,
  },
  'flourish-05': {
    fill: '#ff4d8d',
    outlineEnabled: true,
    outlineColor: '#5b0a2e',
    outlineWidthPt: 2.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(91, 10, 46, 0.4)',
    textShadowBlurPt: 6,
    textShadowOffsetPt: 3,
    textShadowAngleDeg: 95,
    textShadowOpacity: 0.9,
    letterSpacingPercent: 2,
  },
  'flourish-06': {
    fill: '#67d4ff',
    outlineEnabled: true,
    outlineColor: '#1e3a8a',
    outlineWidthPt: 3,
    textShadowEnabled: true,
    textShadowColor: 'rgba(30, 58, 138, 0.45)',
    textShadowBlurPt: 2,
    textShadowOffsetPt: 4,
    textShadowAngleDeg: 45,
    textShadowOpacity: 1,
    letterSpacingPercent: 0,
  },
  'flourish-07': {
    fill: '#f8ff8f',
    outlineEnabled: true,
    outlineColor: '#166534',
    outlineWidthPt: 2,
    textShadowEnabled: true,
    textShadowColor: 'rgba(34, 197, 94, 0.85)',
    textShadowBlurPt: 14,
    textShadowOffsetPt: 0,
    textShadowAngleDeg: 90,
    textShadowOpacity: 1,
    letterSpacingPercent: 0,
  },
  'flourish-08': {
    fill: '#ffffff',
    outlineEnabled: true,
    outlineColor: '#b91c1c',
    outlineWidthPt: 2,
    textShadowEnabled: true,
    textShadowColor: 'rgba(185, 28, 28, 0.75)',
    textShadowBlurPt: 0,
    textShadowOffsetPt: 7,
    textShadowAngleDeg: 90,
    textShadowOpacity: 1,
    letterSpacingPercent: 2,
  },
  'flourish-09': {
    fill: '#e879f9',
    outlineEnabled: true,
    outlineColor: '#4c1d95',
    outlineWidthPt: 2.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(76, 29, 149, 0.5)',
    textShadowBlurPt: 5,
    textShadowOffsetPt: 3,
    textShadowAngleDeg: 110,
    textShadowOpacity: 1,
    letterSpacingPercent: 3,
  },
  'flourish-10': {
    fill: '#bbf7d0',
    outlineEnabled: true,
    outlineColor: '#ca8a04',
    outlineWidthPt: 3,
    textShadowEnabled: false,
    letterSpacingPercent: 0,
  },
  'flourish-11': {
    fill: '#ff6b35',
    outlineEnabled: true,
    outlineColor: '#7f1d1d',
    outlineWidthPt: 3,
    textShadowEnabled: true,
    textShadowColor: 'rgba(127, 29, 29, 0.55)',
    textShadowBlurPt: 3,
    textShadowOffsetPt: 4,
    textShadowAngleDeg: 100,
    textShadowOpacity: 1,
    letterSpacingPercent: 1,
  },
  'flourish-12': {
    fill: '#93c5fd',
    outlineEnabled: true,
    outlineColor: '#ffffff',
    outlineWidthPt: 1.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(0,0,0,0.25)',
    textShadowBlurPt: 8,
    textShadowOffsetPt: 2,
    textShadowAngleDeg: -45,
    textShadowOpacity: 0.8,
    letterSpacingPercent: 2,
  },
  'flourish-13': {
    fill: '#38bdf8',
    outlineEnabled: true,
    outlineColor: '#ffffff',
    outlineWidthPt: 3.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(14, 116, 144, 0.4)',
    textShadowBlurPt: 1,
    textShadowOffsetPt: 5,
    textShadowAngleDeg: 120,
    textShadowOpacity: 1,
    letterSpacingPercent: 0,
  },
  'flourish-14': {
    fill: '#fecaca',
    outlineEnabled: true,
    outlineColor: '#b45309',
    outlineWidthPt: 2.5,
    textShadowEnabled: true,
    textShadowColor: 'rgba(180, 83, 9, 0.45)',
    textShadowBlurPt: 4,
    textShadowOffsetPt: 4,
    textShadowAngleDeg: 85,
    textShadowOpacity: 1,
    letterSpacingPercent: 4,
  },
  'flourish-15': {
    fill: '#5eead4',
    outlineEnabled: true,
    outlineColor: '#0f766e',
    outlineWidthPt: 2,
    textShadowEnabled: true,
    textShadowColor: 'rgba(15, 118, 110, 0.35)',
    textShadowBlurPt: 6,
    textShadowOffsetPt: 3,
    textShadowAngleDeg: 95,
    textShadowOpacity: 1,
    letterSpacingPercent: 0,
  },
  'flourish-16': {
    fill: '#fcd34d',
    outlineEnabled: true,
    outlineColor: '#292524',
    outlineWidthPt: 2,
    textShadowEnabled: true,
    textShadowColor: 'rgba(41, 37, 36, 0.55)',
    textShadowBlurPt: 2,
    textShadowOffsetPt: 5,
    textShadowAngleDeg: 90,
    textShadowOpacity: 0.85,
    letterSpacingPercent: 6,
  },
};

const FLOURISH_CARD_META: TextOneClickItem[] = [
  {
    kind: 'flourish',
    preset: 'flourish-01',
    label: '暖橙渐变感',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      fontFamily: 'system-ui, sans-serif',
      background: 'linear-gradient(180deg, #ffb347 0%, #ff6b9d 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextStroke: '1px rgba(180, 60, 20, 0.35)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-02',
    label: '白字蓝边',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#fffefa',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '3px #2563eb',
      textShadow: '0 2px 0 rgba(37, 99, 235, 0.35)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-03',
    label: '黄字黑边',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#ffe14a',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2.5px #111827',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-04',
    label: '金边亮白',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#fffef0',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2px #f59e0b',
      textShadow: '0 3px 6px rgba(180, 83, 9, 0.6)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-05',
    label: '玫红立体',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      fontFamily: 'system-ui, sans-serif',
      color: '#ff4d8d',
      WebkitTextStroke: '2px #4a0d24',
      textShadow: '2px 2px 0 #5b0a2e, 4px 4px 0 rgba(91, 10, 46, 0.35)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-06',
    label: '冰蓝',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      fontFamily: 'system-ui, sans-serif',
      background: 'linear-gradient(180deg, #bae6fd 0%, #2563eb 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextStroke: '1.5px #1e3a8a',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-07',
    label: '霓虹绿',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#faffa0',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '1.5px #166534',
      textShadow: '0 0 8px rgba(52, 211, 153, 0.95), 0 0 14px rgba(34, 197, 94, 0.85)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-08',
    label: '叠影红白',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#ffffff',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '1.5px #b91c1c',
      textShadow: '3px 3px 0 #dc2626, 6px 6px 0 rgba(185, 28, 28, 0.55)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-09',
    label: '紫粉',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      fontFamily: 'system-ui, sans-serif',
      background: 'linear-gradient(180deg, #f0abfc 0%, #7c3aed 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextStroke: '2px #4c1d95',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-10',
    label: '青绿金边',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#bbf7d0',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2.5px #ca8a04',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-11',
    label: '烈焰橙',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#ff6b35',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2px #7f1d1d',
      textShadow: '0 4px 0 rgba(127, 29, 29, 0.65)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-12',
    label: '浅蓝内影',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#93c5fd',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '1px rgba(255,255,255,0.95)',
      textShadow: '0 2px 6px rgba(0,0,0,0.35)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-13',
    label: '卡通白边',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#38bdf8',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '3px #ffffff',
      textShadow: '2px 3px 0 rgba(14, 116, 144, 0.45)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-14',
    label: '豆沙金',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#fecaca',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2px #b45309',
      textShadow: '0 3px 4px rgba(180, 83, 9, 0.45)',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-15',
    label: '薄荷',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      fontFamily: 'system-ui, sans-serif',
      background: 'linear-gradient(180deg, #5eead4 0%, #0d9488 100%)',
      WebkitBackgroundClip: 'text',
      backgroundClip: 'text',
      color: 'transparent',
      WebkitTextStroke: '1px #0f766e',
    },
  },
  {
    kind: 'flourish',
    preset: 'flourish-16',
    label: '黑金',
    previewStyle: {
      fontSize: 20,
      fontWeight: 900,
      color: '#fcd34d',
      fontFamily: 'system-ui, sans-serif',
      WebkitTextStroke: '2px #1c1917',
      textShadow: '0 3px 0 rgba(28, 25, 23, 0.45)',
    },
  },
];

/** 下拉卡片数据：第一项为「无样式」 */
export const TEXT_ONECLICK_ITEMS: TextOneClickItem[] = [
  {
    kind: 'reset',
    preset: 'none',
    label: '无',
    previewStyle: {
      fontSize: 22,
      fontWeight: 700,
      color: 'rgba(255,255,255,0.42)',
      fontFamily: 'system-ui, sans-serif',
    },
  },
  ...FLOURISH_CARD_META,
];

export function textOneClickItemKey(item: TextOneClickItem, _index: number): string {
  return item.preset;
}

/** 卡片内「花字」预览（渐变 / 多重阴影等多用 CSS） */
export function renderFlourishCardContent(item: TextOneClickItem, ctx: { selected: boolean }) {
  const base: CSSProperties = {
    display: 'block',
    lineHeight: 1.05,
    textAlign: 'center',
    userSelect: 'none',
    padding: '0 4px',
  };
  return (
    <span style={{ ...base, ...item.previewStyle, opacity: ctx.selected ? 1 : 0.96 }}>{FLOURISH_PREVIEW_SAMPLE}</span>
  );
}

export function flourishAppearancePatch(
  preset: TextStylePreset,
  fontFaces: EditorFontFaceInfo[],
  fontFamily: string
): Partial<EditorTextAppearanceModel> {
  const ps = BOLD_PS(fontFaces, fontFamily);
  if (preset === 'none') {
    return {
      fontPostScriptName: ps,
      fill: 'rgba(255,255,255,0.92)',
      outlineEnabled: false,
      outlineColor: '#000000',
      outlineWidthPt: 1,
      textShadowEnabled: false,
      textShadowBlurPt: 1,
      textShadowOffsetX: 0,
      textShadowOffsetY: 0,
      textShadowSpreadPt: 0,
      textShadowOpacity: 1,
      textShadowColor: 'rgba(0,0,0,0.85)',
      letterSpacingPercent: 0,
    };
  }
  const b = FLOURISH_KONVA[preset as TextFlourishPresetId];
  if (!b) {
    return { fontPostScriptName: ps };
  }
  return { fontPostScriptName: ps, ...flourishShadowToModel(b) };
}
