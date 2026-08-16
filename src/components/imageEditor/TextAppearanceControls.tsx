/**
 * 文本框与形状内文字共用的字体与效果控件（EditorInspector）
 */
import React, { useMemo } from 'react';
import { Typography, Select, InputNumber, Slider, ColorPicker, Space, Checkbox, Button, Dropdown, Flex, Switch } from 'antd';
import { BoldOutlined, CheckOutlined, DownOutlined, ItalicOutlined } from '@ant-design/icons';
import type { MenuProps } from 'antd';
import { CardGridDropdown } from '@/components/antd-plus/CardGridDropdown';
import type { TextStylePreset } from './editorTypes';
import {
  TEXT_ONECLICK_ITEMS,
  flourishAppearancePatch,
  renderFlourishCardContent,
  textOneClickItemKey,
} from './textFlourishPresets';
import { DropShadowProjectionPanel } from './DropShadowProjectionPanel';
import {
  appearanceFaceBoldItalic,
  cssFontFamilyForPreview,
  defaultPostScriptForFamily,
  facesForFamily,
  formatFontVariantLabel,
  toggleAppearanceBold,
  toggleAppearanceItalic,
  weightKeywordToNumeric,
  type EditorFontFaceInfo,
  type EditorTextAppearanceModel,
} from './textAppearance';

const { Text } = Typography;

export interface TextAppearanceControlsProps {
  value: EditorTextAppearanceModel;
  onPatch: (p: Partial<EditorTextAppearanceModel>) => void;
  fontOptions: { value: string; label: string }[];
  /** 系统字体字面列表（与主进程 getFonts2 一致） */
  fontFaces: EditorFontFaceInfo[];
  bindNumberField: (key: string, apply: (v: number | null) => void) => {
    onChange: (v: number | null) => void;
    onBlur: () => void;
  };
  bindSlider: (key: string, apply: (v: number) => void) => {
    onChange: (v: number) => void;
    onChangeComplete: () => void;
  };
  recordHistory?: () => void;
  fieldKeyPrefix: string;
  /** 一键花字：与 editor 中 textPreset / shapeTextPreset 同步 */
  flourishSelectedPreset?: TextStylePreset;
  onFlourishApply?: (preset: TextStylePreset, appearance: Partial<EditorTextAppearanceModel>) => void;
}

export const TextAppearanceControls: React.FC<TextAppearanceControlsProps> = ({
  value: v,
  onPatch,
  fontOptions,
  fontFaces,
  bindNumberField,
  bindSlider,
  recordHistory,
  fieldKeyPrefix,
  flourishSelectedPreset,
  onFlourishApply,
}) => {
  const oneClickCardKey = useMemo(() => {
    const p = flourishSelectedPreset;
    if (p === 'none') return 'none';
    if (p && String(p).startsWith('flourish-')) return p;
    return null;
  }, [flourishSelectedPreset]);

  const flourishTriggerLabel = useMemo(() => {
    const p = flourishSelectedPreset;
    if (p === 'none') return '无样式';
    const hit = TEXT_ONECLICK_ITEMS.find((i) => i.preset === p);
    if (hit?.kind === 'flourish') return hit.label;
    return '选择花字…';
  }, [flourishSelectedPreset]);

  const flourishTrigger = (
    <Button
      size="small"
      block
      style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
    >
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{flourishTriggerLabel}</span>
      <DownOutlined style={{ fontSize: 11, opacity: 0.65, flexShrink: 0 }} />
    </Button>
  );
  /** 选项文案用该字体自身渲染（见功能预期：与其它软件一致的字形预览） */
  const fontSelectOptions = useMemo(
    () =>
      fontOptions.map((opt) => ({
        value: opt.value,
        label: (
          <span
            title={opt.label}
            style={{
              fontFamily: cssFontFamilyForPreview(opt.value),
              fontSize: 15,
              lineHeight: 1.4,
              color: 'rgba(255,255,255,0.92)',
            }}
          >
            {opt.label}
          </span>
        ),
      })),
    [fontOptions]
  );

  const variants = useMemo(() => facesForFamily(fontFaces, v.fontFamily), [fontFaces, v.fontFamily]);

  const effectivePostScript = v.fontPostScriptName || variants[0]?.postScriptName || '';

  const variantMenu = useMemo<MenuProps>(
    () => ({
      style: { minWidth: 200, background: '#1a1d21' },
      items: variants.map((face) => ({
        key: face.postScriptName,
        style: { color: 'rgba(255,255,255,0.88)' },
        label: (
          <span
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              fontFamily: v.fontFamily,
              fontWeight: weightKeywordToNumeric(face.weight),
              fontStyle: face.style === 'italic' || face.style === 'oblique' ? 'italic' : 'normal',
            }}
          >
            <span style={{ width: 14, textAlign: 'center' }}>
              {effectivePostScript === face.postScriptName ? <CheckOutlined style={{ fontSize: 12 }} /> : null}
            </span>
            {formatFontVariantLabel(face, v.fontFamily)}
          </span>
        ),
      })),
      onClick: ({ key }) => {
        recordHistory?.();
        onPatch({ fontPostScriptName: String(key) });
      },
    }),
    [variants, v.fontFamily, effectivePostScript, onPatch, recordHistory]
  );

  const currentVariantLabel = useMemo(() => {
    const hit = variants.find((f) => f.postScriptName === v.fontPostScriptName) ?? variants[0];
    return hit ? formatFontVariantLabel(hit, v.fontFamily) : '默认';
  }, [variants, v.fontPostScriptName, v.fontFamily]);

  const { bold: boldOn, italic: italicOn } = useMemo(
    () => appearanceFaceBoldItalic(fontFaces, v.fontFamily, v.fontPostScriptName),
    [fontFaces, v.fontFamily, v.fontPostScriptName]
  );

  const ptInput = (key: string, val: number, apply: (n: number) => void, min: number, max: number) => (
    <InputNumber
      min={min}
      max={max}
      value={val}
      size="small"
      style={{ width: '100%' }}
      formatter={(n) => (n == null ? '' : `${n} 点`)}
      parser={(s) => Number(String(s).replace(/点/g, '').trim())}
      {...bindNumberField(`${fieldKeyPrefix}-${key}`, (x) => apply(Number(x) || min))}
    />
  );

  return (
    <Space orientation="vertical" style={{ width: '100%' }} size={12}>
      {onFlourishApply ? (
        <div>
          <Text type="secondary">一键花字</Text>
          <CardGridDropdown
            items={TEXT_ONECLICK_ITEMS}
            getItemKey={textOneClickItemKey}
            renderItem={(item, ctx) => renderFlourishCardContent(item, ctx)}
            selectedKey={oneClickCardKey}
            columns={4}
            cardSize={76}
            gap={10}
            header="点击卡片应用样式（画布为描边+阴影近似）"
            onSelect={(item) => {
              recordHistory?.();
              const patch = flourishAppearancePatch(item.preset, fontFaces, v.fontFamily);
              onFlourishApply(item.preset, patch);
            }}
            dropdownProps={{ getPopupContainer: () => document.body }}
          >
            {flourishTrigger}
          </CardGridDropdown>
        </div>
      ) : null}
      <div>
        <Text type="secondary">字体</Text>
        <Select
          style={{ width: '100%', marginTop: 6 }}
          showSearch
          value={v.fontFamily}
          options={fontSelectOptions}
          filterOption={(input, option) =>
            String(option?.value ?? '')
              .toLowerCase()
              .includes(input.trim().toLowerCase())
          }
          labelRender={({ value }) => {
            const fam = String(value ?? '');
            const text = fontOptions.find((o) => o.value === fam)?.label ?? fam;
            return (
              <span
                title={text}
                style={{
                  fontFamily: cssFontFamilyForPreview(fam),
                  fontSize: 15,
                  lineHeight: 1.4,
                  color: 'rgba(255,255,255,0.92)',
                }}
              >
                {text}
              </span>
            );
          }}
          onChange={(fontFamily) => {
            recordHistory?.();
            const ps = defaultPostScriptForFamily(fontFaces, fontFamily);
            onPatch({ fontFamily, fontPostScriptName: ps });
          }}
        />
      </div>
      <div>
        <Text type="secondary">样式</Text>
        <Dropdown menu={variantMenu} trigger={['click']} placement="bottomLeft" disabled={variants.length === 0}>
          <Button
            size="small"
            block
            disabled={variants.length === 0}
            style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
          >
            <span
              style={{
                fontFamily: v.fontFamily,
                ...(() => {
                  const face = variants.find((f) => f.postScriptName === v.fontPostScriptName) ?? variants[0];
                  if (!face) return {};
                  return {
                    fontWeight: weightKeywordToNumeric(face.weight),
                    fontStyle: face.style === 'italic' || face.style === 'oblique' ? 'italic' : 'normal',
                  };
                })(),
              }}
            >
              {currentVariantLabel}
            </span>
            <DownOutlined style={{ fontSize: 11, opacity: 0.65 }} />
          </Button>
        </Dropdown>
      </div>
      <div>
        <Text type="secondary" style={{ display: 'block', marginBottom: 6 }}>
          字号
        </Text>
        <InputNumber
          min={8}
          max={200}
          value={v.fontSize}
          size="small"
          style={{ width: '100%' }}
          {...bindNumberField(`${fieldKeyPrefix}-fs`, (x) => onPatch({ fontSize: Number(x) || 16 }))}
        />
        <Flex gap={8} style={{ marginTop: 8 }} align="center">
          <Button
            size="small"
            type={boldOn ? 'primary' : 'default'}
            icon={<BoldOutlined />}
            disabled={variants.length === 0}
            onClick={() => {
              recordHistory?.();
              const ps = toggleAppearanceBold(fontFaces, v.fontFamily, v.fontPostScriptName);
              onPatch({ fontPostScriptName: ps });
            }}
            title="粗体（按字体族内字面切换，与「样式」一致）"
          />
          <Button
            size="small"
            type={italicOn ? 'primary' : 'default'}
            icon={<ItalicOutlined />}
            disabled={variants.length === 0}
            onClick={() => {
              recordHistory?.();
              const ps = toggleAppearanceItalic(fontFaces, v.fontFamily, v.fontPostScriptName);
              onPatch({ fontPostScriptName: ps });
            }}
            title="斜体（按字体族内字面切换）"
          />
        </Flex>
        <label className='form-item form-item-horizontal-not-scale'>
          <Switch
            style={{ marginTop: 10 }}
            checked={v.fontSizeTracksBox}
            onChange={(checked) => {
              recordHistory?.();
              onPatch({ fontSizeTracksBox: checked });
            }}
          />
          <Text type="secondary">文字大小跟随文本框伸缩</Text>
        </label>

      </div>
      <div className='form-item form-item-horizontal'>
        <Text type="secondary">颜色</Text>
        <ColorPicker
          value={v.fill}
          onChangeComplete={(c) => {
            recordHistory?.();
            onPatch({ fill: c.toCssString() });
          }}
          showText
          format="rgb"
          getPopupContainer={(n) => n.parentElement ?? document.body}
        />
      </div>
      <div>
        <Checkbox
          checked={v.outlineEnabled}
          onChange={(e) => {
            recordHistory?.();
            onPatch({ outlineEnabled: e.target.checked });
          }}
        >
          <Text type="secondary">外框</Text>
        </Checkbox>
        {v.outlineEnabled ? (
          <Flex gap={10} style={{ marginTop: 10 }} align="center" wrap="wrap">
            <ColorPicker
              value={v.outlineColor}
              onChangeComplete={(c) => {
                recordHistory?.();
                onPatch({ outlineColor: c.toCssString() });
              }}
              showText
              format="rgb"
              size="small"
              getPopupContainer={(n) => n.parentElement ?? document.body}
            />
            {ptInput(
              'outline-w',
              v.outlineWidthPt,
              (n) => onPatch({ outlineWidthPt: n }),
              0.5,
              24
            )}
          </Flex>
        ) : null}
      </div>
      <div>
        <Checkbox
          checked={v.textShadowEnabled}
          onChange={(e) => {
            recordHistory?.();
            onPatch({ textShadowEnabled: e.target.checked });
          }}
        >
          <Text type="secondary">投影</Text>
        </Checkbox>
        {v.textShadowEnabled ? (
          <div style={{ marginTop: 10 }}>
            <DropShadowProjectionPanel
              offsetX={v.textShadowOffsetX}
              offsetY={v.textShadowOffsetY}
              blur={v.textShadowBlurPt}
              spread={v.textShadowSpreadPt}
              color={v.textShadowColor}
              maxOffset={200}
              maxBlur={80}
              maxSpread={40}
              onOffsetChange={(x, y) => onPatch({ textShadowOffsetX: x, textShadowOffsetY: y })}
              onOffsetInteractionStart={() => recordHistory?.()}
              onBlurChange={(n) => onPatch({ textShadowBlurPt: n })}
              onSpreadChange={(n) => onPatch({ textShadowSpreadPt: n })}
              onColorChange={(css) => onPatch({ textShadowColor: css })}
              onColorPickComplete={() => recordHistory?.()}
              bindSlider={bindSlider}
              bindNumberField={bindNumberField}
              fieldKeyPrefix={`${fieldKeyPrefix}-tsh`}
              unitSuffix="点"
              opacity={v.textShadowOpacity}
              onOpacityChange={(textShadowOpacity) => onPatch({ textShadowOpacity })}
              showOpacity
            />
          </div>
        ) : null}
      </div>
      <div>
        <div className="form-item form-item-horizontal">
          <Text type="secondary">字符间距</Text>
          <Slider
            min={-50}
            max={200}
            step={1}
            value={v.letterSpacingPercent}
            {...bindSlider(`${fieldKeyPrefix}-lsp`, (letterSpacingPercent) => onPatch({ letterSpacingPercent }))}
          />
        </div>
        {/* <Text type="secondary" style={{ fontSize: 11, display: 'block', marginTop: 6 }}>
          相对字号 {v.letterSpacingPercent}%
        </Text> */}
      </div>
      <div className="form-item form-item-horizontal">
        <Text type="secondary">透明度</Text>
        <Slider min={0} max={1} step={0.05} value={v.opacity} {...bindSlider(`${fieldKeyPrefix}-op`, (opacity) => onPatch({ opacity }))} />
      </div>
      <div className="form-item form-item-horizontal">
        <Text type="secondary">模糊</Text>
        <Slider min={0} max={20} value={v.blurRadius} {...bindSlider(`${fieldKeyPrefix}-blur`, (blurRadius) => onPatch({ blurRadius }))} />
      </div>
    </Space>
  );
};
