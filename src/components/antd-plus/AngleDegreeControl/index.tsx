/**
 * 角度：圆盘 + 数值（°）+ 步进，三处联动，可在多面板复用。
 */
import React, { useCallback, useRef } from 'react';
import { InputNumber, Space } from 'antd';
import type { InputNumberProps } from 'antd';

function normalizeDeg(v: number): number {
  let x = v % 360;
  if (x < 0) x += 360;
  return x;
}

export interface AngleDegreeControlProps {
  value: number;
  onChange: (deg: number) => void;
  /** 圆盘直径（px） */
  dialSize?: number;
  /** 默认「角度」；可改为带冒号文案等 */
  angleLabel?: React.ReactNode;
  disabled?: boolean;
  className?: string;
  style?: React.CSSProperties;
  inputNumberProps?: Omit<InputNumberProps, 'value' | 'onChange' | 'disabled'>;
}

export function AngleDegreeControl({
  value,
  onChange,
  dialSize = 36,
  angleLabel = '角度',
  disabled,
  className,
  style,
  inputNumberProps,
}: AngleDegreeControlProps) {
  const dragRef = useRef(false);

  const setFromClientXY = useCallback(
    (cx: number, cy: number, el: SVGSVGElement) => {
      const rect = el.getBoundingClientRect();
      const mx = cx - rect.left - rect.width / 2;
      const my = cy - rect.top - rect.height / 2;
      let rad = Math.atan2(my, mx);
      let deg = (rad * 180) / Math.PI;
      onChange(normalizeDeg(Math.round(deg)));
    },
    [onChange]
  );

  const deg = normalizeDeg(value);
  const rad = (deg * Math.PI) / 180;
  const r = dialSize / 2 - 6;
  const dotX = r * Math.cos(rad);
  const dotY = r * Math.sin(rad);

  return (
    <Space align="center" size={8} className={className} style={style}>
      {angleLabel != null && angleLabel !== false ? (
        <span style={{ color: 'rgba(255,255,255,0.55)', fontSize: 12, flexShrink: 0 }}>{angleLabel}</span>
      ) : null}
      <svg
        width={dialSize}
        height={dialSize}
        viewBox={`${-dialSize / 2} ${-dialSize / 2} ${dialSize} ${dialSize}`}
        style={{
          display: 'block',
          cursor: disabled ? 'not-allowed' : 'pointer',
          opacity: disabled ? 0.45 : 1,
          touchAction: 'none',
        }}
        onPointerDown={(e) => {
          if (disabled) return;
          dragRef.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          setFromClientXY(e.clientX, e.clientY, e.currentTarget);
        }}
        onPointerMove={(e) => {
          if (disabled || !dragRef.current) return;
          setFromClientXY(e.clientX, e.clientY, e.currentTarget);
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
        <circle cx={0} cy={0} r={r + 2} fill="rgba(255,255,255,0.06)" stroke="rgba(255,255,255,0.12)" strokeWidth={1} />
        <circle cx={dotX} cy={dotY} r={3.5} fill="rgba(255,255,255,0.92)" />
      </svg>
      <InputNumber
        min={0}
        max={359}
        value={deg}
        disabled={disabled}
        onChange={(v) => {
          if (v == null || Number.isNaN(v)) return;
          onChange(normalizeDeg(Math.round(Number(v))));
        }}
        formatter={(v) => (v == null ? '' : `${v}°`)}
        parser={(s) => Number(String(s).replace(/°/g, ''))}
        style={{ width: 72 }}
        size="small"
        {...inputNumberProps}
      />
    </Space>
  );
}

/** 将任意角度规范到 [0, 360) */
export { normalizeDeg };
