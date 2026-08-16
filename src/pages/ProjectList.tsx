/**
 * 蘑菇鸭 - 历史项目列表页（新增功能）
 * 布局参考芝绘 ProjectList：工具栏 + 卡片网格 + 新建/打开/删除/重命名。
 * 打开项目：把 id 写入 sessionStorage，跳转到 /image-editor，编辑器挂载时读取并加载。
 * 支持拖拽图片到列表页：按文件名建项目、画布尺寸取图片尺寸，并写入首层图片后打开。
 */
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { App, Layout, Row, Col, Input, Button, Space, Empty, Modal, Form, Select, Typography } from 'antd';
import {
  PlusOutlined,
  ReloadOutlined,
} from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import type { ImageProjectItem } from '@/types/project';
import { ProjectCard } from '@/components/ProjectCard';
import { loadImageSize } from '@/utils/loadImageSize';
import { editorImageFillDocument, IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND } from '@/components/imageEditor/editorTypes';

const { Header, Content } = Layout;
const { Search } = Input;
const { Title } = Typography;

type SortBy = 'updated_at' | 'created_at' | 'name';

/** 新建空白项目默认画布尺寸预设 */
const CANVAS_PRESETS = [
  { label: '1024 × 768（4:3 横屏）', width: 1024, height: 768 },
  { label: '1920 × 1080（16:9 横屏）', width: 1920, height: 1080 },
  { label: '1080 × 1080（1:1 方形）', width: 1080, height: 1080 },
  { label: '1080 × 1920（9:16 竖屏）', width: 1080, height: 1920 },
  { label: '800 × 1200（竖版）', width: 800, height: 1200 },
];

const IMAGE_FILE_RE = /\.(png|jpe?g|gif|webp|bmp)$/i;

function stemFromFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? name;
  const stem = base.replace(/\.[^.]+$/, '').trim();
  return stem || '未命名项目';
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('读取文件失败'));
    reader.readAsDataURL(file);
  });
}

/** 封面统一存 PNG（saveCover 写 cover.png） */
async function dataUrlToPngDataUrl(src: string): Promise<string> {
  if (/^data:image\/png;base64,/i.test(src)) return src;
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, img.naturalWidth);
      canvas.height = Math.max(1, img.naturalHeight);
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('无法创建画布'));
        return;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL('image/png'));
    };
    img.onerror = () => reject(new Error('封面转码失败'));
    img.src = src;
  });
}

const ProjectList: React.FC = () => {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const [projects, setProjects] = useState<ImageProjectItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [sortBy, setSortBy] = useState<SortBy>('updated_at');
  const [createOpen, setCreateOpen] = useState(false);
  const [renameTarget, setRenameTarget] = useState<{ id: string; name: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importing, setImporting] = useState(false);
  const dragDepthRef = useRef(0);
  const [form] = Form.useForm<{ name: string; preset: number; bg: string }>();
  const [renameForm] = Form.useForm<{ name: string }>();

  const loadProjects = useCallback(async () => {
    if (!window.yiman?.imageProjects) return;
    setLoading(true);
    try {
      const list = await window.yiman.imageProjects.list();
      setProjects(list as ImageProjectItem[]);
    } catch (e) {
      message.error('加载项目失败');
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [message]);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

  const filtered = [...projects]
    .filter((p) => p.name.toLowerCase().includes(searchText.toLowerCase()))
    .sort((a, b) => {
      if (sortBy === 'name') return a.name.localeCompare(b.name, 'zh');
      return b[sortBy].localeCompare(a[sortBy]);
    });

  const handleOpen = useCallback((id: string) => {
    sessionStorage.setItem('mogoyya:openProjectId', id);
    sessionStorage.removeItem('mogoyya:newProjectSpec');
    navigate('/image-editor', { state: { openProjectId: id } });
  }, [navigate]);

  const handleCreate = async () => {
    const v = await form.validateFields().catch(() => null);
    if (!v) return;
    const preset = CANVAS_PRESETS[v.preset] ?? CANVAS_PRESETS[0]!;
    const res = await window.yiman?.imageProjects.create({
      name: v.name.trim() || '未命名项目',
      docWidth: preset.width,
      docHeight: preset.height,
      docBackgroundColor: v.bg,
    });
    if (res?.ok && res.id) {
      message.success('已创建');
      setCreateOpen(false);
      form.resetFields();
      handleOpen(res.id);
    } else {
      message.error(res?.error ?? '创建失败');
    }
  };

  const createProjectFromImageFile = useCallback(
    async (file: File): Promise<string | null> => {
      const api = window.yiman?.imageProjects;
      if (!api) {
        message.error('桌面端接口不可用');
        return null;
      }
      const dataUrl = await readFileAsDataUrl(file);
      if (!dataUrl.startsWith('data:image/')) {
        message.error(`无法读取图片：${file.name}`);
        return null;
      }
      const { w, h } = await loadImageSize(dataUrl);
      const name = stemFromFileName(file.name);
      const createRes = await api.create({
        name,
        docWidth: w,
        docHeight: h,
        docBackgroundColor: IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND,
      });
      if (!createRes?.ok || !createRes.id) {
        message.error(createRes?.error ?? `创建「${name}」失败`);
        return null;
      }
      const layer = editorImageFillDocument(dataUrl, w, h);
      const saveRes = await api.saveDoc({
        id: createRes.id,
        name,
        docWidth: w,
        docHeight: h,
        docBackgroundColor: IMAGE_EDITOR_DEFAULT_DOC_BACKGROUND,
        objects: [layer],
      });
      if (!saveRes?.ok) {
        message.error(saveRes?.error ?? `保存「${name}」失败`);
        return createRes.id;
      }
      try {
        const png = await dataUrlToPngDataUrl(dataUrl);
        await api.saveCover(createRes.id, png);
      } catch {
        /* 封面失败不影响打开 */
      }
      return createRes.id;
    },
    [message],
  );

  const handleDropImageFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter(
        (f) => f.type.startsWith('image/') || IMAGE_FILE_RE.test(f.name),
      );
      if (!list.length) {
        message.warning('请拖入图片文件（PNG / JPG / WebP 等）');
        return;
      }
      setImporting(true);
      try {
        const ids: string[] = [];
        for (const file of list) {
          try {
            const id = await createProjectFromImageFile(file);
            if (id) ids.push(id);
          } catch (e) {
            console.error('[ProjectList] create from image', file.name, e);
            message.error(`导入「${file.name}」失败`);
          }
        }
        if (!ids.length) return;
        await loadProjects();
        if (ids.length === 1) {
          message.success('已根据图片创建项目');
          handleOpen(ids[0]!);
        } else {
          message.success(`已创建 ${ids.length} 个项目`);
          handleOpen(ids[0]!);
        }
      } finally {
        setImporting(false);
      }
    },
    [createProjectFromImageFile, handleOpen, loadProjects, message],
  );

  const onDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current += 1;
    if (e.dataTransfer.types.includes('Files')) setDragOver(true);
  };

  const onDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragOver(false);
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragDepthRef.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      void handleDropImageFiles(e.dataTransfer.files);
    }
  };

  const handleDelete = (p: ImageProjectItem) => {
    modal.confirm({
      title: `删除项目「${p.name}」？`,
      content: '将同时删除磁盘上的文档与素材，不可恢复。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        const res = await window.yiman?.imageProjects.delete(p.id);
        if (res?.ok) {
          message.success('已删除');
          loadProjects();
        } else {
          message.error(res?.error ?? '删除失败');
        }
      },
    });
  };

  const handleRenameSubmit = async () => {
    if (!renameTarget) return;
    const v = await renameForm.validateFields().catch(() => null);
    if (!v) return;
    const res = await window.yiman?.imageProjects.rename(renameTarget.id, v.name.trim());
    if (res?.ok) {
      message.success('已重命名');
      setRenameTarget(null);
      loadProjects();
    } else {
      message.error(res?.error ?? '重命名失败');
    }
  };

  return (
    <Layout
      style={{ minHeight: '100vh', position: 'relative' }}
      onDragEnter={onDragEnter}
      onDragLeave={onDragLeave}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <Header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 24px',
          background: '#1f1f1f',
          borderBottom: '1px solid #303030',
        }}
      >
        <Space size="middle">
          <img
            src="./images/logo.png"
            alt="蘑菇鸭"
            width={36}
            height={36}
            style={{ display: 'block', borderRadius: 6, objectFit: 'cover' }}
          />
          <Title level={4} style={{ margin: 0, color: '#fff' }}>
            蘑菇鸭
          </Title>
        </Space>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={loadProjects} loading={loading || importing}>
            刷新
          </Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
            新建项目
          </Button>
        </Space>
      </Header>

      <Content style={{ padding: '24px' }}>
        <Row gutter={[0, 16]} style={{ marginBottom: 16 }}>
          <Col flex="auto">
            <Search
              placeholder="搜索项目名称"
              allowClear
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              style={{ maxWidth: 320 }}
            />
          </Col>
          <Col>
            <Select
              value={sortBy}
              onChange={setSortBy}
              style={{ width: 160 }}
              options={[
                { value: 'updated_at', label: '按最近修改' },
                { value: 'created_at', label: '按创建时间' },
                { value: 'name', label: '按名称' },
              ]}
            />
          </Col>
        </Row>

        {filtered.length === 0 ? (
          <Empty
            description={
              searchText
                ? '没有匹配的项目'
                : '还没有项目，点击「新建项目」或把图片拖进本页'
            }
            style={{ marginTop: 80 }}
          >
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreateOpen(true)}>
              新建项目
            </Button>
          </Empty>
        ) : (
          <Row gutter={[16, 16]}>
            {filtered.map((p) => (
              <Col key={p.id} xs={24} sm={12} md={8} lg={6} xl={4}>
                <ProjectCard
                  project={p}
                  onOpen={() => handleOpen(p.id)}
                  onDelete={() => handleDelete(p)}
                  onRename={() => {
                    setRenameTarget({ id: p.id, name: p.name });
                    renameForm.setFieldsValue({ name: p.name });
                  }}
                />
              </Col>
            ))}
          </Row>
        )}
      </Content>

      {dragOver || importing ? (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 1000,
            background: dragOver ? 'rgba(28, 100, 180, 0.28)' : 'rgba(0,0,0,0.45)',
            border: dragOver ? '2px dashed #69b1ff' : 'none',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            pointerEvents: importing ? 'all' : 'none',
            color: '#fff',
            fontSize: 18,
            fontWeight: 600,
          }}
        >
          {importing ? '正在根据图片创建项目…' : '松开以创建项目（文件名 → 项目名，尺寸 → 画布）'}
        </div>
      ) : null}

      <Modal
        title="新建项目"
        open={createOpen}
        onOk={handleCreate}
        onCancel={() => {
          setCreateOpen(false);
          form.resetFields();
        }}
        okText="创建并打开"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={form} layout="vertical" initialValues={{ name: '', preset: 0, bg: '#ffffff' }}>
          <Form.Item name="name" label="项目名称">
            <Input placeholder="未命名项目" autoFocus />
          </Form.Item>
          <Form.Item name="preset" label="画布尺寸">
            <Select
              options={CANVAS_PRESETS.map((p, i) => ({ value: i, label: p.label }))}
            />
          </Form.Item>
          <Form.Item name="bg" label="画布背景色">
            <input type="color" style={{ width: 48, height: 32, padding: 0, border: 'none', background: 'transparent' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="重命名项目"
        open={!!renameTarget}
        onOk={handleRenameSubmit}
        onCancel={() => setRenameTarget(null)}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={renameForm} layout="vertical">
          <Form.Item name="name" label="项目名称" rules={[{ required: true, message: '请输入名称' }]}>
            <Input autoFocus />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
};

export default ProjectList;
