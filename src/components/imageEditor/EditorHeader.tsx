/**
 * 图片编辑器顶栏：插入、导出、缩放、AI
 */
import React, { useState } from 'react';
import { Button, Space, Dropdown, Tooltip, Select, Popover } from 'antd';
import type { DefaultOptionType } from 'antd/es/select';
import type { MenuProps } from 'antd';
import {
  FileImageOutlined,
  FolderOpenOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import { ShapePresetGrid, SHAPE_PRESET_GRID_OUTER_PX } from './ShapePresetGrid';
import type { ShapePresetId } from './editorShapePresets';

/** 与图片编辑器页一致的缩放档位（百分比数值字符串，以及 fit） */
export const IMAGE_EDITOR_ZOOM_PRESET_PCTS = [25, 50, 75, 100, 125, 150, 200, 300, 400] as const;

const ZOOM_SELECT_OPTIONS: DefaultOptionType[] = [
  {
    label: '视图',
    options: [
      { value: 'fit', label: '适合画布' },
      // {
      //   value: '__autocenter__',
      //   label: '✓ 自动居中（画布始终居中）',
      //   disabled: true,
      // },
    ],
  },
  {
    label: '缩放比例',
    options: IMAGE_EDITOR_ZOOM_PRESET_PCTS.map((p) => ({ value: String(p), label: `${p}%` })),
  },
];

export interface EditorHeaderProps {
  onBack: () => void;
  /** 当前缩放比例展示用，如 54 表示 54% */
  zoomPercentRounded: number;
  /** Select 的 value：实际缩放对应的百分比字符串（见 useImageEditorZoomHeaderDisplay） */
  zoomSelectValue: string;
  /** 缩放下拉旁 Tooltip 全文 */
  zoomTooltipTitle: string;
  onZoomSelect: (value: string) => void;
  onInsertImage: () => void;
  onInsertShapePreset: (presetId: ShapePresetId) => void;
  onInsertText: () => void;
  onAiGenerate: () => void;
  aiDisabled?: boolean;
  aiDisabledReason?: string;
  onExport: () => void;
  onSaveToAsset: () => void;
  /** 无漫剧项目时禁用（保存将在弹窗中选项目） */
  saveToAssetDisabled?: boolean;
  onOpenNewCanvas: () => void;
  onOpenLocalImage: () => void;
  onOpenFromLibrary: () => void;
  libraryDisabled?: boolean;
  /** 蘑菇鸭新增：保存到历史项目 */
  onSave?: () => void;
  /** 蘑菇鸭新增：另存为新项目 */
  onSaveAs?: () => void;
  /** 蘑菇鸭新增：当前是否已有打开的项目（决定「保存」可用） */
  hasOpenProject?: boolean;
  onUndo?: () => void;
  onRedo?: () => void;
  undoDisabled?: boolean;
  redoDisabled?: boolean;
}

export const EditorHeader: React.FC<EditorHeaderProps> = ({
  onBack,
  zoomPercentRounded,
  zoomSelectValue,
  zoomTooltipTitle,
  onZoomSelect,
  onInsertImage,
  onInsertShapePreset,
  onInsertText,
  onAiGenerate,
  aiDisabled,
  aiDisabledReason,
  onExport,
  onSaveToAsset,
  saveToAssetDisabled,
  onOpenNewCanvas,
  onOpenLocalImage,
  onOpenFromLibrary,
  libraryDisabled,
  onSave,
  onSaveAs,
  hasOpenProject,
  onUndo,
  onRedo,
  undoDisabled,
  redoDisabled,
}) => {
  const [shapePopoverOpen, setShapePopoverOpen] = useState(false);

  const fileMenu: MenuProps['items'] = [
    { key: 'new', icon: <PlusOutlined />, label: '新建空白画布', onClick: onOpenNewCanvas },
    { key: 'local', icon: <FolderOpenOutlined />, label: '打开本地图片…', onClick: onOpenLocalImage },
    {
      key: 'lib',
      icon: <FileImageOutlined />,
      label: '从素材库选择…',
      disabled: libraryDisabled,
      onClick: onOpenFromLibrary,
    },
    { type: 'divider' },
    {
      key: 'save',
      label: '保存项目',
      disabled: !hasOpenProject || !onSave,
      onClick: () => onSave?.(),
    },
    {
      key: 'saveAs',
      label: '另存为新项目…',
      disabled: !onSaveAs,
      onClick: () => onSaveAs?.(),
    },
  ];

  return (
    <header className="yiman-image-editor-toolbar">
      <Space size="middle" wrap style={{ alignItems: 'center' }}>
        <Tooltip title="退出编辑">
          <Button type="text" shape="default" icon={<i className="iconfont">&#xe930;</i>} onClick={onBack} aria-label="返回项目列表" />
        </Tooltip>
        <Tooltip title="原始图片">
          <Dropdown menu={{ items: fileMenu }} trigger={['click']}>
            <Button type="text" icon={<i className="iconfont">&#xe97f;</i>} />
          </Dropdown>
        </Tooltip>
        <Tooltip title="插入图片">
          <Button type="text" icon={<i className="iconfont">&#xe65b;</i>} onClick={onInsertImage} aria-label="插入图片" />
        </Tooltip>
        <Tooltip title="插入形状">
          <Popover
            trigger="click"
            placement="bottomLeft"
            open={shapePopoverOpen}
            onOpenChange={setShapePopoverOpen}
            styles={{
              content: {
                padding: 0,
                minWidth: SHAPE_PRESET_GRID_OUTER_PX,
                background: '#2f2f2f',
                border: '1px solid rgba(255,255,255,0.12)',
              },
            }}
            content={
              <ShapePresetGrid
                onPick={(id) => {
                  onInsertShapePreset(id);
                  setShapePopoverOpen(false);
                }}
              />
            }
          >
            <Button type="text" icon={<i className="iconfont">&#xea22;</i>} aria-label="插入形状" />
          </Popover>
        </Tooltip>
        <Tooltip title="插入文本框">
          <Button type="text" icon={<i className="iconfont">&#xe6b0;</i>} onClick={onInsertText} aria-label="插入文本框" />
        </Tooltip>
        <Tooltip title={aiDisabled && aiDisabledReason ? aiDisabledReason : 'AI 生成图片'}>
          <span className={aiDisabled ? 'yiman-editor-header-icon-wrap' : undefined}>
            <Button type="text" icon={<i className="iconfont">&#xe63f;</i>} onClick={onAiGenerate} disabled={aiDisabled} aria-label="AI 生成" />
          </span>
        </Tooltip>
      </Space>
      <Space size="large" wrap style={{ alignItems: 'center' }}>
        <Tooltip title="撤销 (⌘Z / Ctrl+Z)">
          <Button
            type="text"
            shape="circle"
            icon={<i className="iconfont">&#xe9b3;</i>}
            onClick={() => onUndo?.()}
            disabled={undoDisabled ?? !onUndo}
            aria-label="撤销"
          />
        </Tooltip>
        <Tooltip title="重做 (⌘⇧Z / Ctrl+Shift+Z)">
          <Button
            type="text"
            shape="circle"
            icon={<i className="iconfont">&#xe993;</i>}
            onClick={() => onRedo?.()}
            disabled={redoDisabled ?? !onRedo}
            aria-label="重做"
          />
        </Tooltip>
        <Tooltip title="导出图片">
          <Button type="text" icon={<i className="iconfont">&#xe6e6;</i>} onClick={onExport} aria-label="导出图片" />
        </Tooltip>
        <Tooltip
          title={
            saveToAssetDisabled ? '暂无漫剧项目，请先在项目列表创建或导入' : '保存到漫剧素材库'
          }
        >
          <span className={saveToAssetDisabled ? 'yiman-editor-header-icon-wrap' : undefined}>
            <Button
              type="text"
              icon={<i className="iconfont">&#xe99b;</i>}
              onClick={onSaveToAsset}
              disabled={saveToAssetDisabled}
              aria-label="保存到素材"
            />
          </span>
        </Tooltip>
        <Tooltip title={zoomTooltipTitle}>
          <Select
            style={{ width: 80 }}
            variant="borderless"
            value={zoomSelectValue}
            onChange={(v) => onZoomSelect(v)}
            options={ZOOM_SELECT_OPTIONS}
            aria-label={`画布缩放 ${zoomPercentRounded}%`}
            popupMatchSelectWidth={false}
            labelRender={({ value }) => (value != null ? `${value}%` : '')}
          />
        </Tooltip>
      </Space>
    </header>
  );
};
