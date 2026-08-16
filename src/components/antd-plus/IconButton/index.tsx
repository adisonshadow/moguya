import React from 'react';
import { Button, Tooltip } from 'antd';
import type { ButtonProps } from 'antd/es/button';
import type { TooltipProps } from 'antd/es/tooltip';
import classNames from 'classnames';

export interface IconButtonProps extends Omit<ButtonProps, 'icon'> {
  /** 图标 */
  icon?: React.ReactNode;
  /** 图标尺寸，默认 antd 图标偏小，可设为 16、18、20 等 */
  iconSize?: number | string;
  /** 启用/选中状态，为 true 时应用 enabledClasses 和 enabledStyle */
  enabled?: boolean;
  /** 启用状态时的 className */
  enabledClasses?: string;
  /** 启用状态时的内联样式 */
  enabledStyle?: React.CSSProperties;
  /** 内置 tooltip，传字符串或 Tooltip 配置对象，无需单独包裹 Tooltip */
  tooltip?: React.ReactNode | TooltipProps;
}

const IconButton: React.FC<IconButtonProps> = ({
  icon,
  iconSize = 16,
  enabled = false,
  enabledClasses,
  enabledStyle,
  tooltip,
  className,
  style,
  type = 'text',
  children,
  ...restProps
}) => {
  const iconElement =
    icon &&
    (React.isValidElement(icon) ? (
      React.cloneElement(icon as React.ReactElement<{ style?: React.CSSProperties }>, {
        style: {
          ...(typeof (icon as React.ReactElement).props?.style === 'object'
            ? (icon as React.ReactElement).props.style
            : {}),
          fontSize: iconSize,
        },
      })
    ) : (
      <span style={{ fontSize: iconSize, display: 'inline-flex', lineHeight: 1 }}>
        {icon}
      </span>
    ));

  const mergedClassName = classNames(
    'antd-plus-icon-button',
    className,
    enabled && enabledClasses
  );

  const mergedStyle: React.CSSProperties = {
    padding: 4,
    ...style,
    ...(enabled && enabledStyle),
  };

  const button = (
    <Button
      type={type}
      className={mergedClassName}
      style={mergedStyle}
      icon={icon ? iconElement : undefined}
      {...restProps}
    >
      {children}
    </Button>
  );

  if (tooltip !== undefined && tooltip !== null && tooltip !== '') {
    const tooltipProps =
      typeof tooltip === 'object' && !React.isValidElement(tooltip)
        ? (tooltip as TooltipProps)
        : { title: tooltip };
    return <Tooltip {...tooltipProps}>{button}</Tooltip>;
  }

  return button;
};

export { IconButton };
