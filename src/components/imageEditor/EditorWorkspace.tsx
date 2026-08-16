/**
 * 图片编辑器左侧图层面板
 */
import React from 'react';
import { Button, Space } from 'antd';
import { ArrowUpOutlined, ArrowDownOutlined, EyeFilled, EyeInvisibleFilled } from '@ant-design/icons';
import { IconButton } from '@/components/antd-plus/IconButton';
import type { EditorObject } from './editorTypes';
import { objectLabel } from './editorTypes';
import type { EditorSelectAction } from './EditorCanvas';

export interface EditorWorkspaceProps {
  objects: EditorObject[];
  selectedIds: string[];
  /** Shift+点击多选切换；普通点击单选 */
  onPickLayer: (action: EditorSelectAction) => void;
  onMoveLayer: (id: string, dir: 'up' | 'down' | 'top' | 'bottom') => void;
  onToggleLayerVisibility: (id: string) => void;
}

export const EditorWorkspace: React.FC<EditorWorkspaceProps> = ({
  objects,
  selectedIds,
  onPickLayer,
  onMoveLayer,
  onToggleLayerVisibility,
}) => {
  const moveTargetId = selectedIds.length === 1 ? selectedIds[0] : undefined;
  const reversed = [...objects].reverse();
  return (
    <aside className="yiman-image-editor-workspace">
      <div className="yiman-image-editor-workspace-title">图层</div>
      <div style={{ padding: '0 8px 8px' }}>
        <Space wrap size={6}>
          <Button
            size="small"
            disabled={!moveTargetId}
            onClick={() => moveTargetId && onMoveLayer(moveTargetId, 'up')}
          >
            <ArrowUpOutlined /> 上移
          </Button>
          <Button
            size="small"
            disabled={!moveTargetId}
            onClick={() => moveTargetId && onMoveLayer(moveTargetId, 'down')}
          >
            <ArrowDownOutlined /> 下移
          </Button>
        </Space>
      </div>
      <div className="yiman-image-editor-workspace-layers" style={{ flex: 1, overflow: 'auto' }}>
        {reversed.map((obj, revIdx) => {
          const index = objects.length - 1 - revIdx;
          return (
            <div
              key={obj.id}
              className={`yiman-image-editor-layer-item ${selectedIds.includes(obj.id) ? 'active' : ''}`}
              onClick={(e) =>
                onPickLayer(e.shiftKey ? { type: 'toggle', id: obj.id } : { type: 'set', ids: [obj.id] })
              }
              role="button"
              tabIndex={0}
              onKeyDown={(e) =>
                e.key === 'Enter' && onPickLayer({ type: 'set', ids: [obj.id] })
              }
            >
              <span className="yiman-image-editor-layer-item-label">{objectLabel(obj, index)}</span>
              <IconButton
                type="text"
                aria-label={obj.layerVisible === false ? '显示图层' : '隐藏图层'}
                icon={obj.layerVisible === false ? <EyeInvisibleFilled /> : <EyeFilled />}
                tooltip={obj.layerVisible === false ? '显示图层' : '隐藏图层'}
                onMouseDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleLayerVisibility(obj.id);
                }}
              />
            </div>
          );
        })}
      </div>
    </aside>
  );
};
