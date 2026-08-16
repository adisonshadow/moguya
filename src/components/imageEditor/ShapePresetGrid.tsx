/**
 * 插入形状：顶栏 Popover 内的预设网格缩略图
 */
import React from 'react';
import { SHAPE_PRESET_LIST, shapePresetThumbnailD, type ShapePresetId } from './editorShapePresets';

const CELL = 52;
/** 与下方按钮边长相符（内嵌 SVG 为 CELL，按钮另有 padding） */
const BTN = CELL + 8;
const PAD = 6;
const R = 6;
/** 三列 + 纵向两道 gap + 左右 padding（Popover 内容区 minWidth 与此对齐） */
export const SHAPE_PRESET_GRID_OUTER_PX = 3 * BTN + 2 * PAD + 2 * PAD;
/** @internal 仅组件内使用，与导出常量同值 */
const GRID_OUTER_W = SHAPE_PRESET_GRID_OUTER_PX;

function Thumbnail({ id }: { id: ShapePresetId }) {
  const meta = shapePresetThumbnailD(id);
  const iconColor = 'rgba(255,255,255,0.82)';
  if (meta.kind === 'rect') {
    return (
      <svg width={CELL} height={CELL} viewBox="0 0 100 100" style={{ display: 'block' }}>
        <rect x="14" y="14" width="72" height="72" rx="2" fill={iconColor} />
      </svg>
    );
  }
  if (meta.kind === 'rounded') {
    return (
      <svg width={CELL} height={CELL} viewBox="0 0 100 100" style={{ display: 'block' }}>
        <rect x="14" y="14" width="72" height="72" rx="22" fill={iconColor} />
      </svg>
    );
  }
  if (meta.kind === 'circle') {
    return (
      <svg width={CELL} height={CELL} viewBox="0 0 100 100" style={{ display: 'block' }}>
        <circle cx="50" cy="50" r="36" fill={iconColor} />
      </svg>
    );
  }
  return (
    <svg width={CELL} height={CELL} viewBox="0 0 100 100" style={{ display: 'block' }}>
      <path d={meta.d} fill={iconColor} />
    </svg>
  );
}

export interface ShapePresetGridProps {
  onPick: (id: ShapePresetId) => void;
}

export const ShapePresetGrid: React.FC<ShapePresetGridProps> = ({ onPick }) => {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(3, ${BTN}px)`,
        gap: PAD,
        width: GRID_OUTER_W,
        boxSizing: 'border-box',
        padding: PAD,
      }}
    >
      {SHAPE_PRESET_LIST.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          title={label}
          aria-label={label}
          onClick={() => onPick(id)}
          style={{
            width: BTN,
            height: BTN,
            padding: 4,
            borderRadius: R,
            border: '1px solid rgba(255,255,255,0.12)',
            background: 'rgba(255,255,255,0.06)',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Thumbnail id={id} />
        </button>
      ))}
    </div>
  );
};
