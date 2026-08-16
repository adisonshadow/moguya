/**
 * 抠图设置面板：可拖拽 header、无遮罩，支持撤销
 * 支持 AI 模型抠图与即时透明（四角采样背景色）
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Button, Space, Typography, Select, InputNumber, App, Checkbox, Slider, Tabs, Flex } from 'antd';
import { CloseOutlined, ScissorOutlined, UndoOutlined, CheckOutlined, FullscreenOutlined } from '@ant-design/icons';
import { useConfigSubscribe } from '@/contexts/ConfigContext';
import { instantTransparencyFromDataUrl, getInstantTransparencyPreviewDataUrl } from '@/utils/instantTransparencyMatting';
import { CHECKERBOARD_BACKGROUND } from '@/styles/checkerboardBackground';
import { ImagePreviewButton } from '@/components/antd-plus/ImagePreviewButton';
import { buildMergedMattingOptions } from '@/pages/settings/mattingOptions';

const { Text } = Typography;

/** 图片编辑器：仅用 dataUrl，不依赖项目素材路径 */
export interface MattingSettingsPanelStandalone {
  sourceDataUrl: string;
  onApply: (itemId: string, dataUrl: string) => void;
  matteImageFromDataUrl: (
    dataUrl: string,
    options?: { mattingModel?: string; downsampleRatio?: number }
  ) => Promise<{ ok: boolean; dataUrl?: string; error?: string }>;
}

export interface MattingSettingsPanelProps {
  open: boolean;
  onClose: () => void;
  itemId: string;
  /** 漫剧素材：与 standalone 二选一 */
  projectDir?: string;
  imagePath?: string;
  getAssetDataUrl?: (projectDir: string, path: string) => Promise<string | null>;
  saveAssetFromBase64?: (
    projectDir: string,
    base64Data: string,
    ext?: string,
    type?: string,
    options?: { replaceAssetId?: string }
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  matteImageAndSave?: (
    projectDir: string,
    path: string,
    options?: { mattingModel?: string; downsampleRatio?: number; replaceAssetId?: string }
  ) => Promise<{ ok: boolean; path?: string; error?: string }>;
  onPathChange?: (itemId: string, newPath: string) => void;
  replaceAssetId?: string;
  /** 写入 assets_index 的 type（默认 character；图片编辑等分镜可为 prop） */
  saveAssetType?: string;
  standalone?: MattingSettingsPanelStandalone;
}

export function MattingSettingsPanel({
  open,
  onClose,
  itemId,
  projectDir = '',
  imagePath = '',
  getAssetDataUrl,
  saveAssetFromBase64,
  matteImageAndSave,
  onPathChange,
  replaceAssetId,
  saveAssetType = 'character',
  standalone,
}: MattingSettingsPanelProps) {
  const { message } = App.useApp();
  const config = useConfigSubscribe();

  const [mattingMethod, setMattingMethod] = useState<string>('instant');
  const [tolerance, setTolerance] = useState(30);
  const [contiguous, setContiguous] = useState(true);
  const [antiAliasing, setAntiAliasing] = useState(true);
  const [feather, setFeather] = useState(0);
  const [loading, setLoading] = useState(false);
  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [originalImageUrl, setOriginalImageUrl] = useState<string | null>(null);
  const previewAbortRef = useRef<number>(0);
  const [mattedResult, setMattedResult] = useState<{ dataUrl: string; path?: string; base64?: string } | null>(null);
  /** 撤销：素材模式下为旧 relativePath；standalone 下为替换前的 dataUrl */
  const [originalPath, setOriginalPath] = useState<string | null>(null);
  const [activePreviewTab, setActivePreviewTab] = useState<string>('original');

  const [pos, setPos] = useState({ x: 80, y: 80 });
  const [isDragging, setIsDragging] = useState(false);
  const dragRef = useRef<{ startX: number; startY: number; initX: number; initY: number } | null>(null);

  const mattingOptions = buildMergedMattingOptions(config?.models);

  const handleHeaderPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = { startX: e.clientX, startY: e.clientY, initX: pos.x, initY: pos.y };
      setIsDragging(true);
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    },
    [pos]
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragRef.current) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setPos({ x: dragRef.current.initX + dx, y: dragRef.current.initY + dy });
    },
    []
  );

  const handlePointerUp = useCallback(() => {
    dragRef.current = null;
    setIsDragging(false);
  }, []);

  const handleExecute = useCallback(async () => {
    const resolveSrc = async (): Promise<string | null> => {
      if (standalone) return standalone.sourceDataUrl;
      if (!imagePath || !getAssetDataUrl) return null;
      return getAssetDataUrl(projectDir, imagePath);
    };
    const srcUrl = await resolveSrc();
    if (!srcUrl) {
      message.error('无法加载图片');
      return;
    }
    setLoading(true);
    setMattedResult(null);
    try {
      if (mattingMethod === 'instant') {
        let base64: string;
        try {
          base64 = await instantTransparencyFromDataUrl(srcUrl, {
            tolerance,
            contiguous,
            antiAliasing,
            feather,
          });
        } catch (e) {
          message.error(e instanceof Error ? e.message : '抠图处理失败');
          return;
        }
        const mattedDataUrl = `data:image/png;base64,${base64}`;
        setMattedResult({ dataUrl: mattedDataUrl, base64 });
        setActivePreviewTab('result');
        message.success('抠图完成，请确认后替换');
      } else if (standalone) {
        const res = await standalone.matteImageFromDataUrl(srcUrl, {
          mattingModel: mattingMethod,
        });
        if (res.ok && res.dataUrl) {
          setMattedResult({ dataUrl: res.dataUrl });
          setActivePreviewTab('result');
          message.success('抠图完成，请确认后替换');
        } else {
          message.error(res.error ?? '抠图失败');
        }
      } else {
        if (!matteImageAndSave || !imagePath) return;
        const res = await matteImageAndSave(projectDir, imagePath, {
          mattingModel: mattingMethod,
          replaceAssetId,
        });
        if (res.ok && res.path && getAssetDataUrl) {
          const mattedDataUrl = await getAssetDataUrl(projectDir, res.path);
          setMattedResult({ dataUrl: mattedDataUrl ?? '', path: res.path });
          setActivePreviewTab('result');
          message.success('抠图完成，请确认后替换');
        } else {
          message.error(res.error ?? '抠图失败');
        }
      }
    } finally {
      setLoading(false);
    }
  }, [
    standalone,
    projectDir,
    imagePath,
    mattingMethod,
    tolerance,
    contiguous,
    antiAliasing,
    feather,
    getAssetDataUrl,
    matteImageAndSave,
    replaceAssetId,
    message,
  ]);

  const handleConfirmReplace = useCallback(async () => {
    if (!mattedResult) return;
    if (standalone) {
      setOriginalPath(standalone.sourceDataUrl);
      standalone.onApply(itemId, mattedResult.dataUrl);
      setMattedResult(null);
      message.success('已替换，可点击撤销恢复原图');
      return;
    }
    if (!onPathChange) return;
    if (mattedResult.path) {
      setOriginalPath(imagePath);
      onPathChange(itemId, mattedResult.path);
      setMattedResult(null);
      message.success('已替换，可点击撤销恢复原图');
    } else if (mattedResult.base64 && saveAssetFromBase64) {
      const res = await saveAssetFromBase64(
        projectDir,
        mattedResult.base64,
        '.png',
        saveAssetType,
        replaceAssetId ? { replaceAssetId } : undefined
      );
      if (res.ok && res.path) {
        setOriginalPath(imagePath);
        onPathChange(itemId, res.path);
        setMattedResult(null);
        message.success('已替换，可点击撤销恢复原图');
      } else {
        message.error(res.error ?? '保存失败');
      }
    }
  }, [
    itemId,
    projectDir,
    imagePath,
    mattedResult,
    saveAssetFromBase64,
    onPathChange,
    message,
    replaceAssetId,
    saveAssetType,
    standalone,
  ]);

  const handleUndo = useCallback(() => {
    if (!originalPath) return;
    if (standalone) {
      standalone.onApply(itemId, originalPath);
    } else if (onPathChange) {
      onPathChange(itemId, originalPath);
    }
    setOriginalPath(null);
    message.success('已撤销，恢复原图');
  }, [itemId, originalPath, onPathChange, standalone, message]);

  useEffect(() => {
    if (!open) {
      setOriginalPath(null);
      setMattedResult(null);
      setPreviewDataUrl(null);
      setPreviewError(null);
      setOriginalImageUrl(null);
    }
  }, [open]);

  useEffect(() => {
    if (!mattedResult && activePreviewTab === 'result') {
      setActivePreviewTab(mattingMethod === 'instant' ? 'selection' : 'original');
    }
  }, [mattedResult, activePreviewTab, mattingMethod]);

  useEffect(() => {
    const validKeys = ['original', ...(mattingMethod === 'instant' ? ['selection'] : []), ...(mattedResult ? ['result'] : [])];
    if (!validKeys.includes(activePreviewTab)) {
      setActivePreviewTab(validKeys[0] ?? 'original');
    }
  }, [activePreviewTab, mattingMethod, mattedResult]);

  useEffect(() => {
    if (!open) return;
    if (standalone) {
      setOriginalImageUrl(standalone.sourceDataUrl);
      return;
    }
    if (!imagePath || !getAssetDataUrl) return;
    getAssetDataUrl(projectDir, imagePath).then(setOriginalImageUrl);
  }, [open, standalone, standalone?.sourceDataUrl, imagePath, projectDir, getAssetDataUrl]);

  useEffect(() => {
    if (mattingMethod !== 'instant' || !open) {
      setPreviewDataUrl(null);
      return;
    }
    const id = ++previewAbortRef.current;
    const t = setTimeout(async () => {
      setPreviewError(null);
      try {
        let dataUrl: string | null = null;
        if (standalone) dataUrl = standalone.sourceDataUrl;
        else if (imagePath && getAssetDataUrl) dataUrl = await getAssetDataUrl(projectDir, imagePath);
        if (!dataUrl || id !== previewAbortRef.current) return;
        const url = await getInstantTransparencyPreviewDataUrl(dataUrl, {
          tolerance,
          contiguous,
          antiAliasing,
          feather,
        });
        if (id !== previewAbortRef.current) return;
        setPreviewDataUrl(url);
      } catch (e) {
        if (id === previewAbortRef.current) {
          setPreviewError(e instanceof Error ? e.message : '预览失败');
          setPreviewDataUrl(null);
        }
      }
    }, 150);
    return () => clearTimeout(t);
  }, [
    mattingMethod,
    standalone,
    standalone?.sourceDataUrl,
    imagePath,
    open,
    projectDir,
    getAssetDataUrl,
    tolerance,
    contiguous,
    antiAliasing,
    feather,
  ]);

  useEffect(() => {
    if (mattingMethod === 'instant') {
      setActivePreviewTab('selection');
    } else {
      setActivePreviewTab('original');
    }
  }, [mattingMethod]);

  const previewContainerStyle: React.CSSProperties = {
    width: '100%',
    maxHeight: 160,
    background: 'rgba(0,0,0,0.3)',
    borderRadius: 4,
    overflow: 'hidden',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  };

  const tabItems = [
    {
      key: 'original',
      label: '原图',
      children: originalImageUrl ? (
        <div style={{ ...previewContainerStyle, ...CHECKERBOARD_BACKGROUND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <img src={originalImageUrl} alt="原图" style={{ maxWidth: '100%', maxHeight: 152, objectFit: 'contain' }} />
        </div>
      ) : (
        <div style={previewContainerStyle}><Text type="secondary" style={{ fontSize: 12 }}>加载中…</Text></div>
      ),
    },
    ...(mattingMethod === 'instant'
      ? [{
          key: 'selection',
          label: '选取预览',
          children: previewError ? (
            <div style={previewContainerStyle}><Text type="secondary" style={{ fontSize: 12 }}>{previewError}</Text></div>
          ) : previewDataUrl ? (
            <div style={{ ...previewContainerStyle, ...CHECKERBOARD_BACKGROUND, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <img src={previewDataUrl} alt="选取预览" style={{ maxWidth: '100%', maxHeight: 152, objectFit: 'contain' }} />
            </div>
          ) : (
            <div style={previewContainerStyle}><Text type="secondary" style={{ fontSize: 12 }}>加载中…</Text></div>
          ),
        }]
      : []),
    ...(mattedResult
      ? [{
          key: 'result',
          label: '抠图结果',
          children: (
            <div style={{ ...previewContainerStyle, ...CHECKERBOARD_BACKGROUND, display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' }}>
              <img src={mattedResult.dataUrl} alt="抠图结果" style={{ maxWidth: '100%', maxHeight: 152, objectFit: 'contain' }} />
              <div style={{ position: 'absolute', top: 4, right: 4, zIndex: 1 }}>
                <ImagePreviewButton images={mattedResult.dataUrl}>
                  <Button
                    type="text"
                    size="small"
                    icon={<FullscreenOutlined />}
                    style={{ color: 'rgba(255,255,255,0.85)' }}
                    title="全屏预览"
                  />
                </ImagePreviewButton>
              </div>
            </div>
          ),
        }]
      : []),
  ];

  if (!open) return null;

  return (
    <>
      <div
        role="dialog"
        aria-label="抠图设置"
        style={{
          position: 'fixed',
          left: pos.x,
          top: pos.y,
          zIndex: 1050,
          width: 340,
          background: 'rgba(30, 30, 30, 0.98)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 8,
          boxShadow: '0 4px 24px rgba(0,0,0,0.4)',
          overflow: 'hidden',
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerUp}
      >
        <div
          style={{
            padding: '8px 12px',
            cursor: isDragging ? 'grabbing' : 'grab',
            userSelect: 'none',
            borderBottom: '1px solid rgba(255,255,255,0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
          onPointerDown={handleHeaderPointerDown}
        >
          <Text strong>抠图设置</Text>
          <Button
            type="text"
            size="small"
            icon={<CloseOutlined />}
            onClick={onClose}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ color: 'rgba(255,255,255,0.65)' }}
          />
        </div>

        <div style={{ padding: 12 }}>
          <Space orientation="vertical" style={{ width: '100%' }} size="small">
            <div>
              <Text type="secondary" style={{ fontSize: 12 }}>抠图方式</Text>
              <Select
                value={mattingMethod}
                onChange={(v) => setMattingMethod(v ?? 'instant')}
                options={mattingOptions}
                style={{ width: '100%', marginTop: 4 }}
              />
            </div>

            <div>
              <Tabs
                size="small"
                activeKey={activePreviewTab}
                onChange={setActivePreviewTab}
                items={tabItems}
                style={{ marginTop: 4 }}
              />
            </div>

            {mattingMethod === 'instant' && (
              <>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>容差 (0–255)</Text>
                  <Slider min={0} max={255} value={tolerance} onChange={setTolerance} style={{ marginTop: 4 }} />
                </div>
                <Checkbox checked={contiguous} onChange={(e) => setContiguous(e.target.checked)}>
                  连续（仅选与角连通的区域）
                </Checkbox>
                <Checkbox checked={antiAliasing} onChange={(e) => setAntiAliasing(e.target.checked)}>
                  抗锯齿
                </Checkbox>
                <div>
                  <Text type="secondary" style={{ fontSize: 12 }}>羽化 (px)</Text>
                  <InputNumber
                    min={0}
                    max={20}
                    value={feather}
                    onChange={(v) => setFeather(v ?? 0)}
                    style={{ width: '100%', marginTop: 4 }}
                  />
                </div>
              </>
            )}

            <Flex justify="space-between" align="center" style={{ width: '100%' }}>
              <Space>
                <Button type="primary" icon={<ScissorOutlined />} onClick={handleExecute} loading={loading}>
                  抠图
                </Button>
                {originalPath && (
                  <Button icon={<UndoOutlined />} onClick={handleUndo}>
                    撤销
                  </Button>
                )}
              </Space>
              <Button
                type="primary"
                icon={<CheckOutlined />}
                onClick={handleConfirmReplace}
                disabled={!mattedResult}
              >
                确认替换
              </Button>
            </Flex>
          </Space>
        </div>
      </div>
    </>
  );
}
