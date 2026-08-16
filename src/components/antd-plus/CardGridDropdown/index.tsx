/**
 * 高级下拉：展开为卡片网格，支持自定义单项渲染（如花字 CSS 预览）
 */
import React, { useCallback, useMemo, useState } from 'react';
import { Dropdown } from 'antd';
import type { DropdownProps } from 'antd';

const PANEL_BG = '#1e2126';
const CARD_BG = 'rgba(255,255,255,0.06)';
const CARD_BORDER = 'rgba(255,255,255,0.10)';
const CARD_SELECTED = 'rgba(24, 144, 255, 0.35)';

export interface CardGridDropdownProps<T> {
  items: readonly T[];
  getItemKey: (item: T, index: number) => string;
  /** 卡片内主体内容由调用方渲染（图标、花字预览等） */
  renderItem: (item: T, ctx: { selected: boolean; index: number }) => React.ReactNode;
  /** 当前选中项 key，用于高亮边框 */
  selectedKey?: string | null;
  onSelect?: (item: T, key: string, index: number) => void;
  /** 网格列数，默认 4（参考常见花字面板） */
  columns?: number;
  /** 正方形卡片边长（px） */
  cardSize?: number;
  gap?: number;
  /** 面板水平内边距 */
  panelPadding?: number;
  /** 触发器 */
  children: React.ReactElement;
  /** 面板顶部说明，可选 */
  header?: React.ReactNode;
  dropdownProps?: Partial<DropdownProps>;
}

export function CardGridDropdown<T>({
  items,
  getItemKey,
  renderItem,
  selectedKey,
  onSelect,
  columns = 4,
  cardSize = 76,
  gap = 10,
  panelPadding = 12,
  children,
  header,
  dropdownProps,
}: CardGridDropdownProps<T>) {
  const [open, setOpen] = useState(false);

  const mergedDropdownProps = useMemo((): DropdownProps => {
    const { onOpenChange: userOnOpenChange, open: _userOpen, ...dropdownPropsRest } = dropdownProps ?? {};
    return {
      placement: 'bottomLeft',
      trigger: ['click'],
      ...dropdownPropsRest,
      open,
      onOpenChange: (nextOpen, info) => {
        setOpen(nextOpen);
        userOnOpenChange?.(nextOpen, info);
      },
    };
  }, [dropdownProps, open]);

  const onCardClick = useCallback(
    (item: T, index: number) => {
      const key = getItemKey(item, index);
      onSelect?.(item, key, index);
      setOpen(false);
    },
    [getItemKey, onSelect]
  );

  const dropdownRender = useCallback(() => {
    return (
      <div
        style={{
          background: PANEL_BG,
          borderRadius: 12,
          boxShadow: '0 8px 28px rgba(0,0,0,0.45)',
          border: '1px solid rgba(255,255,255,0.08)',
          padding: panelPadding,
          minWidth: columns * cardSize + (columns - 1) * gap + panelPadding * 2,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {header ? (
          <div style={{ marginBottom: 10, color: 'rgba(255,255,255,0.55)', fontSize: 12 }}>{header}</div>
        ) : null}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${columns}, ${cardSize}px)`,
            gap,
            justifyContent: 'start',
          }}
        >
          {items.map((item, index) => {
            const key = getItemKey(item, index);
            const selected = selectedKey != null && selectedKey === key;
            return (
              <button
                key={key}
                type="button"
                title={key}
                onClick={() => onCardClick(item, index)}
                style={{
                  width: cardSize,
                  height: cardSize,
                  padding: 0,
                  borderRadius: 10,
                  border: `1px solid ${selected ? 'rgba(64, 169, 255, 0.85)' : CARD_BORDER}`,
                  background: selected ? CARD_SELECTED : CARD_BG,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  boxSizing: 'border-box',
                }}
              >
                {renderItem(item, { selected, index })}
              </button>
            );
          })}
        </div>
      </div>
    );
  }, [items, getItemKey, renderItem, selectedKey, columns, cardSize, gap, panelPadding, header, onCardClick]);

  return (
    <Dropdown {...mergedDropdownProps} popupRender={dropdownRender}>
      {children}
    </Dropdown>
  );
}
