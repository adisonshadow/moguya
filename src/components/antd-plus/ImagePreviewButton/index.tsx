/**
 * 基于 antd Image 的全屏图片预览触发器
 * 通过 children 点击打开预览，支持单图和多图，预览遮罩使用棋盘格背景
 */
import React, { useState } from 'react';
import { Image } from 'antd';
import { CHECKERBOARD_BACKGROUND } from '@/styles/checkerboardBackground';

/** 预览遮罩样式：棋盘格背景，不透明 */
const PREVIEW_MASK_STYLES = {
  ...CHECKERBOARD_BACKGROUND,
  opacity: 1,
} as React.CSSProperties;

export interface ImagePreviewButtonProps {
  /** 单图 URL 或多图 URL 数组 */
  images: string | string[];
  /** 触发预览的元素，样式和内容由调用方控制 */
  children: React.ReactElement;
}

export function ImagePreviewButton({
  images,
  children,
}: ImagePreviewButtonProps) {
  const [open, setOpen] = useState(false);
  const urls = Array.isArray(images) ? images : [images];
  const hasMultiple = urls.length > 1;

  const previewConfig = {
    open,
    onOpenChange: setOpen,
  };

  const previewStyles = {
    popup: {
      mask: PREVIEW_MASK_STYLES,
    },
  };

  const trigger = React.cloneElement(children, {
    onClick: (e: React.MouseEvent) => {
      (children.props as { onClick?: (e: React.MouseEvent) => void }).onClick?.(e);
      setOpen(true);
    },
  });

  return (
    <>
      {trigger}
      {hasMultiple ? (
        <div style={{ display: 'none' }}>
          <Image.PreviewGroup
            items={urls}
            preview={previewConfig}
            styles={previewStyles}
          />
        </div>
      ) : (
        <div style={{ display: 'none' }}>
          <Image
            src={urls[0]}
            preview={previewConfig}
            styles={previewStyles}
          />
        </div>
      )}
    </>
  );
}
