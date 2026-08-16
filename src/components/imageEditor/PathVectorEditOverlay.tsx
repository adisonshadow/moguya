/**
 * 矢量路径编辑：按 path 激活后显示蓝线与锚点；多选锚点；path 拾取（见 docs/14）
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Group, Path, Circle, Line, Rect } from 'react-konva';
import type { EditorPathObject } from './editorTypes';
import type { ParsedPathModel, PathSubpath } from '@/utils/svgPathEditModel';
import {
  moveHandle,
  moveSubpathsByDelta,
  moveVerticesByDelta,
  pathDataFromModel,
  serializeSubpathToD,
  tryParsePathData,
} from '@/utils/svgPathEditModel';
export type PathVertexKey = { subpathIndex: number; vertexIndex: number };

export type PathVectorEditUiState = {
  /** 当前显示蓝线与锚点的 path 下标（pathData 内轮廓序号） */
  activeSubpaths: number[];
  selectedVertices: PathVertexKey[];
};

export type PathVectorSimplifyPreview = {
  /** 简化后的整段 pathData（自然坐标，与 obj.pathData 同空间） */
  previewPathData: string;
  /** 仅选中子路径的原始轮廓 d，红色描边对照 */
  originalSelectedD: string;
};

export type PathVectorEditOverlayProps = {
  obj: EditorPathObject;
  zoom: number;
  ui: PathVectorEditUiState;
  onUiChange: (patch: Partial<PathVectorEditUiState>) => void;
  onCommitPathData: (pathData: string) => void;
  onGestureStart: () => void;
  /** 简化路径预览：半透明填充 + 红色原始轮廓 */
  simplifyPreview?: PathVectorSimplifyPreview | null;
  /** 为 true 时禁用子路径点选与锚点拖拽（简化面板打开时） */
  suspendInteraction?: boolean;
};

function prevVi(sp: PathSubpath, i: number): number {
  const n = sp.verts.length;
  if (sp.closed) return (i - 1 + n) % n;
  return i - 1;
}

function nextVi(sp: PathSubpath, i: number): number {
  const n = sp.verts.length;
  if (sp.closed) return (i + 1) % n;
  return i + 1;
}

function vertexKeyEq(a: PathVertexKey, b: PathVertexKey): boolean {
  return a.subpathIndex === b.subpathIndex && a.vertexIndex === b.vertexIndex;
}

function toggleVertexKey(list: PathVertexKey[], k: PathVertexKey): PathVertexKey[] {
  const i = list.findIndex((x) => vertexKeyEq(x, k));
  if (i >= 0) return list.filter((_, j) => j !== i);
  return [...list, k];
}

function isVertexSelected(list: PathVertexKey[], k: PathVertexKey): boolean {
  return list.some((x) => vertexKeyEq(x, k));
}

const PATH_VEC_DRAG_NS = 'pathVecDrag';

export const PathVectorEditOverlay: React.FC<PathVectorEditOverlayProps> = ({
  obj,
  zoom,
  ui,
  onUiChange,
  onCommitPathData,
  onGestureStart,
  simplifyPreview = null,
  suspendInteraction = false,
}) => {
  const sx = obj.naturalW > 0 ? obj.width / obj.naturalW : 1;
  const sy = obj.naturalH > 0 ? obj.height / obj.naturalH : 1;
  const parsed = useMemo(() => tryParsePathData(obj.pathData), [obj.pathData]);
  const [draft, setDraft] = useState<ParsedPathModel | null>(null);
  const workingRef = useRef<ParsedPathModel | null>(null);

  useEffect(() => {
    setDraft(null);
    workingRef.current = null;
  }, [obj.pathData]);

  const model = draft ?? parsed;
  const startedRef = useRef(false);

  const anchorHalfSelected = useMemo(
    () => Math.max(2.5, 5 / (Math.max(sx, sy) * Math.max(zoom, 0.01))),
    [sx, sy, zoom]
  );
  const anchorHalfNormal = anchorHalfSelected * 0.42;

  const strokeDoc = 1 / Math.max(zoom, 0.01);
  const strokeLocal = strokeDoc / Math.max(sx, sy);

  const parsedRef = useRef(parsed);
  parsedRef.current = parsed;

  const dragPointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragBaseModelRef = useRef<ParsedPathModel | null>(null);
  const dragKeysRef = useRef<PathVertexKey[]>([]);
  const dragSubpathIndicesRef = useRef<number[]>([]);

  const onDragStart = useCallback(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      workingRef.current = draft ?? parsedRef.current;
      onGestureStart();
    }
  }, [draft, onGestureStart]);

  const onDragEnd = useCallback(() => {
    startedRef.current = false;
    dragPointerStartRef.current = null;
    dragBaseModelRef.current = null;
    dragKeysRef.current = [];
    dragSubpathIndicesRef.current = [];
    const w = workingRef.current;
    workingRef.current = null;
    setDraft(null);
    if (w) onCommitPathData(pathDataFromModel(w));
  }, [onCommitPathData]);

  const activePointerEndRef = useRef<(() => void) | null>(null);
  const finishOngoingPointerDrag = useCallback(() => {
    activePointerEndRef.current?.();
  }, []);

  const attachNaturalSpaceDrag = useCallback(
    (
      parent: Konva.Node | null | undefined,
      keys: PathVertexKey[],
      onMoveFrame: (local: { x: number; y: number }) => void
    ) => {
      finishOngoingPointerDrag();
      if (!parent) return;
      const stage = parent.getStage();
      if (!stage) return;

      onDragStart();

      const sampleLocal = (): { x: number; y: number } | null => {
        const p = stage.getPointerPosition();
        if (!p) return null;
        const inv = parent.getAbsoluteTransform().copy().invert();
        const pt = inv.point(p);
        return { x: pt.x, y: pt.y };
      };

      const start = sampleLocal();
      if (!start) return;
      dragPointerStartRef.current = start;
      dragBaseModelRef.current = workingRef.current ?? parsedRef.current;
      dragKeysRef.current = keys;

      const move = () => {
        const local = sampleLocal();
        if (local) onMoveFrame(local);
      };

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stage.off(`.${PATH_VEC_DRAG_NS}`);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        if (activePointerEndRef.current === finish) activePointerEndRef.current = null;
        onDragEnd();
      };

      activePointerEndRef.current = finish;

      stage.on(`pointermove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`mousemove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`touchmove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`pointerup.${PATH_VEC_DRAG_NS}`, finish);
      stage.on(`mouseup.${PATH_VEC_DRAG_NS}`, finish);
      stage.on(`touchend.${PATH_VEC_DRAG_NS}`, finish);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      move();
    },
    [finishOngoingPointerDrag, onDragStart, onDragEnd]
  );

  const attachSubpathTranslateDrag = useCallback(
    (parent: Konva.Node | null | undefined, subpathIndices: number[]) => {
      finishOngoingPointerDrag();
      if (!parent || subpathIndices.length === 0) return;
      const stage = parent.getStage();
      if (!stage) return;

      const sampleLocal = (): { x: number; y: number } | null => {
        const p = stage.getPointerPosition();
        if (!p) return null;
        const inv = parent.getAbsoluteTransform().copy().invert();
        const pt = inv.point(p);
        return { x: pt.x, y: pt.y };
      };

      const start = sampleLocal();
      if (!start) return;
      dragPointerStartRef.current = start;
      dragBaseModelRef.current = workingRef.current ?? parsedRef.current;
      dragSubpathIndicesRef.current = subpathIndices;

      let thresholdPassed = false;

      const move = () => {
        const local = sampleLocal();
        if (!local) return;
        const st = dragPointerStartRef.current;
        const base = dragBaseModelRef.current;
        if (!st || !base) return;
        const dx = local.x - st.x;
        const dy = local.y - st.y;
        if (!thresholdPassed) {
          if (dx * dx + dy * dy < 9) return;
          thresholdPassed = true;
          onDragStart();
        }
        const moved = moveSubpathsByDelta(base, dragSubpathIndicesRef.current, dx, dy);
        workingRef.current = moved;
        setDraft(moved);
      };

      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        stage.off(`.${PATH_VEC_DRAG_NS}`);
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        if (activePointerEndRef.current === finish) activePointerEndRef.current = null;
        dragPointerStartRef.current = null;
        dragBaseModelRef.current = null;
        dragSubpathIndicesRef.current = [];
        if (!thresholdPassed) return;
        onDragEnd();
      };

      activePointerEndRef.current = finish;

      stage.on(`pointermove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`mousemove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`touchmove.${PATH_VEC_DRAG_NS}`, move);
      stage.on(`pointerup.${PATH_VEC_DRAG_NS}`, finish);
      stage.on(`mouseup.${PATH_VEC_DRAG_NS}`, finish);
      stage.on(`touchend.${PATH_VEC_DRAG_NS}`, finish);
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      move();
    },
    [finishOngoingPointerDrag, onDragStart, onDragEnd]
  );

  useEffect(() => () => finishOngoingPointerDrag(), [finishOngoingPointerDrag]);

  if (!parsed) return null;

  const handleLineStroke = '#1777ff';
  const handleDotR = anchorHalfSelected * 0.9;

  const mForRender = model ?? parsed;
  const activeSet = new Set(ui.activeSubpaths);
  const showEditChrome = ui.activeSubpaths.length > 0;
  /** 简化路径面板打开时隐藏蓝线与锚点，避免与红/预览叠在一起 */
  const showVectorChrome = showEditChrome && !suspendInteraction;

  const si0 = ui.selectedVertices.length === 1 ? ui.selectedVertices[0]!.subpathIndex : -1;
  const vi0 = ui.selectedVertices.length === 1 ? ui.selectedVertices[0]!.vertexIndex : -1;

  const pickListen = !suspendInteraction;

  return (
    <Group x={obj.x} y={obj.y} rotation={obj.rotation} onMouseDown={(e) => (e.cancelBubble = true)}>
      <Group scaleX={sx} scaleY={sy}>
        {showVectorChrome
          ? ui.activeSubpaths.map((si) => {
              const sp = mForRender.subpaths[si];
              if (!sp) return null;
              const d = serializeSubpathToD(sp);
              if (!d) return null;
              return (
                <Path
                  key={`blue-${si}`}
                  data={d}
                  fillEnabled={false}
                  stroke="#1777ff"
                  strokeWidth={strokeLocal}
                  strokeScaleEnabled={false}
                  listening={false}
                  perfectDrawEnabled={false}
                />
              );
            })
          : null}

        {parsed.subpaths.map((sp, si) => {
          const d = serializeSubpathToD(sp);
          if (!d) return null;
          return (
            <Path
              key={`hit-${si}`}
              data={d}
              fillRule="evenodd"
              fill="rgba(0,0,0,0.04)"
              strokeEnabled={!sp.closed}
              stroke="rgba(0,0,0,0.12)"
              strokeWidth={sp.closed ? 0 : Math.max(10, 12 / Math.max(sx, sy))}
              listening={pickListen}
              perfectDrawEnabled={false}
              onMouseDown={(e) => {
                e.cancelBubble = true;
                const shift = e.evt.shiftKey;
                if (shift) {
                  const act = ui.activeSubpaths.includes(si)
                    ? ui.activeSubpaths.filter((x) => x !== si)
                    : [...ui.activeSubpaths, si];
                  onUiChange({ activeSubpaths: act });
                  return;
                }
                if (activeSet.has(si)) {
                  const parent = (e.target as Konva.Node).getParent();
                  attachSubpathTranslateDrag(parent, [...ui.activeSubpaths]);
                  return;
                }
                onUiChange({ activeSubpaths: [si], selectedVertices: [] });
                attachSubpathTranslateDrag((e.target as Konva.Node).getParent(), [si]);
              }}
            />
          );
        })}

        {showVectorChrome
          ? mForRender.subpaths.map((sp, si) => {
              if (!activeSet.has(si)) return null;
              return sp.verts.map((v, vi) => {
                const key: PathVertexKey = { subpathIndex: si, vertexIndex: vi };
                const isSel = isVertexSelected(ui.selectedVertices, key);
                const half = isSel ? anchorHalfSelected : anchorHalfNormal;
                const fill = isSel ? '#1777ff' : '#ffffff';
                const stroke = '#1777ff';
                const w = half * 2;
                return (
                  <Rect
                    key={`a-${si}-${vi}`}
                    x={v.x - half}
                    y={v.y - half}
                    width={w}
                    height={w}
                    fill={fill}
                    stroke={stroke}
                    strokeWidth={strokeLocal}
                    strokeScaleEnabled={false}
                    listening={pickListen}
                    onMouseDown={(e) => {
                      e.cancelBubble = true;
                      const shift = e.evt.shiftKey;
                      const next = shift ? toggleVertexKey(ui.selectedVertices, key) : [key];
                      onUiChange({ selectedVertices: next });
                      if (!isVertexSelected(next, key)) return;
                      const parent = (e.target as Konva.Node).getParent();
                      attachNaturalSpaceDrag(parent, next, (local) => {
                        const start = dragPointerStartRef.current;
                        const base = dragBaseModelRef.current;
                        if (!start || !base) return;
                        const dx = local.x - start.x;
                        const dy = local.y - start.y;
                        const keys = dragKeysRef.current;
                        const moved = moveVerticesByDelta(base, keys, dx, dy);
                        workingRef.current = moved;
                        setDraft(moved);
                      });
                    }}
                  />
                );
              });
            })
          : null}

        {showVectorChrome && ui.selectedVertices.length === 1 && si0 >= 0 && vi0 >= 0
          ? (() => {
              const sp = mForRender.subpaths[si0];
              if (!sp || !activeSet.has(si0)) return null;
              const v = sp.verts[vi0];
              if (!v) return null;
              const pv = prevVi(sp, vi0);
              const nv = nextVi(sp, vi0);
              const prev = sp.verts[pv];
              const next = sp.verts[nv];
              const els: React.ReactNode[] = [];

              const edgeInCubic = !!(prev && v.handleIn && prev.handleOut);
              const edgeOutCubic = !!(next && v.handleOut && next.handleIn);

              const bindHandleDrag = (si: number, vi: number, side: 'in' | 'out') => (e: Konva.KonvaEventObject<unknown>) => {
                e.cancelBubble = true;
                const parent = (e.target as Konva.Node).getParent();
                const k: PathVertexKey = { subpathIndex: si, vertexIndex: vi };
                attachNaturalSpaceDrag(parent, [k], (local) => {
                  const base = workingRef.current ?? parsedRef.current;
                  if (!base) return;
                  const nextM = moveHandle(base, si, vi, side, local.x, local.y);
                  workingRef.current = nextM;
                  setDraft(nextM);
                });
              };

              if (v.handleOut && edgeOutCubic) {
                els.push(
                  <Line
                    key="lo"
                    points={[v.x, v.y, v.handleOut.x, v.handleOut.y]}
                    stroke={handleLineStroke}
                    strokeWidth={strokeLocal}
                    listening={false}
                  />
                );
                els.push(
                  <Circle
                    key="do"
                    x={v.handleOut.x}
                    y={v.handleOut.y}
                    radius={handleDotR}
                    fill="#1777ff"
                    stroke="#1777ff"
                    strokeWidth={strokeLocal}
                    listening={pickListen}
                    onMouseDown={bindHandleDrag(si0, vi0, 'out')}
                  />
                );
              }
              if (v.handleIn && edgeInCubic) {
                els.push(
                  <Line
                    key="li"
                    points={[v.x, v.y, v.handleIn.x, v.handleIn.y]}
                    stroke={handleLineStroke}
                    strokeWidth={strokeLocal}
                    listening={false}
                  />
                );
                els.push(
                  <Circle
                    key="di"
                    x={v.handleIn.x}
                    y={v.handleIn.y}
                    radius={handleDotR}
                    fill="#1777ff"
                    stroke="#1777ff"
                    strokeWidth={strokeLocal}
                    listening={pickListen}
                    onMouseDown={bindHandleDrag(si0, vi0, 'in')}
                  />
                );
              }
              if (prev && edgeInCubic && prev.handleOut) {
                els.push(
                  <Line
                    key="lpo"
                    points={[prev.x, prev.y, prev.handleOut.x, prev.handleOut.y]}
                    stroke={handleLineStroke}
                    strokeWidth={strokeLocal}
                    listening={false}
                  />
                );
                els.push(
                  <Circle
                    key="dpo"
                    x={prev.handleOut.x}
                    y={prev.handleOut.y}
                    radius={handleDotR}
                    fill="#1777ff"
                    stroke="#1777ff"
                    strokeWidth={strokeLocal}
                    listening={pickListen}
                    onMouseDown={bindHandleDrag(si0, pv, 'out')}
                  />
                );
              }
              if (next && edgeOutCubic && next.handleIn) {
                els.push(
                  <Line
                    key="lni"
                    points={[next.x, next.y, next.handleIn.x, next.handleIn.y]}
                    stroke={handleLineStroke}
                    strokeWidth={strokeLocal}
                    listening={false}
                  />
                );
                els.push(
                  <Circle
                    key="dni"
                    x={next.handleIn.x}
                    y={next.handleIn.y}
                    radius={handleDotR}
                    fill="#1777ff"
                    stroke="#1777ff"
                    strokeWidth={strokeLocal}
                    listening={pickListen}
                    onMouseDown={bindHandleDrag(si0, nv, 'in')}
                  />
                );
              }
              return <>{els}</>;
            })()
          : null}

        {simplifyPreview ? (
          <>
            <Path
              key="simp-preview"
              data={simplifyPreview.previewPathData}
              fillRule="evenodd"
              fill={obj.fillKind === 'pattern' ? 'rgba(120, 170, 255, 0.38)' : obj.fill}
              opacity={obj.fillKind === 'pattern' ? 1 : 0.42}
              strokeEnabled={false}
              listening={false}
              perfectDrawEnabled={false}
            />
            <Path
              key="simp-orig-red"
              data={simplifyPreview.originalSelectedD}
              fillEnabled={false}
              stroke="rgba(255, 55, 55, 0.95)"
              strokeWidth={Math.max(strokeLocal * 2.2, 1.5 / Math.max(sx, sy))}
              strokeScaleEnabled={false}
              lineJoin="round"
              listening={false}
              perfectDrawEnabled={false}
            />
          </>
        ) : null}
      </Group>
    </Group>
  );
};
