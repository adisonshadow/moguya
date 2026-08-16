/**
 * 图片编辑器右侧 300px 属性面板
 */
import React, { useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import {
  Typography,
  Tabs,
  Form,
  Input,
  InputNumber,
  Select,
  Slider,
  Switch,
  ColorPicker,
  Space,
  Divider,
  Button,
  Checkbox,
  Flex,
  Tooltip,
} from 'antd';
import { shapeFrostedInspectorExpanded, type EditorObject, type EditorImageObject, type EditorPathObject, type EditorShapeObject, type EditorTextObject } from './editorTypes';
import type { ImageStylePreset } from './editorTypes';
import { TextAppearanceControls } from './TextAppearanceControls';
import {
  textAppearanceFromShapeObject,
  textAppearanceFromTextObject,
  textAppearancePatchForShapeObject,
  textAppearancePatchForTextObject,
  type EditorFontFaceInfo,
} from './textAppearance';
import type { CanvasEditSession } from './CanvasCropOverlay';
import type { AlignKind, DistributeKind } from './editorAlignDistribute';
import { AngleDegreeControl } from '@/components/antd-plus/AngleDegreeControl';
import { resolveShapeGradientAngleDeg } from './shapeGradientEndpoints';
import { DropShadowProjectionPanel } from './DropShadowProjectionPanel';
import type { PathVectorEditUiState } from './PathVectorEditOverlay';
import type { PathBooleanOp } from '@/utils/pathBooleanPaper';
import { PathBooleanInspectorButtons } from './PathBooleanInspectorButtons';

const { Text } = Typography;

export interface EditorInspectorProps {
  selected: EditorObject | null;
  /** 多选 id 列表；长度 ≥2 时显示「排列」 */
  selectedIds: string[];
  onAlignMulti?: (kind: AlignKind) => void;
  onDistributeMulti?: (kind: DistributeKind) => void;
  docWidth: number;
  docHeight: number;
  /** 画布底色：默认 transparent，见 editorTypes */
  docBackgroundColor: string;
  onDocBackgroundColorChange: (css: string) => void;
  systemFonts: string[];
  /** 与主进程 getFontFaces 一致，用于「样式」下拉 */
  fontFaces: EditorFontFaceInfo[];
  onUpdate: (id: string, patch: Partial<EditorObject>) => void;
  /** 打开与漫剧项目相同的抠图面板（MattingSettingsPanel） */
  onImageOpenMatting: (id: string) => void;
  /** 移除白色：画布底部调整条设容差后应用 */
  onStartRemoveWhiteAdjust?: (id: string) => void;
  /** 移除透明四周：按 Alpha 收紧 sourceCrop 与图层框（不改 src，可 undo） */
  onTrimImageTransparentEdges?: (id: string) => Promise<void>;
  /** Potrace 矢量化：底部调整条 + 画布预览 */
  onStartPotraceAdjust?: (id: string) => void;
  /** 缩放模糊：底部调整条 + 画布十字原点 */
  onStartZoomBlurAdjust?: (id: string) => void;
  /** 擦除（Lama Cleaner）：依赖本地 pip 服务 */
  onStartLamaEraseAdjust?: (id: string) => void;
  /** 适合画布：底部调整条设留白与等比 */
  onStartFitImageToCanvas?: (id: string) => void;
  /** 适合内容：按全图层外接框裁剪画布 */
  onStartFitContent?: () => void;
  /** 有其它画布/图片调整流程进行中时，禁用遮罩、适合画布、移除白色 */
  imageSidebarToolsLocked?: boolean;
  fitContentDisabled?: boolean;
  /** 进入遮罩裁切（隐藏变形框，遮罩外半透明白色遮盖） */
  onStartImageCrop?: (id: string) => void;
  /** 调整画布可视区域（虚线框可拖大拖小，含扩大画布） */
  onOpenCanvasEdit?: () => void;
  canvasEditSession: CanvasEditSession | null;
  setCanvasEditSession: Dispatch<SetStateAction<CanvasEditSession | null>>;
  onApplyCanvasEdit: () => void;
  onCancelCanvasEdit: () => void;
  /** 侧栏控件变更前写入撤销栈（由页面注入） */
  recordHistory?: () => void;
  /** 多选：恰好为一图一形时可应用蒙版 */
  shapeMaskEligible?: boolean;
  onApplyShapeMask?: () => void;
  shapeMaskLoading?: boolean;
  /** 矢量路径锚点编辑 */
  pathVectorEditActive?: boolean;
  pathVectorUi?: PathVectorEditUiState | null;
  pathVectorPathEditable?: boolean;
  pathVectorCanAddMidAnchor?: boolean;
  onTogglePathVectorEdit?: () => void;
  onPathVectorDeleteAnchor?: () => void;
  onPathVectorSetCorner?: (corner: boolean) => void;
  onPathVectorInsertMidAnchor?: () => void;
  /** 删除当前激活的 path（非整图层）；矢量编辑内 Delete 键同逻辑，见 docs/14 */
  onPathVectorDeleteActiveSubpaths?: () => void;
  /** 恰好选中两个封闭 path 时的路径查找器运算 */
  onPathVectorBoolean?: (op: PathBooleanOp) => void;
  onPathVectorApplyFillToSelection?: (fill: string) => void;
  onPathVectorApplyStrokeToSelection?: (stroke: string) => void;
  onPathVectorApplyStrokeWidthToSelection?: (strokeWidth: number) => void;
  /** 简化路径调整面板是否打开 */
  pathSimplifyPanelOpen?: boolean;
  onStartPathSimplify?: () => void;
}

const IMAGE_PRESETS: { value: ImageStylePreset; label: string }[] = [
  { value: 'none', label: '原图' },
  { value: 'vivid', label: '鲜艳' },
  { value: 'soft', label: '柔和' },
  { value: 'dramatic', label: '硬朗' },
  { value: 'fade', label: '褪色' },
  { value: 'warm', label: '暖色' },
  { value: 'cool', label: '冷色' },
  { value: 'gray', label: '黑白' },
  { value: 'noir', label: '电影黑白' },
  { value: 'sepia', label: '怀旧' },
  { value: 'invert', label: '反色' },
];

/** 与 EditorHeader 工具栏 icon 按钮尺寸接近 */
const arrangeIconButtonStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** 与 &#xe92b; 一致：仅十六进制码位，勿加 0x */
function arrangeIconGlyph(iconHex: string) {
  const cp = parseInt(iconHex, 16);
  return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
}

const ARRANGE_ALIGN_ITEMS: { kind: AlignKind; title: string; iconHex: string }[] = [
  { kind: 'left', title: '左对齐', iconHex: 'e927' },
  { kind: 'centerH', title: '水平居中', iconHex: 'e92b' },
  { kind: 'right', title: '右对齐', iconHex: 'e92a' },
  { kind: 'top', title: '顶对齐', iconHex: 'e928' },
  { kind: 'centerV', title: '垂直居中', iconHex: 'e939' },
  { kind: 'bottom', title: '底对齐', iconHex: 'e929' },
];

/** 六种入口对应两行×三列；当前逻辑仅 vertical / horizontal / both，第二行与第一行相同（改 iconHex 即可） */
const ARRANGE_DISTRIBUTE_ITEMS: { kind: DistributeKind; title: string; iconHex: string }[] = [
  { kind: 'vertical', title: '垂直间距均分（需至少 3 个图层）', iconHex: 'e927' },
  { kind: 'horizontal', title: '水平间距均分（需至少 3 个图层）', iconHex: 'e927' },
  { kind: 'both', title: '水平与垂直间距均分（需至少 3 个图层）', iconHex: 'e927' },
  { kind: 'vertical', title: '垂直间距均分（需至少 3 个图层）', iconHex: 'e927' },
  { kind: 'horizontal', title: '水平间距均分（需至少 3 个图层）', iconHex: 'e927' },
  { kind: 'both', title: '水平与垂直间距均分（需至少 3 个图层）', iconHex: 'e927' },
];

export const EditorInspector: React.FC<EditorInspectorProps> = ({
  selected,
  selectedIds,
  onAlignMulti,
  onDistributeMulti,
  docWidth,
  docHeight,
  docBackgroundColor,
  onDocBackgroundColorChange,
  systemFonts,
  fontFaces,
  onUpdate,
  onImageOpenMatting,
  onStartRemoveWhiteAdjust,
  onTrimImageTransparentEdges,
  onStartPotraceAdjust,
  onStartZoomBlurAdjust,
  onStartLamaEraseAdjust,
  onStartFitImageToCanvas,
  onStartFitContent,
  imageSidebarToolsLocked,
  fitContentDisabled,
  onStartImageCrop,
  onOpenCanvasEdit,
  canvasEditSession,
  setCanvasEditSession,
  onApplyCanvasEdit,
  onCancelCanvasEdit,
  recordHistory,
  shapeMaskEligible,
  onApplyShapeMask,
  shapeMaskLoading,
  pathVectorEditActive = false,
  pathVectorUi = null,
  pathVectorCanAddMidAnchor = false,
  pathVectorPathEditable = false,
  onTogglePathVectorEdit,
  onPathVectorDeleteAnchor,
  onPathVectorSetCorner,
  onPathVectorInsertMidAnchor,
  onPathVectorDeleteActiveSubpaths,
  onPathVectorBoolean,
  onPathVectorApplyFillToSelection,
  onPathVectorApplyStrokeToSelection,
  onPathVectorApplyStrokeWidthToSelection,
  pathSimplifyPanelOpen = false,
  onStartPathSimplify,
}) => {
  const [trimTransparentBusyId, setTrimTransparentBusyId] = useState<string | null>(null);
  const sliderSessionRef = useRef<string | null>(null);
  const bindSlider = (key: string, apply: (v: number) => void) => ({
    onChange: (v: number) => {
      if (recordHistory && sliderSessionRef.current !== key) {
        recordHistory();
        sliderSessionRef.current = key;
      }
      apply(v);
    },
    onChangeComplete: () => {
      if (sliderSessionRef.current === key) sliderSessionRef.current = null;
    },
  });
  const bindNumberField = (key: string, apply: (v: number | null) => void) => ({
    onChange: (v: number | null) => {
      if (recordHistory && sliderSessionRef.current !== key) {
        recordHistory();
        sliderSessionRef.current = key;
      }
      apply(v);
    },
    onBlur: () => {
      if (sliderSessionRef.current === key) sliderSessionRef.current = null;
    },
  });
  const pendingTextRecordRef = useRef(false);

  const fontOptions = useMemo(() => systemFonts.map((f) => ({ value: f, label: f })), [systemFonts]);
  /** 画布区（尺寸 / 编辑 / 适合内容 / 画布设置）仅在没有选中图层时展示；编辑画布会话中保留以免无法完成调整 */
  const showCanvasBlock = selectedIds.length === 0 || canvasEditSession != null;

  const canvasBlock = (
    <>
      {/* <Text strong style={{ display: 'block', marginBottom: 8 }}>
        画布
      </Text> */}
      <Space wrap align="center" style={{ marginBottom: canvasEditSession ? 10 : 12 }}>
        <Text type="secondary">
          尺寸 {docWidth} × {docHeight}
        </Text>
        <Space>
          <Button
            variant='filled'
            color='default'
            size='small'
            icon={<i className="iconfont">&#xe7c1;</i>}
            disabled={!onOpenCanvasEdit || !!canvasEditSession}
            onClick={() => onOpenCanvasEdit?.()}
          >
            编辑画布
          </Button>
          <Button 
            variant='filled'
            color='default'
            size='small'
            icon={<i className="iconfont">&#xe72e;</i>}
            disabled={fitContentDisabled} onClick={() => onStartFitContent?.()}
          >
            适合内容
          </Button>
        </Space>
      </Space>
      {canvasEditSession ? (
        <div style={{ marginBottom: 12 }}>
          <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
            画布设置
          </Text>
          <Space wrap style={{ width: '100%', marginBottom: 10 }}>
            <Text type="secondary">宽</Text>
            <InputNumber
              min={16}
              max={8192}
              value={canvasEditSession.rect.w}
              onChange={(v) => {
                const w = Math.min(8192, Math.max(16, Number(v) || 16));
                setCanvasEditSession((s) => (s ? { ...s, rect: { ...s.rect, w } } : s));
              }}
            />
            <Text type="secondary">高</Text>
            <InputNumber
              min={16}
              max={8192}
              value={canvasEditSession.rect.h}
              onChange={(v) => {
                const h = Math.min(8192, Math.max(16, Number(v) || 16));
                setCanvasEditSession((s) => (s ? { ...s, rect: { ...s.rect, h } } : s));
              }}
            />
          </Space>
          <Space wrap>
            <Button size="small" onClick={onCancelCanvasEdit}>
              取消
            </Button>
            <Button type="primary" size="small" onClick={onApplyCanvasEdit}>
              应用
            </Button>
          </Space>
          <Text type="secondary" style={{ display: 'block', fontSize: 12, marginTop: 8 }}>
            在画布上拖拽虚线框可调整区域；可拖出当前画布以扩大尺寸。应用后图层会随新原点平移。
          </Text>
        </div>
      ) : null}
      <Divider style={{ margin: '0 0 12px' }} />
      <div style={{ marginBottom: canvasEditSession ? 10 : 12 }}>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
          画布颜色
        </Text>
        <Space wrap align="center">
          <ColorPicker
            allowClear
            value={docBackgroundColor === 'transparent' ? undefined : docBackgroundColor}
            onChangeComplete={(c) => {
              recordHistory?.();
              onDocBackgroundColorChange(c.toCssString());
            }}
            onClear={() => {
              recordHistory?.();
              onDocBackgroundColorChange('transparent');
            }}
            showText
            format="rgb"
            getPopupContainer={(n) => n.parentElement ?? document.body}
          />
        </Space>
      </div>
    </>
  );

  if (selectedIds.length >= 2) {
    const multiTabs = [
      {
        key: 'arrange',
        label: '排列',
        children: (
          <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size="middle">
            <Text type="secondary">已选 {selectedIds.length} 个图层</Text>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                对齐对象
              </Text>
              <Flex wrap="wrap" gap={6}>
                {ARRANGE_ALIGN_ITEMS.map((item) => (
                  <Tooltip key={item.kind} title={item.title}>
                    <Button
                      type="text"
                      style={arrangeIconButtonStyle}
                      icon={<i className="iconfont">{arrangeIconGlyph(item.iconHex)}</i>}
                      onClick={() => onAlignMulti?.(item.kind)}
                      disabled={!onAlignMulti}
                      aria-label={item.title}
                    />
                  </Tooltip>
                ))}
              </Flex>
            </div>
            <div>
              <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                分布对象
              </Text>
              <Flex wrap="wrap" gap={6}>
                {ARRANGE_DISTRIBUTE_ITEMS.map((item, i) => (
                  <Tooltip key={`${item.kind}-${i}`} title={item.title}>
                    <Button
                      type="text"
                      style={arrangeIconButtonStyle}
                      icon={<i className="iconfont">{arrangeIconGlyph(item.iconHex)}</i>}
                      onClick={() => onDistributeMulti?.(item.kind)}
                      disabled={!onDistributeMulti || selectedIds.length < 3}
                      aria-label={item.title}
                    />
                  </Tooltip>
                ))}
              </Flex>
            </div>
          </Space>
        ),
      },
    ];
    if (shapeMaskEligible && onApplyShapeMask) {
      multiTabs.push({
        key: 'mask',
        label: '蒙板',
        children: (
          <Space orientation="vertical" style={{ width: '100%', paddingTop: 8 }} size="middle">
            <Button type="primary" block loading={shapeMaskLoading} onClick={() => void onApplyShapeMask()}>
              应用蒙版
            </Button>
          </Space>
        ),
      });
    }
    return (
      <aside className="yiman-image-editor-inspector">
        <div style={{ padding: 16 }}>
          {showCanvasBlock ? canvasBlock : null}
          <Tabs items={multiTabs} />
        </div>

      </aside>
    );
  }

  if (!selected) {
    return (
      <aside className="yiman-image-editor-inspector">
        <div style={{ padding: 20 }}>{showCanvasBlock ? canvasBlock : null}</div>
      </aside>
    );
  }

  if (selected.type === 'image') {
    const o = selected as EditorImageObject;
    return (
      <aside className="yiman-image-editor-inspector">
        <div style={{ padding: 16 }}>
          {showCanvasBlock ? canvasBlock : null}
          {/* <Text strong style={{ display: 'block', marginBottom: 12 }}>
            图片
          </Text> */}
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <div>
              <Text type="secondary">一键样式</Text>
              <Select
                style={{ width: '100%', marginTop: 8 }}
                value={o.stylePreset}
                options={IMAGE_PRESETS}
                onChange={(stylePreset) => {
                  recordHistory?.();
                  onUpdate(o.id, { stylePreset });
                }}
              />
            </div>
            <div className='form-item form-item-horizontal'>
              <Text type="secondary">透明度</Text>
              <Slider
                min={0}
                max={1}
                step={0.05}
                value={o.opacity}
                {...bindSlider(`img-${o.id}-opacity`, (opacity) => onUpdate(o.id, { opacity }))}
              />
            </div>
            <div className='form-item form-item-horizontal'>
              <Text type="secondary">模糊</Text>
              <Slider
                min={0}
                max={180}
                value={o.blurRadius}
                {...bindSlider(`img-${o.id}-blur`, (blurRadius) => onUpdate(o.id, { blurRadius }))}
              />
            </div>

            <Space wrap>

              <Button
                variant='filled'
                color='default'
                disabled={!onStartFitImageToCanvas || imageSidebarToolsLocked}
                onClick={() => onStartFitImageToCanvas?.(o.id)}
              >
                适合画布
              </Button>
              
              <Button
                variant='filled'
                color='default'
                disabled={!onStartImageCrop || imageSidebarToolsLocked}
                onClick={() => onStartImageCrop?.(o.id)}
              >
                遮罩裁切
              </Button>

              <Button variant='filled'
                color='default' onClick={() => onImageOpenMatting(o.id)}>
                抠图
              </Button>

              <Button
                variant='filled'
                color='default'
                disabled={!onStartRemoveWhiteAdjust || imageSidebarToolsLocked}
                onClick={() => onStartRemoveWhiteAdjust?.(o.id)}
              >
                移除白色
              </Button>

              <Button
                variant="filled"
                color="default"
                loading={trimTransparentBusyId === o.id}
                disabled={!onTrimImageTransparentEdges || imageSidebarToolsLocked}
                onClick={() => {
                  if (!onTrimImageTransparentEdges) return;
                  setTrimTransparentBusyId(o.id);
                  void (async () => {
                    try {
                      await onTrimImageTransparentEdges(o.id);
                    } finally {
                      setTrimTransparentBusyId((cur) => (cur === o.id ? null : cur));
                    }
                  })();
                }}
              >
                移除透明四周
              </Button>

              <Button
                variant='filled'
                color='default'
                disabled={!onStartPotraceAdjust || imageSidebarToolsLocked}
                onClick={() => onStartPotraceAdjust?.(o.id)}
              >
                转矢量
              </Button>

              <Button
                variant="filled"
                color="default"
                disabled={!onStartZoomBlurAdjust || imageSidebarToolsLocked}
                onClick={() => onStartZoomBlurAdjust?.(o.id)}
              >
                缩放模糊
              </Button>

              <Button
                variant="filled"
                color="default"
                disabled={!onStartLamaEraseAdjust || imageSidebarToolsLocked}
                onClick={() => onStartLamaEraseAdjust?.(o.id)}
              >
                擦除（Lama Cleaner）
              </Button>

            </Space>

            

          </Space>
        </div>
      </aside>
    );
  }

  if (selected.type === 'path') {
    const o = selected as EditorPathObject;
    const pv = pathVectorUi;
    const subpathStyleMode =
      pathVectorEditActive &&
      !!pv &&
      !!onPathVectorApplyFillToSelection &&
      (pv.selectedVertices.length > 0 || pv.activeSubpaths.length > 0);
    const styleSubpathIndex =
      pv?.selectedVertices[0]?.subpathIndex ?? pv?.activeSubpaths[0] ?? null;
    const fillDisplay =
      subpathStyleMode &&
      styleSubpathIndex != null &&
      o.pathSubpathStyles?.[styleSubpathIndex]?.fill
        ? o.pathSubpathStyles[styleSubpathIndex]!.fill!
        : o.fill;
    const strokeDisplay =
      subpathStyleMode &&
      styleSubpathIndex != null &&
      o.pathSubpathStyles?.[styleSubpathIndex]?.stroke
        ? o.pathSubpathStyles[styleSubpathIndex]!.stroke!
        : o.stroke;
    const strokeWidthDisplay =
      subpathStyleMode &&
      styleSubpathIndex != null &&
      o.pathSubpathStyles?.[styleSubpathIndex]?.strokeWidth != null
        ? o.pathSubpathStyles[styleSubpathIndex]!.strokeWidth!
        : o.strokeWidth;
    return (
      <aside className="yiman-image-editor-inspector">
        <div style={{ padding: 16 }}>
          {showCanvasBlock ? canvasBlock : null}
          <Text strong style={{ display: 'block', marginBottom: 12 }}>
            矢量
          </Text>
          <Space orientation="vertical" style={{ width: '100%' }} size="middle">
            <Button
              type={pathVectorEditActive ? 'primary' : 'default'}
              block
              disabled={!pathVectorPathEditable}
              onClick={() => onTogglePathVectorEdit?.()}
            >
              {pathVectorEditActive ? '完成矢量编辑模式' : '进入矢量编辑模式'}
            </Button>
            {pathVectorEditActive ? (
              <div>
                <Text type="secondary" style={{ display: 'block', marginBottom: 8 }}>
                  {pv && pv.activeSubpaths.length > 0
                    ? '锚点编辑：在图形面内拖拽可平移已选 path；Shift 点选 path 多选/取消；在画布空白处拖曳可框选 path；Shift+框选可累加'
                    : '点击画布上的封闭区域以显示锚点；空白处拖曳框选 path'}
                </Text>
                {pv &&
                pv.activeSubpaths.length === 2 &&
                new Set(pv.activeSubpaths).size === 2 &&
                onPathVectorBoolean ? (
                  <PathBooleanInspectorButtons onOp={onPathVectorBoolean} />
                ) : null}
                {pv && pv.activeSubpaths.length > 0 ? (
                  <Space wrap>
                    <Button
                      size="small"
                      disabled={!onStartPathSimplify || pathSimplifyPanelOpen}
                      onClick={() => onStartPathSimplify?.()}
                    >
                      简化路径
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={!pv.activeSubpaths.length}
                      onClick={() => onPathVectorDeleteActiveSubpaths?.()}
                    >
                      删除选中的图形
                    </Button>
                    <Button
                      size="small"
                      danger
                      disabled={!pv.selectedVertices.length}
                      onClick={() => onPathVectorDeleteAnchor?.()}
                    >
                      删除锚点
                    </Button>
                    <Button
                      size="small"
                      disabled={!pv.selectedVertices.length}
                      onClick={() => onPathVectorSetCorner?.(true)}
                    >
                      转换为尖角
                    </Button>
                    <Button
                      size="small"
                      disabled={!pv.selectedVertices.length}
                      onClick={() => onPathVectorSetCorner?.(false)}
                    >
                      转换成平滑
                    </Button>
                    <Button
                      size="small"
                      type="primary"
                      disabled={!pathVectorCanAddMidAnchor}
                      onClick={() => onPathVectorInsertMidAnchor?.()}
                    >
                      添加锚点
                    </Button>
                  </Space>
                ) : null}
              </div>
            ) : null}
            {pathVectorEditActive ? (
              <>
                <div>
                  <Text type="secondary">
                    填充{subpathStyleMode ? '（选中的锚点所属 path）' : ''}
                  </Text>
                  <div style={{ marginTop: 8 }}>
                    <ColorPicker
                      value={fillDisplay}
                      onChangeComplete={(c) => {
                        recordHistory?.();
                        const css = c.toCssString();
                        if (subpathStyleMode) onPathVectorApplyFillToSelection?.(css);
                        else onUpdate(o.id, { fill: css });
                      }}
                      showText
                      format="rgb"
                    />
                  </div>
                </div>
                <div>
                  <Text type="secondary">
                    描边{subpathStyleMode ? '（选中的锚点所属 path）' : ''}
                  </Text>
                  <div style={{ marginTop: 8 }}>
                    <ColorPicker
                      value={strokeDisplay === 'transparent' ? '#000000' : strokeDisplay}
                      onChangeComplete={(c) => {
                        recordHistory?.();
                        const css = c.toCssString();
                        if (subpathStyleMode) onPathVectorApplyStrokeToSelection?.(css);
                        else onUpdate(o.id, { stroke: css });
                      }}
                      showText
                      format="rgb"
                    />
                  </div>
                </div>
                <Form.Item label="描边宽度" style={{ marginBottom: 0 }}>
                  <InputNumber
                    min={0}
                    max={32}
                    value={strokeWidthDisplay}
                    style={{ width: '100%' }}
                    {...bindNumberField(
                      `path-${o.id}-sw`,
                      subpathStyleMode
                        ? (v) => onPathVectorApplyStrokeWidthToSelection?.(Number(v) || 0)
                        : (v) => onUpdate(o.id, { strokeWidth: Number(v) || 0 })
                    )}
                  />
                </Form.Item>
              </>
            ) : null}
            <Text type="secondary">透明度</Text>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={o.opacity}
              {...bindSlider(`path-${o.id}-op`, (opacity) => onUpdate(o.id, { opacity }))}
            />
            <Flex vertical gap={4}>
              <Text type="secondary">模糊</Text>
              <Slider
                min={0}
                max={100}
                value={o.blurRadius}
                {...bindSlider(`path-${o.id}-blur`, (blurRadius) => onUpdate(o.id, { blurRadius }))}
              />
            </Flex>
          </Space>
        </div>
      </aside>
    );
  }

  if (selected.type === 'text') {
    const o = selected as EditorTextObject;
    return (
      <aside className="yiman-image-editor-inspector">
        <div style={{ padding: 16 }}>
          {showCanvasBlock ? canvasBlock : null}
          <Text strong style={{ display: 'block', marginBottom: 12 }}>
            文本
          </Text>
          <Form layout="vertical" size="small">
            <Form.Item label="内容">
              <Input.TextArea
                rows={3}
                value={o.text}
                onFocus={() => {
                  pendingTextRecordRef.current = true;
                }}
                onChange={(e) => {
                  if (pendingTextRecordRef.current) {
                    recordHistory?.();
                    pendingTextRecordRef.current = false;
                  }
                  onUpdate(o.id, { text: e.target.value });
                }}
              />
            </Form.Item>
            <TextAppearanceControls
              value={textAppearanceFromTextObject(o)}
              onPatch={(p) => onUpdate(o.id, textAppearancePatchForTextObject(p))}
              fontOptions={fontOptions}
              fontFaces={fontFaces}
              bindNumberField={bindNumberField}
              bindSlider={bindSlider}
              recordHistory={recordHistory}
              fieldKeyPrefix={`text-${o.id}`}
              flourishSelectedPreset={o.textPreset}
              onFlourishApply={(preset, appearance) => {
                recordHistory?.();
                onUpdate(o.id, { ...textAppearancePatchForTextObject(appearance), textPreset: preset });
              }}
            />
          </Form>
        </div>
      </aside>
    );
  }

  const o = selected as EditorShapeObject;
  const shapeTab = (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <div>
        <Text type="secondary">填充模式</Text>
        <Select
          style={{ width: '100%', marginTop: 8 }}
          value={o.fillMode}
          options={[
            { value: 'solid', label: '纯色 / 透明' },
            { value: 'gradient', label: '线性渐变' },
            { value: 'gradient_radial', label: '放射状渐变' },
          ]}
          onChange={(fillMode) => {
            recordHistory?.();
            onUpdate(o.id, { fillMode });
          }}
        />
      </div>
      {o.fillMode === 'solid' ? (
        <div>
          <Text type="secondary">颜色（含透明）</Text>
          <div style={{ marginTop: 8 }}>
            <ColorPicker
              value={o.fill}
              onChangeComplete={(c) => {
                recordHistory?.();
                onUpdate(o.id, { fill: c.toCssString() });
              }}
              showText
              format="rgb"
            />
          </div>
        </div>
      ) : (
        <>
          <Space wrap>
            <div>
              <Text type="secondary">{o.fillMode === 'gradient_radial' ? '中心色' : '起始色'}</Text>
              <div style={{ marginTop: 6 }}>
                <ColorPicker
                  value={o.gradientColor1}
                  onChangeComplete={(c) => {
                    recordHistory?.();
                    onUpdate(o.id, { gradientColor1: c.toCssString() });
                  }}
                />
              </div>
            </div>
            <div>
              <Text type="secondary">{o.fillMode === 'gradient_radial' ? '边缘色' : '结束色'}</Text>
              <div style={{ marginTop: 6 }}>
                <ColorPicker
                  value={o.gradientColor2}
                  onChangeComplete={(c) => {
                    recordHistory?.();
                    onUpdate(o.id, { gradientColor2: c.toCssString() });
                  }}
                />
              </div>
            </div>
          </Space>
          {o.fillMode === 'gradient' ? (
            <div style={{ marginTop: 10 }}>
              <AngleDegreeControl
                angleLabel="渐变方向："
                dialSize={36}
                value={resolveShapeGradientAngleDeg(o)}
                onChange={(deg) => {
                  recordHistory?.();
                  onUpdate(o.id, { gradientAngleDeg: deg });
                }}
              />
            </div>
          ) : null}
        </>
      )}
      <Divider style={{ margin: '8px 0' }} />
      <Form.Item label="圆角" style={{ marginBottom: 0 }}>
        <InputNumber
          min={0}
          max={200}
          value={o.cornerRadius}
          style={{ width: '100%' }}
          disabled={o.geometryKind !== 'rect'}
          {...bindNumberField(`shape-${o.id}-cr`, (v) => onUpdate(o.id, { cornerRadius: Number(v) || 0 }))}
        />
      </Form.Item>
      {o.geometryKind !== 'rect' ? (
        <Text type="secondary" style={{ fontSize: 12 }}>
          圆角仅对矩形类形状有效。
        </Text>
      ) : null}
      <div>
        <Checkbox
          checked={o.shadowEnabled}
          onChange={(e) => {
            recordHistory?.();
            onUpdate(o.id, { shadowEnabled: e.target.checked });
          }}
        >
          <Text type="secondary">投影</Text>
        </Checkbox>
        {o.shadowEnabled ? (
          <div style={{ marginTop: 10 }}>
            <DropShadowProjectionPanel
              offsetX={o.shadowOffsetX}
              offsetY={o.shadowOffsetY}
              blur={o.shadowBlur}
              spread={o.shadowSpread ?? 0}
              color={o.shadowColor}
              maxOffset={80}
              maxBlur={40}
              maxSpread={24}
              onOffsetChange={(x, y) => onUpdate(o.id, { shadowOffsetX: x, shadowOffsetY: y })}
              onOffsetInteractionStart={() => recordHistory?.()}
              onBlurChange={(shadowBlur) => onUpdate(o.id, { shadowBlur })}
              onSpreadChange={(shadowSpread) => onUpdate(o.id, { shadowSpread })}
              onColorChange={(css) => onUpdate(o.id, { shadowColor: css })}
              onColorPickComplete={() => recordHistory?.()}
              bindSlider={bindSlider}
              bindNumberField={bindNumberField}
              fieldKeyPrefix={`shape-${o.id}-sh`}
              unitSuffix="px"
            />
          </div>
        ) : null}
      </div>
      <Divider style={{ margin: '8px 0' }} />
      <div>
        <Checkbox
          checked={shapeFrostedInspectorExpanded(o)}
          onChange={(e) => {
            recordHistory?.();
            const on = e.target.checked;
            if (on) {
              onUpdate(o.id, {
                frostedEnabled: true,
                frostedBlur: o.frostedBlur > 0 ? o.frostedBlur : 8,
              });
            } else {
              onUpdate(o.id, { frostedEnabled: false });
            }
          }}
        >
          <Text type="secondary">毛玻璃</Text>
        </Checkbox>
        {shapeFrostedInspectorExpanded(o) ? (
          <Space orientation="vertical" style={{ width: '100%', marginTop: 10 }} size={10}>
            <Text type="secondary">模糊半径</Text>
            <Slider
              min={0}
              max={16}
              value={o.frostedBlur}
              {...bindSlider(`shape-${o.id}-frostb`, (frostedBlur) => onUpdate(o.id, { frostedBlur }))}
            />
            <Text type="secondary">磨砂不透明度</Text>
            <Slider
              min={0.1}
              max={1}
              step={0.05}
              value={o.frostedOpacity}
              {...bindSlider(`shape-${o.id}-frosto`, (frostedOpacity) => onUpdate(o.id, { frostedOpacity }))}
            />
          </Space>
        ) : null}
      </div>
    </Space>
  );

  const textInShapeTab = (
    <Space orientation="vertical" style={{ width: '100%' }} size="middle">
      <Input.TextArea
        rows={3}
        value={o.shapeText}
        placeholder="形状内文字"
        onFocus={() => {
          pendingTextRecordRef.current = true;
        }}
        onChange={(e) => {
          if (pendingTextRecordRef.current) {
            recordHistory?.();
            pendingTextRecordRef.current = false;
          }
          onUpdate(o.id, { shapeText: e.target.value });
        }}
      />
      <TextAppearanceControls
        value={textAppearanceFromShapeObject(o)}
        onPatch={(p) => onUpdate(o.id, textAppearancePatchForShapeObject(p))}
        fontOptions={fontOptions}
        fontFaces={fontFaces}
        bindNumberField={bindNumberField}
        bindSlider={bindSlider}
        recordHistory={recordHistory}
        fieldKeyPrefix={`shape-${o.id}-st`}
        flourishSelectedPreset={o.shapeTextPreset ?? 'none'}
        onFlourishApply={(preset, appearance) => {
          recordHistory?.();
          onUpdate(o.id, { ...textAppearancePatchForShapeObject(appearance), shapeTextPreset: preset });
        }}
      />
      <div>
        <Switch
          checked={o.shapeTextFlipY}
          onChange={(shapeTextFlipY) => {
            recordHistory?.();
            onUpdate(o.id, { shapeTextFlipY });
          }}
        />{' '}
        <Text type="secondary">文字倒置（180°）</Text>
      </div>
    </Space>
  );

  return (
    <aside className="yiman-image-editor-inspector">
      <div style={{ padding: 12 }}>
        {showCanvasBlock ? canvasBlock : null}
        <Text strong>形状</Text>
        <Tabs
          defaultActiveKey="look"
          items={[
            { key: 'look', label: '外观', children: shapeTab },
            { key: 'txt', label: '文字', children: textInShapeTab },
          ]}
        />
      </div>
    </aside>
  );
};
