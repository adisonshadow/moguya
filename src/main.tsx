/**
 * 芝绘 - 渲染进程入口（见技术文档 2、开发计划 2.1）
 * Ant Design 仅 dark 主题，参考 Biezhi2/web/main.tsx
 */
import React, { Component, ErrorInfo } from 'react';
import ReactDOM from 'react-dom/client';
import { App as AntdApp, ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import App from './App';
import './index.css';

/** 开发时捕获渲染错误，避免白屏无提示 */
class ErrorBoundary extends Component<{ children: React.ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 24, color: '#fff', fontFamily: 'monospace', whiteSpace: 'pre-wrap' }}>
          <h2>渲染错误</h2>
          <pre>{this.state.error.message}</pre>
          <pre>{this.state.error.stack}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

const customTheme = {
  "components": {
      "Steps": {
        "colorPrimary": "rgb(255,255,255)",
        "colorTextLightSolid": "rgb(21,50,91)"
      },
      "Select": {
        "optionSelectedBg": "rgba(255,255,255,0.1)"
      },
      "Slider": {
        "handleColor": "rgb(140,140,140)",
        "trackBg": "rgb(113,113,113)",
        "trackHoverBg": "rgb(156,204,255)",
        "colorPrimaryBorderHover": "rgb(156,204,255)",
        "colorBgElevated": "rgb(45,45,45)"
      },
      "Switch": {
        "colorPrimary": "rgb(69, 157, 251)"
      },
      "Collapse": {
        "colorBorder": "rgba(131,131,131,0.15)",
        "colorPrimaryBorder": "rgba(131,131,131,0.15)"
      },
      "Segmented": {
        "itemActiveBg": "rgba(216,232,255,0.3)"
      },
      "Tabs": {
        "itemSelectedColor": "rgb(255,255,255)",
        "itemColor": "rgb(151,151,151)",
        "cardBg": "rgba(0,0,0,0)", // tab item 选中 的背景色
        "colorBgContainer": "#171717", // tab item 选中 的背景色
        "inkBarColor": "rgb(207,227,255)",
        "colorBorderSecondary": "rgba(250,219,20,0)",
      },
      "Tooltip": {
        "colorBgSpotlight": "rgb(65,65,65)"
      },
      "Modal": {
        "colorText": "rgba(179,179,179,0.85)"
      },
      "Button": {
        "defaultHoverBorderColor": "rgb(255,255,255)",
        "defaultHoverColor": "rgb(233,243,255)",
        "defaultActiveBorderColor": "rgb(182,182,182)",
        "defaultActiveColor": "rgb(181,209,255)",
        "colorPrimary": "rgb(49,51,54)",
        "colorPrimaryBgHover": "rgb(43,43,43)",
        "colorPrimaryActive": "rgb(65,80,102)",
        "colorPrimaryHover": "rgb(78,85,94)",
        "primaryShadow": "0 2px 0 rgba(0,0,0,0.3)",
        "colorBgContainer": "rgba(255,255,255,0)"
      },
      "Menu": {
        "colorBgContainer": "transparent",
        "itemSelectedBg": "rgba(255,255,255,0.12)",
        "itemSelectedColor": "rgb(177,209,255)",
        "itemHoverBg": "rgba(255,255,255,0.05)",
        "subMenuItemSelectedColor": "rgb(177,209,255)",
        "itemHeight": 34
      },
      "Pagination": {
        "itemActiveColor": "rgba(255,255,255,0.99)",
        "colorPrimary": "rgb(185,214,253)"
      },
      "Input": {
        "activeBorderColor": "rgb(22,119,255)",
        "hoverBorderColor": "rgba(170,208,255,0.76)"
      },
      "Radio": {
        "buttonSolidCheckedActiveBg": "rgb(126,126,126)",
        "buttonSolidCheckedBg": "rgb(80,80,80)",
        "buttonSolidCheckedHoverBg": "rgb(77,82,88)",
        "colorPrimary": "rgb(222,222,222)",
        "colorPrimaryActive": "rgb(143,143,143)",
        "colorPrimaryHover": "rgb(158,169,182)"
      }
    },
    "token": {
      "colorInfo": "#f1f7ff"
    },
};

const root = document.getElementById('root');
if (!root) {
  document.body.innerHTML = '<div style="padding:24px;color:red">#root 未找到</div>';
} else {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <ErrorBoundary>
        <ConfigProvider
          locale={zhCN}
          theme={{
            algorithm: theme.darkAlgorithm,
            ...customTheme,
          }}
        >
          <AntdApp>
            <App />
          </AntdApp>
        </ConfigProvider>
      </ErrorBoundary>
    </React.StrictMode>
  );
}
