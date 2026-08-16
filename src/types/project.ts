/** 蘑菇鸭 - 历史图片项目类型（与 preload imageProjects.list 返回对齐） */
export interface ImageProjectItem {
  id: string;
  name: string;
  project_dir: string;
  cover_path: string | null;
  doc_width: number;
  doc_height: number;
  created_at: string;
  updated_at: string;
}
