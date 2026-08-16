/**
 * 图片编辑器：导出格式选择 Modal（见功能文档 图片编辑）
 */
import React, { useMemo, useState } from 'react';
import { Modal, Radio, Space } from 'antd';
import type { EditorCanvasHandle } from './EditorCanvas';
import type { EditorObject } from './editorTypes';
import {
  buildEditorSvgString,
  buildPdfFromPngDataUrl,
  buildEpsFromPngDataUrlAsync,
  buildOdgZipBase64FromPngDataUrl,
  editorHasVectorPathLayer,
  stripDataUrlToBase64,
  utf8ToBase64,
  uint8ToBase64,
  type RasterExportMime,
} from './imageEditorExportFormats';

export type ImageExportFormat =
  | 'png'
  | 'jpeg'
  | 'webp'
  | 'pdf'
  | 'svg'
  | 'eps'
  | 'odg';

export interface ImageEditorExportModalProps {
  open: boolean;
  onClose: () => void;
  canvasRef: React.RefObject<EditorCanvasHandle | null>;
  objects: EditorObject[];
  docWidth: number;
  docHeight: number;
  docBackgroundColor: string;
  exportDefaultStem: string;
  /** 源文件所在目录；有值时在打开系统保存对话框前于该目录预计算不冲突的默认全路径 */
  exportDefaultDir: string | null;
  stripDataUrlToBase64Fn?: (s: string) => string;
  onSuccess: () => void;
  onError: (msg: string) => void;
}

function extensionForFormat(f: ImageExportFormat): string {
  switch (f) {
    case 'jpeg':
      return 'jpg';
    case 'webp':
      return 'webp';
    case 'pdf':
      return 'pdf';
    case 'svg':
      return 'svg';
    case 'eps':
      return 'eps';
    case 'odg':
      return 'odg';
    default:
      return 'png';
  }
}

function filtersForFormat(f: ImageExportFormat): { name: string; extensions: string[] }[] {
  const ext = extensionForFormat(f);
  const label =
    f === 'jpeg'
      ? 'JPEG'
      : f === 'webp'
        ? 'WebP'
        : f === 'pdf'
          ? 'PDF'
          : f === 'svg'
            ? 'SVG'
            : f === 'eps'
              ? 'EPS'
              : f === 'odg'
                ? 'ODG'
                : 'PNG';
  return [{ name: label, extensions: [ext] }];
}

export const ImageEditorExportModal: React.FC<ImageEditorExportModalProps> = ({
  open,
  onClose,
  canvasRef,
  objects,
  docWidth,
  docHeight,
  docBackgroundColor,
  exportDefaultStem,
  exportDefaultDir,
  stripDataUrlToBase64Fn = stripDataUrlToBase64,
  onSuccess,
  onError,
}) => {
  const hasVector = useMemo(() => editorHasVectorPathLayer(objects), [objects]);
  const [format, setFormat] = useState<ImageExportFormat>('png');
  const [loading, setLoading] = useState(false);

  const allowedFormats = useMemo(() => {
    const base: ImageExportFormat[] = ['png', 'jpeg', 'webp', 'pdf'];
    if (hasVector) base.push('svg', 'eps', 'odg');
    return base;
  }, [hasVector]);

  React.useEffect(() => {
    if (open && !allowedFormats.includes(format)) {
      setFormat('png');
    }
  }, [open, allowedFormats, format]);

  const runExport = async () => {
    const canvas = canvasRef.current;
    if (!canvas) {
      onError('导出失败');
      return;
    }
    const dw = Math.max(1, Math.round(docWidth));
    const dh = Math.max(1, Math.round(docHeight));
    const ext = extensionForFormat(format);
    const baseName = `${exportDefaultStem}.${ext}`;
    const fsApi = window.yiman?.fs;
    let defaultPath = baseName;
    if (exportDefaultDir?.trim() && fsApi?.getUnusedSaveDefaultPath) {
      const suggested = await fsApi.getUnusedSaveDefaultPath(exportDefaultDir.trim(), baseName);
      if (suggested?.trim()) defaultPath = suggested;
    }
    const chosenPath = await window.yiman?.dialog.saveFile({
      defaultPath,
      filters: filtersForFormat(format),
    });
    if (!chosenPath?.trim()) return;
    if (!fsApi?.writeBase64File) {
      onError('当前环境不支持文件写入');
      return;
    }
    const savePath = chosenPath.trim();

    setLoading(true);
    try {
      let outBase64: string;

      if (format === 'svg') {
        const svg = buildEditorSvgString(objects, docWidth, docHeight, docBackgroundColor);
        outBase64 = utf8ToBase64(svg);
      } else if (format === 'eps' || format === 'odg' || format === 'pdf') {
        const pngUrl = canvas.exportDocRasterDataUrl({
          pixelRatio: 2,
          mimeType: 'image/png',
        });
        if (!pngUrl) {
          onError('导出失败');
          return;
        }
        if (format === 'pdf') {
          const pdfBytes = await buildPdfFromPngDataUrl(pngUrl, dw, dh);
          outBase64 = uint8ToBase64(pdfBytes);
        } else if (format === 'eps') {
          const epsText = await buildEpsFromPngDataUrlAsync(pngUrl);
          outBase64 = utf8ToBase64(epsText);
        } else {
          outBase64 = buildOdgZipBase64FromPngDataUrl(pngUrl);
        }
      } else {
        const mime: RasterExportMime =
          format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
        const quality = format === 'png' ? undefined : 0.92;
        const dataUrl = canvas.exportDocRasterDataUrl({
          pixelRatio: 2,
          mimeType: mime,
          quality,
        });
        if (!dataUrl) {
          onError('导出失败');
          return;
        }
        outBase64 = stripDataUrlToBase64Fn(dataUrl);
      }

      const res = await fsApi.writeBase64File(savePath, outBase64);
      if (!res?.ok) onError(res?.error ?? '写入失败');
      else {
        onSuccess();
        onClose();
      }
    } catch (e) {
      onError(e instanceof Error ? e.message : '导出失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal
      title="导出图片"
      centered
      open={open}
      onCancel={onClose}
      onOk={() => void runExport()}
      okText="导出"
      cancelText="取消"
      confirmLoading={loading}
      destroyOnHidden
    >
      <Space orientation="vertical" style={{ width: '100%' }} size="middle">
        <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 13 }}>选择导出格式</div>
        <Radio.Group value={format} onChange={(e) => setFormat(e.target.value)}>
          <Space orientation="vertical">
            <Radio value="png">PNG</Radio>
            <Radio value="jpeg">JPEG</Radio>
            <Radio value="webp">WebP</Radio>
            <Radio value="pdf">PDF（整页栅格）</Radio>
            {hasVector ? (
              <>
                <Radio value="svg">SVG</Radio>
                <Radio value="eps">EPS（整页栅格）</Radio>
                <Radio value="odg">ODG（整页栅格）</Radio>
              </>
            ) : null}
          </Space>
        </Radio.Group>
      </Space>
    </Modal>
  );
};
