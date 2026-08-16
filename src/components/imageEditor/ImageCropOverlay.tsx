/**
 * 图片裁切模式：裁切区外半透明白色遮盖 + 虚线框与调节手柄 + 底部工具栏
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Slider, Space, Tooltip } from 'antd';
import { CheckOutlined, PictureOutlined, ExpandOutlined } from '@ant-design/icons';

export type CropDocRect = { x: number; y: number; w: number; h: number };

export type ImageCropSession = {
  objectId: string;
  /** 当前裁切框（文档坐标） */
  rect: CropDocRect;
  /** 进入裁切模式时的初始框；与 rect 一致时点「完成」不缩小图层 */
  initialRect: CropDocRect;
  imageZoom: number;
};

export function docRectToScreenPx(
  rect: CropDocRect,
  cx: number,
  cy: number,
  zoom: number
): { left: number; top: number; width: number; height: number } {
  return {
    left: cx + rect.x * zoom,
    top: cy + rect.y * zoom,
    width: rect.w * zoom,
    height: rect.h * zoom,
  };
}

/** doc 坐标鼠标位置 */
export function clientToDoc(
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

type HandleKind =
  | 'move'
  | 'n'
  | 's'
  | 'e'
  | 'w'
  | 'ne'
  | 'nw'
  | 'se'
  | 'sw';

const MIN_CROP_DOC = 16;

export interface ImageCropOverlayProps {
  session: ImageCropSession;
  /** 图片在文档中的轴对齐外框（用于约束裁切框与 move） */
  imageBounds: CropDocRect;
  cx: number;
  cy: number;
  zoom: number;
  onSessionChange: (s: ImageCropSession) => void;
  onDone: () => void;
  onCancel: () => void;
}

/** 将裁切矩形限制在图片外接框 b 内；到边缘后不再随指针越过边界（含缩放手柄） */
function clampRectToBounds(r: CropDocRect, b: CropDocRect): CropDocRect {
  const bx0 = b.x;
  const by0 = b.y;
  const bx1 = b.x + b.w;
  const by1 = b.y + b.h;
  const rx0 = r.x;
  const ry0 = r.y;
  const rx1 = r.x + r.w;
  const ry1 = r.y + r.h;

  const ix0 = Math.max(bx0, rx0);
  const iy0 = Math.max(by0, ry0);
  const ix1 = Math.min(bx1, rx1);
  const iy1 = Math.min(by1, ry1);

  let w = ix1 - ix0;
  let h = iy1 - iy0;

  if (w >= MIN_CROP_DOC && h >= MIN_CROP_DOC) {
    return { x: ix0, y: iy0, w, h };
  }

  let x = r.x;
  let y = r.y;
  w = Math.max(MIN_CROP_DOC, r.w);
  h = Math.max(MIN_CROP_DOC, r.h);
  x = Math.max(bx0, Math.min(x, bx1 - w));
  y = Math.max(by0, Math.min(y, by1 - h));
  w = Math.min(w, bx1 - x);
  h = Math.min(h, by1 - y);
  return { x, y, w: Math.max(MIN_CROP_DOC, w), h: Math.max(MIN_CROP_DOC, h) };
}

export const ImageCropOverlay: React.FC<ImageCropOverlayProps> = ({
  session,
  imageBounds,
  cx,
  cy,
  zoom,
  onSessionChange,
  onDone,
  onCancel,
}) => {
  const dragRef = useRef<{ kind: HandleKind; startClient: { x: number; y: number }; startRect: CropDocRect } | null>(null);
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [, bump] = useState(0);

  const screen = useMemo(
    () => docRectToScreenPx(session.rect, cx, cy, zoom),
    [session.rect, cx, cy, zoom]
  );

  const onPointerDown = useCallback(
    (kind: HandleKind) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId);
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
      const b = imageBounds;
      let x = r0.x;
      let y = r0.y;
      let w = r0.w;
      let h = r0.h;
      const k = d.kind;
      if (k === 'move') {
        x = r0.x + dxDoc;
        y = r0.y + dyDoc;
      } else {
        if (k.includes('e')) {
          w = r0.w + dxDoc;
        }
        if (k.includes('w')) {
          w = r0.w - dxDoc;
          x = r0.x + dxDoc;
        }
        if (k.includes('s')) {
          h = r0.h + dyDoc;
        }
        if (k.includes('n')) {
          h = r0.h - dyDoc;
          y = r0.y + dyDoc;
        }
      }
      const raw = { x, y, w, h };
      const next = clampRectToBounds(raw, b);
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
  }, [zoom, imageBounds, onSessionChange]);

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
  const padBottom = 108;

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
    <>
      <div
        className="yiman-image-crop-overlay-root"
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
        {/* 四边半透明遮盖（镂空裁切区） */}
        <div style={stripStyle({ left: 0, top: 0, right: 0, height: Math.max(0, T) })} />
        <div style={stripStyle({ left: 0, top: T + H, right: 0, bottom: padBottom })} />
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
            border: '2px dashed rgba(255,255,255,0.95)',
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

      <div
        className="yiman-image-crop-toolbar"
        style={{
          position: 'absolute',
          left: '50%',
          bottom: 20,
          transform: 'translateX(-50%)',
          zIndex: 21,
          pointerEvents: 'auto',
          padding: '10px 16px',
          borderRadius: 12,
          background: 'rgba(40,40,40,0.92)',
          border: '1px solid rgba(255,255,255,0.12)',
          boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
          minWidth: 320,
        }}
      >
        <Space orientation="vertical" style={{ width: '100%' }} size="middle">
          {/* <Space size="large" style={{ width: '100%', justifyContent: 'center' }}>
            <Tooltip title="裁切区域">
              <ExpandOutlined style={{ color: 'rgba(255,255,255,0.65)', fontSize: 18 }} />
            </Tooltip>
            <Tooltip title="当前图层为图片">
              <PictureOutlined style={{ color: '#1777ff', fontSize: 18 }} />
            </Tooltip>
          </Space> */}
          <div style={{ padding: '0 8px' }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>调整图像的缩放比例</div>
            <Slider
              min={0.35}
              max={2.2}
              step={0.05}
              value={session.imageZoom}
              onChange={(imageZoom) => onSessionChange({ ...session, imageZoom })}
              tooltip={{ formatter: (v) => `${Math.round((v ?? 1) * 100)}%` }}
            />
          </div>
          <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
            <Button onClick={onCancel}>取消</Button>
            <Button type="primary" icon={<CheckOutlined />} onClick={onDone}>
              完成
            </Button>
          </Space>
        </Space>
      </div>
    </>
  );
};
