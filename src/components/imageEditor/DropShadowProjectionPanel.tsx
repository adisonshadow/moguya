/**
 * 投影/阴影：四象限偏移 + X/Y 输入 + 模糊/扩展 + 颜色（形状与文字共用布局，见 UI 稿）
 */
import React, { useCallback, useRef } from 'react';
import { ColorPicker, Flex, InputNumber, Slider, Typography } from 'antd';

const { Text } = Typography;

const PICKER_VIEW = 100;
const PICKER_PAD = 8;
const PICKER_HALF = (PICKER_VIEW - 2 * PICKER_PAD) / 2;

/** 偏移行：左列 X/Y 数值、右列四象限（固定宽、靠右对齐） */
const OFFSET_ROW_INPUTS_COL_W = 120;
const OFFSET_ROW_PICKER_COL_W = PICKER_VIEW;

function quadrantPointerToOffsets(
  clientX: number,
  clientY: number,
  svg: SVGSVGElement,
  maxRadius: number
): { x: number; y: number } {
  const rect = svg.getBoundingClientRect();
  const sx = ((clientX - rect.left) / rect.width) * PICKER_VIEW;
  const sy = ((clientY - rect.top) / rect.height) * PICKER_VIEW;
  const cx = PICKER_VIEW / 2;
  const cy = PICKER_VIEW / 2;
  let nx = (sx - cx) / PICKER_HALF;
  let ny = (sy - cy) / PICKER_HALF;
  const len = Math.hypot(nx, ny);
  if (len > 1 && len > 0) {
    nx /= len;
    ny /= len;
  }
  return { x: Math.round(nx * maxRadius * 1000) / 1000, y: Math.round(ny * maxRadius * 1000) / 1000 };
}

function ShadowOffsetQuadrantPicker({
  valueX,
  valueY,
  maxRadius,
  onChange,
  onInteractionStart,
  disabled,
}: {
  valueX: number;
  valueY: number;
  maxRadius: number;
  onChange: (x: number, y: number) => void;
  /** 四象限拖拽/点击开始时调用（便于只打一次撤销点） */
  onInteractionStart?: () => void;
  disabled?: boolean;
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragRef = useRef(false);

  const cx = PICKER_VIEW / 2;
  const cy = PICKER_VIEW / 2;
  const nx = maxRadius > 0 ? Math.max(-1, Math.min(1, valueX / maxRadius)) : 0;
  const ny = maxRadius > 0 ? Math.max(-1, Math.min(1, valueY / maxRadius)) : 0;
  const hx = cx + nx * PICKER_HALF;
  const hy = cy + ny * PICKER_HALF;

  const applyPointer = useCallback(
    (clientX: number, clientY: number) => {
      const svg = svgRef.current;
      if (!svg || disabled || maxRadius <= 0) return;
      const { x, y } = quadrantPointerToOffsets(clientX, clientY, svg, maxRadius);
      onChange(x, y);
    },
    [disabled, maxRadius, onChange]
  );

  return (
    <svg
      ref={svgRef}
      width={PICKER_VIEW}
      height={PICKER_VIEW}
      viewBox={`0 0 ${PICKER_VIEW} ${PICKER_VIEW}`}
      style={{
        borderRadius: 6,
        border: '1px solid rgba(255,255,255,0.22)',
        background: 'rgba(0,0,0,0.2)',
        flexShrink: 0,
        cursor: disabled ? 'not-allowed' : 'crosshair',
        touchAction: 'none',
      }}
      onPointerDown={(e) => {
        if (disabled) return;
        onInteractionStart?.();
        e.currentTarget.setPointerCapture(e.pointerId);
        dragRef.current = true;
        applyPointer(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => {
        if (!dragRef.current) return;
        applyPointer(e.clientX, e.clientY);
      }}
      onPointerUp={(e) => {
        dragRef.current = false;
        try {
          e.currentTarget.releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
      }}
      onPointerCancel={() => {
        dragRef.current = false;
      }}
    >
      <line
        x1={PICKER_PAD}
        y1={cy}
        x2={PICKER_VIEW - PICKER_PAD}
        y2={cy}
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <line
        x1={cx}
        y1={PICKER_PAD}
        x2={cx}
        y2={PICKER_VIEW - PICKER_PAD}
        stroke="rgba(255,255,255,0.28)"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <line x1={cx} y1={cy} x2={hx} y2={hy} stroke="rgba(255,255,255,0.45)" strokeWidth={1.5} strokeLinecap="round" />
      <circle
        cx={hx}
        cy={hy}
        r={7}
        fill="rgba(22, 119, 255, 0.95)"
        stroke="rgba(255,255,255,0.35)"
        strokeWidth={1}
        style={{ filter: 'drop-shadow(0 0 4px rgba(22,119,255,0.65))' }}
      />
    </svg>
  );
}

export type DropShadowProjectionPanelProps = {
  offsetX: number;
  offsetY: number;
  blur: number;
  spread: number;
  color: string;
  maxOffset: number;
  maxBlur: number;
  maxSpread: number;
  onOffsetChange: (x: number, y: number) => void;
  onBlurChange: (v: number) => void;
  onSpreadChange: (v: number) => void;
  onColorChange: (css: string) => void;
  onColorPickComplete?: () => void;
  /** 四象限开始交互时（点击/拖动手柄） */
  onOffsetInteractionStart?: () => void;
  bindSlider: (key: string, apply: (v: number) => void) => {
    onChange: (v: number) => void;
    onChangeComplete: () => void;
  };
  bindNumberField: (key: string, apply: (v: number | null) => void) => {
    onChange: (v: number | null) => void;
    onBlur: () => void;
  };
  fieldKeyPrefix: string;
  /** 数值展示后缀：形状用 px，文字与画布逻辑一致可用「点」 */
  unitSuffix: 'px' | '点';
  opacity?: number;
  onOpacityChange?: (v: number) => void;
  showOpacity?: boolean;
  disabled?: boolean;
};

export const DropShadowProjectionPanel: React.FC<DropShadowProjectionPanelProps> = ({
  offsetX,
  offsetY,
  blur,
  spread,
  color,
  maxOffset,
  maxBlur,
  maxSpread,
  onOffsetChange,
  onBlurChange,
  onSpreadChange,
  onColorChange,
  onColorPickComplete,
  onOffsetInteractionStart,
  bindSlider,
  bindNumberField,
  fieldKeyPrefix,
  unitSuffix,
  opacity = 1,
  onOpacityChange,
  showOpacity = false,
  disabled = false,
}) => {
  const pxFormatter = (n: number | null) => (n == null ? '' : `${n}${unitSuffix === '点' ? ' 点' : 'px'}`);
  const pxParser = (s: string | undefined) => Number(String(s ?? '').replace(/px|点|\s/g, '').trim());

  return (
    <Flex vertical gap={12} style={{ width: '100%' }}>
      <Flex justify="space-between" align="flex-start" gap={10} style={{ width: '100%' }}>
        <Flex vertical gap={8} style={{ width: OFFSET_ROW_INPUTS_COL_W, flexShrink: 0 }}>
          <Flex vertical gap={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              X 轴偏移
            </Text>
            <InputNumber
              size="small"
              disabled={disabled}
              min={-maxOffset}
              max={maxOffset}
              value={offsetX}
              formatter={(v) => pxFormatter(v as number | null)}
              parser={pxParser}
              style={{ width: '100%' }}
              {...bindNumberField(`${fieldKeyPrefix}-ox`, (v) => onOffsetChange(Number(v) || 0, offsetY))}
            />
          </Flex>
          <Flex vertical gap={4} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>
              Y 轴偏移
            </Text>
            <InputNumber
              size="small"
              disabled={disabled}
              min={-maxOffset}
              max={maxOffset}
              value={offsetY}
              formatter={(v) => pxFormatter(v as number | null)}
              parser={pxParser}
              style={{ width: '100%' }}
              {...bindNumberField(`${fieldKeyPrefix}-oy`, (v) => onOffsetChange(offsetX, Number(v) || 0))}
            />
          </Flex>
        </Flex>
        <div
          style={{
            width: OFFSET_ROW_PICKER_COL_W,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'flex-end',
          }}
        >
          <ShadowOffsetQuadrantPicker
            valueX={offsetX}
            valueY={offsetY}
            maxRadius={maxOffset}
            disabled={disabled}
            onInteractionStart={onOffsetInteractionStart}
            onChange={onOffsetChange}
          />
        </div>
      </Flex>

      <Flex vertical gap={4} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center" gap={8} wrap="wrap">
          <Text type="secondary" style={{ fontSize: 12 }}>
            模糊
          </Text>
          <InputNumber
            size="small"
            disabled={disabled}
            min={0}
            max={maxBlur}
            value={blur}
            formatter={(v) => pxFormatter(v as number | null)}
            parser={pxParser}
            style={{ width: 72 }}
            {...bindNumberField(`${fieldKeyPrefix}-bl`, (v) => onBlurChange(Math.max(0, Number(v) || 0)))}
          />
        </Flex>
        <Slider
          min={0}
          max={maxBlur}
          disabled={disabled}
          value={blur}
          {...bindSlider(`${fieldKeyPrefix}-blur`, onBlurChange)}
        />
      </Flex>

      <Flex vertical gap={4} style={{ width: '100%' }}>
        <Flex justify="space-between" align="center" gap={8} wrap="wrap">
          <Text type="secondary" style={{ fontSize: 12 }}>
            扩展
          </Text>
          <InputNumber
            size="small"
            disabled={disabled}
            min={0}
            max={maxSpread}
            value={spread}
            formatter={(v) => pxFormatter(v as number | null)}
            parser={pxParser}
            style={{ width: 72 }}
            {...bindNumberField(`${fieldKeyPrefix}-sp`, (v) => onSpreadChange(Math.max(0, Number(v) || 0)))}
          />
        </Flex>
        <Slider
          min={0}
          max={maxSpread}
          disabled={disabled}
          value={spread}
          {...bindSlider(`${fieldKeyPrefix}-spr`, onSpreadChange)}
        />
      </Flex>

      <Flex align="center" gap={10} wrap="wrap">
        <Text type="secondary" style={{ fontSize: 12 }}>
          颜色
        </Text>
        <ColorPicker
          value={color}
          disabled={disabled}
          size="small"
          showText
          format="rgb"
          onChangeComplete={(c) => {
            onColorPickComplete?.();
            onColorChange(c.toCssString());
          }}
          getPopupContainer={(n) => n.parentElement ?? document.body}
        />
      </Flex>

      {showOpacity && onOpacityChange ? (
        <Flex vertical gap={4} style={{ width: '100%' }}>
          <Slider
            min={0}
            max={1}
            step={0.05}
            disabled={disabled}
            value={opacity}
            {...bindSlider(`${fieldKeyPrefix}-op`, onOpacityChange)}
          />
          <Text type="secondary" style={{ fontSize: 12 }}>
            不透明度 {Math.round(opacity * 100)}%
          </Text>
        </Flex>
      ) : null}
    </Flex>
  );
};
