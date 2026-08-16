/**
 * 蘑菇鸭 - 历史项目卡片（新增功能）
 * 封面：cover.png 存在项目目录下，通过 fs.readFileAsDataUrl 读取为 data URL。
 */
import React, { useEffect, useState } from 'react';
import { Card, Dropdown, Typography, App } from 'antd';
import { FolderOpenOutlined, DeleteOutlined, MoreOutlined, EditOutlined, PictureOutlined } from '@ant-design/icons';
import type { ImageProjectItem } from '@/types/project';

const { Text } = Typography;

interface Props {
  project: ImageProjectItem;
  onOpen: () => void;
  onDelete: () => void;
  onRename: () => void;
}

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  } catch {
    return '';
  }
}

const ProjectCard: React.FC<Props> = ({ project, onOpen, onDelete, onRename }) => {
  const [coverUrl, setCoverUrl] = useState<string | null>(null);
  const { message } = App.useApp();

  useEffect(() => {
    let cancelled = false;
    const loadCover = async () => {
      if (!project.cover_path || !window.yiman?.fs?.pathJoin || !window.yiman?.fs?.readFileAsDataUrl) {
        return;
      }
      try {
        const full = await window.yiman.fs.pathJoin(project.project_dir, project.cover_path);
        const exists = await window.yiman.fs.pathExists(full);
        if (!exists) return;
        const url = await window.yiman.fs.readFileAsDataUrl(full);
        if (!cancelled && url) setCoverUrl(url);
      } catch {
        /* 无封面用占位 */
      }
    };
    loadCover();
    return () => {
      cancelled = true;
    };
  }, [project.project_dir, project.cover_path]);

  return (
    <Card
      hoverable
      cover={
        <div
          onClick={onOpen}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '4 / 3',
            background: '#2a2a2a',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            cursor: 'pointer',
            backgroundImage: coverUrl
              ? `url(${coverUrl})`
              : undefined,
            backgroundSize: 'cover',
            backgroundPosition: 'center',
          }}
        >
          {!coverUrl && <PictureOutlined style={{ fontSize: 40, color: '#555' }} />}
        </div>
      }
      actions={[
        <FolderOpenOutlined key="open" onClick={onOpen} title="打开" />,
        <EditOutlined key="rename" onClick={onRename} title="重命名" />,
        <Dropdown
          key="more"
          menu={{
            items: [
              { key: 'rename', label: '重命名', icon: <EditOutlined /> },
              { key: 'delete', label: '删除', icon: <DeleteOutlined />, danger: true },
            ],
            onClick: ({ key }) => (key === 'delete' ? onDelete() : onRename()),
          }}
          trigger={['click']}
        >
          <MoreOutlined />
        </Dropdown>,
      ]}
      bodyStyle={{ padding: '10px 12px' }}
    >
      <Text
        strong
        ellipsis={{ tooltip: project.name }}
        style={{ display: 'block', color: '#fff' }}
      >
        {project.name}
      </Text>
      <Text type="secondary" style={{ fontSize: 12 }}>
        {project.doc_width} × {project.doc_height} · {formatTime(project.updated_at)}
      </Text>
    </Card>
  );
};

export { ProjectCard };
