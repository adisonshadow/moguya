/**
 * 图片编辑器：画布底部浮动调整条（与 ImageCropOverlay 工具条风格一致）
 */
import React, { useEffect } from 'react';
import { Button, Checkbox, Flex, Select, Slider, Space, Switch, Tooltip } from 'antd';
import { CheckOutlined, ClearOutlined } from '@ant-design/icons';
import {
  ZOOM_BLUR_SAMPLE_STEPS_DEFAULT,
  ZOOM_BLUR_SAMPLE_STEPS_MAX,
  ZOOM_BLUR_SAMPLE_STEPS_MIN,
} from './zoomBlurImage';

const toolbarShellStyle: React.CSSProperties = {
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
};

export const RemoveWhiteAdjustToolbar: React.FC<{
  tolerance: number;
  whiteGrayOnly?: boolean;
  onToleranceChange: (v: number) => void;
  /** 拖拽/点选结束后再触发（用于按原图重算预览，避免拖动过程中反复运算） */
  onToleranceChangeComplete?: (v: number) => void;
  onWhiteGrayOnlyChange?: (v: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
  loading?: boolean;
}> = ({
  tolerance,
  whiteGrayOnly = false,
  onToleranceChange,
  onToleranceChangeComplete,
  onWhiteGrayOnlyChange,
  onApply,
  onCancel,
  loading,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={toolbarShellStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>容差（越大白→前景过渡越宽）</div>
          <Slider
            min={0}
            max={255}
            value={tolerance}
            onChange={onToleranceChange}
            {...(onToleranceChangeComplete ? { onChangeComplete: onToleranceChangeComplete } : {})}
          />
        </div>
        {onWhiteGrayOnlyChange ? (
          <div style={{ padding: '0 8px' }}>
            <Checkbox checked={whiteGrayOnly} onChange={(e) => onWhiteGrayOnlyChange(e.target.checked)}>
              <span style={{ color: 'rgba(255,255,255,0.82)', fontSize: 13 }}>仅限白灰色</span>
            </Checkbox>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', marginTop: 4, paddingLeft: 24 }}>
              仅处理偏亮、低饱和像素，减轻彩色主体边缘被稀释
            </div>
          </div>
        ) : null}
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export const FitImageToCanvasToolbar: React.FC<{
  edgePadding: number;
  maintainAspect: boolean;
  onEdgePaddingChange: (v: number) => void;
  onMaintainAspectChange: (v: boolean) => void;
  onApply: () => void;
  onCancel: () => void;
}> = ({ edgePadding, maintainAspect, onEdgePaddingChange, onMaintainAspectChange, onApply, onCancel }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={toolbarShellStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>与画布边缘留白（px）</div>
          <Slider min={0} max={400} value={edgePadding} onChange={onEdgePaddingChange} />
        </div>
        <div style={{ padding: '0 8px' }}>
          <Checkbox checked={maintainAspect} onChange={(e) => onMaintainAspectChange(e.target.checked)}>
            保持宽高比
          </Checkbox>
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={onApply}>
            完成
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export const FitContentToolbar: React.FC<{
  edgePadding: number;
  previewW: number;
  previewH: number;
  onEdgePaddingChange: (v: number) => void;
  onApply: () => void;
  onCancel: () => void;
}> = ({ edgePadding, previewW, previewH, onEdgePaddingChange, onApply, onCancel }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={toolbarShellStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.55)', padding: '0 8px' }}>
          裁剪后尺寸约 {Math.round(previewW)} × {Math.round(previewH)}
        </div>
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>内容与画布边缘留白（px）</div>
          <Slider min={0} max={400} value={edgePadding} onChange={onEdgePaddingChange} />
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

/** 矢量编辑：简化选中子路径（画布底部条） */
export const PathSimplifyAdjustToolbar: React.FC<{
  curvePrecisionPercent: number;
  onCurvePrecisionChange: (v: number) => void;
  /** 打开面板时与拖动滑块结束后触发预览重算 */
  onCurvePrecisionChangeComplete?: (v: number) => void;
  onApply: () => void;
  onCancel: () => void;
}> = ({
  curvePrecisionPercent,
  onCurvePrecisionChange,
  onCurvePrecisionChangeComplete,
  onApply,
  onCancel,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={toolbarShellStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
            曲线精度（% ，越高锚点越少）
          </div>
          <Slider
            min={0}
            max={100}
            value={curvePrecisionPercent}
            onChange={onCurvePrecisionChange}
            {...(onCurvePrecisionChangeComplete ? { onChangeComplete: onCurvePrecisionChangeComplete } : {})}
          />
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

const potraceToolbarStyle: React.CSSProperties = {
  ...toolbarShellStyle,
  minWidth: 480,
  maxWidth: 560,
};

const potraceRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 16,
  padding: '0 8px',
};

const potraceHalfStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
};

export type PotracePresetId = '' | 'logo' | 'cartoon' | 'text';

export const POTRACE_PRESETS: Record<PotracePresetId, { label: string; config: {
  threshold: number;
  turdSize: number;
  simplifyEpsilon: number;
  curveTension: number;
  cornerAngleThreshold: number;
  edgeErosionPasses: number;
  fringeSuppressMinRgb: number;
  adaptiveSimplify: boolean;
  ignoreWhite?: boolean;
} } | null> = {
  '': null,
  text: {
    label: '文字 / 细孔',
    config: {
      threshold: 128,
      turdSize: 0,
      simplifyEpsilon: 0.55,
      curveTension: 0.35,
      cornerAngleThreshold: 32,
      edgeErosionPasses: 2,
      fringeSuppressMinRgb: 200,
      adaptiveSimplify: false,
      ignoreWhite: true,
    },
  },
  logo: {
    label: 'Logo',
    config: {
      threshold: 128,
      turdSize: 4,
      simplifyEpsilon: 0.8,
      curveTension: 0.3,
      cornerAngleThreshold: 40,
      edgeErosionPasses: 1,
      fringeSuppressMinRgb: 0,
      adaptiveSimplify: false,
      ignoreWhite: true,
    },
  },
  cartoon: {
    label: '卡通人物',
    config: {
      threshold: 160,
      turdSize: 8,
      simplifyEpsilon: 1.2,
      curveTension: 0.4,
      cornerAngleThreshold: 45,
      edgeErosionPasses: 1,
      fringeSuppressMinRgb: 0,
      adaptiveSimplify: false,
      ignoreWhite: true,
    },
  },
};

export const PotraceAdjustToolbar: React.FC<{
  threshold: number;
  useOtsu: boolean;
  turdSize: number;
  simplifyEpsilon: number;
  curveTension: number;
  cornerAngleThreshold: number;
  adaptiveSimplify: boolean;
  /** 原色填充：应用后为 pattern 对齐位图；预览叠层仍用轮廓内近似均色 */
  preserveColor: boolean;
  /** 二值化后强制高亮像素为背景，不描白底 */
  ignoreWhite: boolean;
  /** 前景十字腐蚀次数，减轻锯齿白边 */
  edgeErosionPasses: number;
  /** min(R,G,B) 阈值剔除浅色前景，0 关 */
  fringeSuppressMinRgb: number;
  onThresholdChange: (v: number) => void;
  onUseOtsuChange: (v: boolean) => void;
  onTurdSizeChange: (v: number) => void;
  onSimplifyChange: (v: number) => void;
  onCurveTensionChange: (v: number) => void;
  onCornerAngleThresholdChange: (v: number) => void;
  onAdaptiveSimplifyChange: (v: boolean) => void;
  onPreserveColorChange: (v: boolean) => void;
  onIgnoreWhiteChange: (v: boolean) => void;
  onEdgeErosionPassesChange: (v: number) => void;
  onFringeSuppressMinRgbChange: (v: number) => void;
  onPresetChange: (presetId: PotracePresetId) => void;
  onParamCommit: () => void;
  onApply: () => void;
  onCancel: () => void;
  loading?: boolean;
}> = ({
  threshold,
  useOtsu,
  turdSize,
  simplifyEpsilon,
  curveTension,
  cornerAngleThreshold,
  adaptiveSimplify,
  preserveColor,
  ignoreWhite,
  edgeErosionPasses,
  fringeSuppressMinRgb,
  onThresholdChange,
  onUseOtsuChange,
  onTurdSizeChange,
  onSimplifyChange,
  onCurveTensionChange,
  onCornerAngleThresholdChange,
  onAdaptiveSimplifyChange,
  onPreserveColorChange,
  onIgnoreWhiteChange,
  onEdgeErosionPassesChange,
  onFringeSuppressMinRgbChange,
  onPresetChange,
  onParamCommit,
  onApply,
  onCancel,
  loading,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={potraceToolbarStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <Flex
          wrap="wrap"
          align="flex-end"
          gap={12}
          style={{ padding: '0 8px', width: '100%' }}
        >
          <Flex vertical style={{ flex: '1 1 160px', minWidth: 0 }}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              预制配置
            </div>
            <Select
              style={{ width: '100%' }}
              placeholder="选择预制配置"
              allowClear
              options={[
                { value: 'text', label: '文字 / 细孔' },
                { value: 'logo', label: 'Logo' },
                { value: 'cartoon', label: '卡通人物' },
              ]}
              onChange={(v) => onPresetChange((v as PotracePresetId) || '')}
            />
          </Flex>
          <Tooltip title="适合文本图像">
            <Flex align="center" gap={8} style={{ flex: '0 0 auto', paddingBottom: 2 }}>
              <Checkbox
                checked={useOtsu}
                onChange={(e) => onUseOtsuChange(e.target.checked)}
              />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)', whiteSpace: 'nowrap' }}>
                自动阈值（Otsu）
              </span>
            </Flex>
          </Tooltip>
        </Flex>
        <div style={potraceRowStyle}>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              二值化阈值（低于为前景）
            </div>
            <Slider
              min={0}
              max={255}
              value={threshold}
              onChange={onThresholdChange}
              onChangeComplete={() => onParamCommit()}
              disabled={useOtsu}
            />
          </div>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              去噪：最小连通块像素
            </div>
            <Slider
              min={0}
              max={80}
              value={turdSize}
              onChange={onTurdSizeChange}
              onChangeComplete={() => onParamCommit()}
            />
          </div>
        </div>
        <div style={potraceRowStyle}>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              路径简化（越大顶点越少）
            </div>
            <Slider
              min={0.35}
              max={4}
              step={0.05}
              value={simplifyEpsilon}
              onChange={onSimplifyChange}
              onChangeComplete={() => onParamCommit()}
            />
          </div>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              曲线张力（0 近折线，1 最平滑）
            </div>
            <Slider
              min={0}
              max={1}
              step={0.05}
              value={curveTension}
              onChange={onCurveTensionChange}
              onChangeComplete={() => onParamCommit()}
            />
          </div>
        </div>
        <div style={{ padding: '0 8px', width: '100%' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
            角点转折（°）· 越小尖角越多；越大越圆滑；0 为整圈平滑（旧版）
          </div>
          <Slider
            min={0}
            max={125}
            step={1}
            value={cornerAngleThreshold}
            onChange={onCornerAngleThresholdChange}
            onChangeComplete={() => onParamCommit()}
          />
        </div>
        <div style={potraceRowStyle}>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              边缘内收（削弱锯齿白边）
            </div>
            <Slider
              min={0}
              max={4}
              step={1}
              value={edgeErosionPasses}
              onChange={onEdgeErosionPassesChange}
              onChangeComplete={() => onParamCommit()}
            />
          </div>
          <div style={potraceHalfStyle}>
            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
              浅色边缘剔除（min RGB，0 关）
            </div>
            <Slider
              min={0}
              max={255}
              step={1}
              value={fringeSuppressMinRgb}
              onChange={onFringeSuppressMinRgbChange}
              onChangeComplete={() => onParamCommit()}
            />
          </div>
        </div>
        <Flex
          wrap="wrap"
          align="center"
          gap="8px 20px"
          style={{ padding: '0 8px', width: '100%' }}
        >
          <Flex align="center" gap={8}>
            <Switch size="small" checked={adaptiveSimplify} onChange={onAdaptiveSimplifyChange} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
              自适应简化
            </span>
          </Flex>
          <Flex align="center" gap={8}>
            <Switch size="small" checked={preserveColor} onChange={onPreserveColorChange} />
            <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>原色填充</span>
          </Flex>
          <Tooltip
            title={
              <>
                二值化时高亮作背景；开启「原色填充」时用与轮廓对齐的位图图案填充矢量，保留红/蓝等多色；关闭则为单一填充色。
              </>
            }
          >
            <Flex align="center" gap={8}>
              <Switch size="small" checked={ignoreWhite} onChange={onIgnoreWhiteChange} />
              <span style={{ fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>忽略白色</span>
            </Flex>
          </Tooltip>
        </Flex>
        {/* <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', padding: '0 8px' }}>
          灰度 → 二值 → 轮廓 → 简化 → 贝塞尔；多子路径按奇偶填充成孔。字内小洞：预制「文字/细孔」或去噪调低（可置 0）、简化调小。
        </div> */}
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export const LamaEraseAdjustToolbar: React.FC<{
  brushRadiusPx: number;
  onBrushRadiusChange: (v: number) => void;
  hasMask: boolean;
  /** 清空涂抹与结果预览，便于重新选区 */
  onClearEraser: () => void;
  onStartErase: () => void;
  /** 已有擦除结果预览时可取消预览回到涂抹 */
  resultReady: boolean;
  onDiscardResult: () => void;
  onApply: () => void;
  /** Esc：无结果预览时退出整个擦除模式 */
  onExitAdjust?: () => void;
  eraseLoading?: boolean;
}> = ({
  brushRadiusPx,
  onBrushRadiusChange,
  hasMask,
  onClearEraser,
  onStartErase,
  resultReady,
  onDiscardResult,
  onApply,
  onExitAdjust,
  eraseLoading,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (resultReady) onDiscardResult();
        else onExitAdjust?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [resultReady, onDiscardResult, onExitAdjust]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={{ ...toolbarShellStyle, minWidth: 360 }}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>橡皮擦大小</div>
          <Slider min={3} max={120} value={brushRadiusPx} onChange={onBrushRadiusChange} />
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', padding: '0 8px' }}>
          在图像上涂抹半透明蓝色标记要擦除的区域。
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end', flexWrap: 'wrap' }} size="small">
          <Button
            icon={<ClearOutlined />}
            disabled={eraseLoading || (!hasMask && !resultReady)}
            onClick={onClearEraser}
          />
          <Button disabled={!hasMask || eraseLoading || resultReady} loading={eraseLoading} onClick={onStartErase}>
            开始擦除
          </Button>
          <Button disabled={!resultReady} onClick={onDiscardResult}>
            取消
          </Button>
          <Button type="primary" disabled={!resultReady} icon={<CheckOutlined />} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

export const ZoomBlurAdjustToolbar: React.FC<{
  radiusPercent: number;
  onRadiusChange: (v: number) => void;
  sampleStepsMax: number;
  onSampleStepsMaxChange: (v: number) => void;
  onApply: () => void;
  onCancel: () => void;
  loading?: boolean;
}> = ({
  radiusPercent,
  onRadiusChange,
  sampleStepsMax,
  onSampleStepsMaxChange,
  onApply,
  onCancel,
  loading,
}) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="yiman-image-editor-adjust-toolbar" style={toolbarShellStyle}>
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 6 }}>
            模糊半径（强度，百分比）
          </div>
          <Slider
            min={0}
            max={100}
            value={radiusPercent}
            onChange={onRadiusChange}
            tooltip={{ formatter: (v) => `${v ?? 0}%` }}
          />
        </div>
        <div style={{ padding: '0 8px' }}>
          <div style={{ fontSize: 12, color: 'rgba(255, 255, 255, 0.45)', marginBottom: 6 }}>
            采样步数（上限）
          </div>
          <Slider
            min={ZOOM_BLUR_SAMPLE_STEPS_MIN}
            max={ZOOM_BLUR_SAMPLE_STEPS_MAX}
            step={1}
            value={sampleStepsMax}
            onChange={onSampleStepsMaxChange}
            tooltip={{
              formatter: (v) =>
                v == null
                  ? ''
                  : v >= ZOOM_BLUR_SAMPLE_STEPS_DEFAULT
                    ? `${v}（默认 ${ZOOM_BLUR_SAMPLE_STEPS_DEFAULT}）`
                    : `${v}（较低易有条纹）`,
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: 'rgba(255, 255, 255, 0.38)', padding: '0 8px' }}>
          画布上拖拽十字中心可移动缩放原点；模糊半径越大径向越强。采样步数越大画面越细腻、导出越慢（默认{' '}
          {ZOOM_BLUR_SAMPLE_STEPS_DEFAULT}）。
        </div>
        <Space style={{ width: '100%', justifyContent: 'flex-end' }}>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" icon={<CheckOutlined />} loading={loading} onClick={onApply}>
            应用
          </Button>
        </Space>
      </Space>
    </div>
  );
};

function potracePreviewFillFromDominant(css: string | null | undefined): string {
  if (!css?.trim()) return 'rgba(23, 119, 255, 0.14)';
  const m = /^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)\s*$/i.exec(css.trim());
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},0.38)`;
  return 'rgba(23, 119, 255, 0.14)';
}

export const PotracePreviewOverlay = React.memo<{
  show: boolean;
  cx: number;
  cy: number;
  zoom: number;
  docRect: { x: number; y: number; width: number; height: number };
  pathD: string | null;
  traceW: number;
  traceH: number;
  preserveColor?: boolean;
  /** 开启原色填充时：轮廓内近似均色（rgb），仅用于半透明预览叠层 */
  dominantFillCss?: string | null;
}>(({ show, cx, cy, zoom, docRect, pathD, traceW, traceH, preserveColor, dominantFillCss }) => {
  if (!show || !pathD || traceW < 1 || traceH < 1) return null;
  const left = cx + docRect.x * zoom;
  const top = cy + docRect.y * zoom;
  const w = Math.max(1, docRect.width * zoom);
  const h = Math.max(1, docRect.height * zoom);
  const sw = Math.max(0.6, Math.min(traceW, traceH) / 400);
  const fillPaint = preserveColor ? potracePreviewFillFromDominant(dominantFillCss) : 'rgba(23, 119, 255, 0.14)';
  return (
    <div
      style={{
        position: 'absolute',
        left,
        top,
        width: w,
        height: h,
        pointerEvents: 'none',
        zIndex: 20,
      }}
    >
      <svg
        width="100%"
        height="100%"
        viewBox={`0 0 ${traceW} ${traceH}`}
        preserveAspectRatio="none"
        style={{ overflow: 'visible' }}
      >
        <path
          d={pathD}
          fill={fillPaint}
          fillRule="evenodd"
          stroke="rgba(23, 119, 255, 0.92)"
          strokeWidth={sw}
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
});
