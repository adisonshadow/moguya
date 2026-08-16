/**
 * 矢量编辑：两个 path 选中时的路径查找器图标（合为/打孔/相交/差集），见 docs/14
 */
import React from 'react';
import { Button, Flex, Tooltip } from 'antd';
import type { PathBooleanOp } from '@/utils/pathBooleanPaper';

const btnStyle: React.CSSProperties = {
  width: 36,
  height: 36,
  padding: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
};

/** 与 EditorInspector arrangeIconGlyph 一致：仅十六进制码位，勿加 0x */
function pathBooleanIconGlyph(iconHex: string) {
  const cp = parseInt(iconHex, 16);
  return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
}

const ITEMS: { op: PathBooleanOp; title: string; iconHex: string }[] = [
  { op: 'unite', title: '合为一个', iconHex: 'e69a' },
  {
    op: 'subtract',
    title: '打孔（下层 − 上层：序号小先绘为底，序号大后绘为洞；与点选顺序无关）',
    iconHex: 'e68e',
  },
  { op: 'intersect', title: '取相交部分', iconHex: 'e64b' },
  { op: 'exclude', title: '取差集（对称差，去掉重叠）', iconHex: 'e635' },
];

export const PathBooleanInspectorButtons: React.FC<{
  disabled?: boolean;
  onOp: (op: PathBooleanOp) => void;
}> = ({ disabled, onOp }) => (
  <Flex gap={6} wrap="wrap" style={{ marginBottom: 10 }}>
    {ITEMS.map(({ op, title, iconHex }) => (
      <Tooltip key={op} title={title}>
        <Button
          type="text"
          style={btnStyle}
          icon={<i className="iconfont">{pathBooleanIconGlyph(iconHex)}</i>}
          disabled={disabled}
          onClick={() => onOp(op)}
          aria-label={title}
        />
      </Tooltip>
    ))}
  </Flex>
);
