/**
 * 缩放模糊：画布上可拖拽的缩放原点十字（文档坐标系）
 */
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import type { EditorImageObject } from './editorTypes';
import { docPointToImageNorm, imageNormToDocPoint } from './zoomBlurDocGeometry';

function clientToDoc(
  clientX: number,
  clientY: number,
  wrapRect: DOMRect,
  cx: number,
  cy: number,
  zoom: number
): { x: number; y: number } {
  const rx = clientX - wrapRect.left;
  const ry = clientY - wrapRect.top;
  return {
    x: (rx - cx) / zoom,
    y: (ry - cy) / zoom,
  };
}

export type ZoomBlurOriginOverlayProps = {
  imageLayer: EditorImageObject;
  originXN: number;
  originYN: number;
  onOriginChange: (nx: number, ny: number) => void;
  cx: number;
  cy: number;
  zoom: number;
};

const CROSS_PX = 56;
const STROKE = 2;

export const ZoomBlurOriginOverlay: React.FC<ZoomBlurOriginOverlayProps> = ({
  imageLayer,
  originXN,
  originYN,
  onOriginChange,
  cx,
  cy,
  zoom,
}) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef(false);

  const docPt = useMemo(
    () => imageNormToDocPoint(imageLayer, originXN, originYN),
    [imageLayer, originXN, originYN]
  );

  const screenLeft = cx + docPt.x * zoom;
  const screenTop = cy + docPt.y * zoom;

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragRef.current = true;
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      const root = rootRef.current;
      const wrap = root?.parentElement;
      if (!wrap) return;
      const rect = wrap.getBoundingClientRect();
      const d = clientToDoc(e.clientX, e.clientY, rect, cx, cy, zoom);
      const { nx, ny } = docPointToImageNorm(imageLayer, d.x, d.y);
      onOriginChange(nx, ny);
    };
    const onUp = () => {
      dragRef.current = false;
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cx, cy, zoom, imageLayer, onOriginChange]);

  return (
    <div
      ref={rootRef}
      className="yiman-zoom-blur-overlay-root"
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
      <div
        onPointerDown={onPointerDown}
        style={{
          position: 'absolute',
          left: screenLeft,
          top: screenTop,
          // 须给容器非零宽高，translate(-50%,-50%) 才会以中心对齐锚点；0×0 时百分比位移为 0，视觉上等同用左上角当初点
          width: CROSS_PX,
          height: CROSS_PX,
          transform: 'translate(-50%, -50%)',
          pointerEvents: 'auto',
          cursor: 'move',
          zIndex: 2,
        }}
        aria-label="缩放模糊原点"
        role="presentation"
      >
        <svg
          width={CROSS_PX}
          height={CROSS_PX}
          viewBox={`${-CROSS_PX / 2} ${-CROSS_PX / 2} ${CROSS_PX} ${CROSS_PX}`}
          style={{ overflow: 'visible', display: 'block' }}
        >
          <line
            x1={-(CROSS_PX / 2 - 4)}
            y1={0}
            x2={CROSS_PX / 2 - 4}
            y2={0}
            stroke="rgba(255,255,255,0.95)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          <line
            x1={0}
            y1={-(CROSS_PX / 2 - 4)}
            x2={0}
            y2={CROSS_PX / 2 - 4}
            stroke="rgba(255,255,255,0.95)"
            strokeWidth={STROKE}
            strokeLinecap="round"
          />
          <circle r={5} fill="rgba(23,119,255,0.35)" stroke="rgba(255,255,255,0.9)" strokeWidth={1.5} />
        </svg>
      </div>
    </div>
  );
};
