/**
 * 画布裁剪：虚线框可拖拽/缩放，不限于当前文档矩形（可扩大画布）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CropDocRect } from './imageCropHelpers';
import { docRectToScreenPx } from './ImageCropOverlay';

export type CanvasEditSession = {
  rect: CropDocRect;
  /** 进入编辑时的框，用于「应用」时判断是否无变化 */
  initialRect: CropDocRect;
};

type HandleKind = 'move' | 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';

const MIN_DOC = 16;
const MAX_DOC = 8192;

function normalizeCanvasCropRect(raw: CropDocRect): CropDocRect {
  let { x, y, w, h } = raw;
  if (w < 0) {
    x += w;
    w = -w;
  }
  if (h < 0) {
    y += h;
    h = -h;
  }
  w = Math.min(MAX_DOC, Math.max(MIN_DOC, w));
  h = Math.min(MAX_DOC, Math.max(MIN_DOC, h));
  return { x, y, w, h };
}

export interface CanvasCropOverlayProps {
  session: CanvasEditSession;
  cx: number;
  cy: number;
  zoom: number;
  onSessionChange: (s: CanvasEditSession) => void;
  onCancel: () => void;
}

export const CanvasCropOverlay: React.FC<CanvasCropOverlayProps> = ({
  session,
  cx,
  cy,
  zoom,
  onSessionChange,
  onCancel,
}) => {
  const dragRef = useRef<{ kind: HandleKind; startClient: { x: number; y: number }; startRect: CropDocRect } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [, bump] = useState(0);

  const screen = useMemo(() => docRectToScreenPx(session.rect, cx, cy, zoom), [session.rect, cx, cy, zoom]);

  const onPointerDown = useCallback(
    (kind: HandleKind) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = {
        kind,
        startClient: { x: e.clientX, y: e.clientY },
        startRect: { ...session.rect },
      };
    },
    [session.rect]
  );

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dxDoc = (e.clientX - d.startClient.x) / zoom;
      const dyDoc = (e.clientY - d.startClient.y) / zoom;
      const r0 = d.startRect;
      let x = r0.x;
      let y = r0.y;
      let w = r0.w;
      let h = r0.h;
      const k = d.kind;
      if (k === 'move') {
        x = r0.x + dxDoc;
        y = r0.y + dyDoc;
      } else {
        if (k.includes('e')) w = r0.w + dxDoc;
        if (k.includes('w')) {
          w = r0.w - dxDoc;
          x = r0.x + dxDoc;
        }
        if (k.includes('s')) h = r0.h + dyDoc;
        if (k.includes('n')) {
          h = r0.h - dyDoc;
          y = r0.y + dyDoc;
        }
      }
      const raw = { x, y, w, h };
      const next = normalizeCanvasCropRect(raw);
      const eps = 1e-4;
      const clamped =
        Math.abs(next.x - raw.x) > eps ||
        Math.abs(next.y - raw.y) > eps ||
        Math.abs(next.w - raw.w) > eps ||
        Math.abs(next.h - raw.h) > eps;
      if (clamped) {
        d.startClient = { x: e.clientX, y: e.clientY };
        d.startRect = { ...next };
      }
      onSessionChange({ ...sessionRef.current, rect: next });
    };
    const onUp = () => {
      dragRef.current = null;
      bump((n) => n + 1);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [zoom, onSessionChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const stripStyle = (partial: React.CSSProperties): React.CSSProperties => ({
    position: 'absolute',
    boxSizing: 'border-box',
    background: 'rgba(255,255,255,0.42)',
    pointerEvents: 'auto',
    ...partial,
  });

  const { left: L, top: T, width: W, height: H } = screen;

  const handleSize = 10;
  const handleOffset = -handleSize / 2;
  const handleBase: React.CSSProperties = {
    position: 'absolute',
    width: handleSize,
    height: handleSize,
    background: '#fff',
    border: '1px solid rgba(0,0,0,0.45)',
    borderRadius: 2,
    boxSizing: 'border-box',
    pointerEvents: 'auto',
    zIndex: 3,
  };

  return (
    <div
      className="yiman-canvas-crop-overlay-root"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        right: 0,
        bottom: 0,
        zIndex: 20,
        pointerEvents: 'none',
      }}
    >
      <div style={stripStyle({ left: 0, top: 0, right: 0, height: Math.max(0, T) })} />
      <div style={stripStyle({ left: 0, top: T + H, right: 0, bottom: 0 })} />
      <div style={stripStyle({ left: 0, top: T, width: Math.max(0, L), height: H })} />
      <div style={stripStyle({ left: L + W, top: T, right: 0, height: H })} />

      <div
        onPointerDown={onPointerDown('move')}
        style={{
          position: 'absolute',
          left: L,
          top: T,
          width: W,
          height: H,
          border: '2px dashed rgba(100,180,255,0.95)',
          borderRadius: 2,
          boxSizing: 'border-box',
          pointerEvents: 'auto',
          cursor: 'move',
          zIndex: 2,
          background: 'transparent',
        }}
      />

      {(['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'] as const).map((hk) => {
        let style: React.CSSProperties = { ...handleBase, cursor: `${hk}-resize` };
        if (hk.includes('n')) style = { ...style, top: T + handleOffset };
        if (hk.includes('s')) style = { ...style, top: T + H + handleOffset };
        if (!hk.includes('n') && !hk.includes('s')) style = { ...style, top: T + H / 2 + handleOffset };
        if (hk.includes('w')) style = { ...style, left: L + handleOffset };
        if (hk.includes('e')) style = { ...style, left: L + W + handleOffset };
        if (!hk.includes('w') && !hk.includes('e')) style = { ...style, left: L + W / 2 + handleOffset };
        return <div key={hk} style={style} onPointerDown={onPointerDown(hk)} />;
      })}
    </div>
  );
};
