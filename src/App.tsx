/**
 * 蘑菇鸭 - 根组件（新增，精简自芝绘 App.tsx）
 * 仅两条路由：/（历史项目列表）与 /image-editor（图片编辑器）。
 * 打包后用 loadFile(file://...) 打开，BrowserRouter 会把绝对路径当成 location，
 * 因此使用 HashRouter（#/...）以兼容 Electron 生产环境。
 */
import { HashRouter, Routes, Route } from 'react-router-dom';
import { Layout } from 'antd';
import { ConfigProvider } from './contexts/ConfigContext';
import ProjectList from './pages/ProjectList';
import { ImageEditorPage } from './components/imageEditor/ImageEditorPage';

const { Content } = Layout;

function App() {
  return (
    <HashRouter>
      <ConfigProvider>
        <Layout style={{ minHeight: '100vh', background: '#141414' }}>
          <Routes>
            <Route
              path="/"
              element={
                <Content style={{ padding: 0 }}>
                  <ProjectList />
                </Content>
              }
            />
            <Route
              path="/image-editor"
              element={
                <Content style={{ padding: 0 }}>
                  <ImageEditorPage />
                </Content>
              }
            />
          </Routes>
        </Layout>
      </ConfigProvider>
    </HashRouter>
  );
}

export default App;
