/**
 * AI 模型配置类型（精简版，剥离自芝绘 src/types/settings.ts）
 * 蘑菇鸭仅保留图片编辑器/抠图所需：模型列表 + AI 抠图配置。
 * 已移除 Skill / MCP Connector / 本地 TTS / 有声书等无关类型（它们依赖 AIChat 子树）。
 */

export interface AIModelConfig {
  id: string;
  name?: string;
  provider?: string;
  apiUrl: string;
  apiKey: string;
  /** 已保存的完整 model（兼容旧版）；有 modelDisplayName 时以 resolveRequestModelId 为准 */
  model?: string;
  modelDisplayName?: string;
  /** 易变主版本，如 260328；可单独编辑，请求时与 modelDisplayName 用「-」拼接 */
  primaryVersion?: string;
  /** 能力 tag 的 key 列表，一个模型可拥有多种能力 */
  capabilityKeys: string[];
  /** 常见模型预设 key，自定义模型无此字段 */
  presetKey?: string;
  vendorKey?: string;
  /** 本地部署：可无密钥，请求不带 Authorization */
  isLocal?: boolean;
  minimaxGroupId?: string;
}

/** AI 抠图服务提供商 */
export type AIMattingProvider = 'volcengine';

/** 单条 AI 抠图配置 */
export interface AIMattingConfig {
  id: string;
  name?: string;
  provider: AIMattingProvider;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  enabled?: boolean;
}

export interface CapabilityTag {
  key: string;
  label: string;
}

/** 预设能力 tag（key | label）—— 蘑菇鸭仅用到 matting，但保留完整列表以便设置面板复用 */
export const CAPABILITY_TAGS: CapabilityTag[] = [
  { key: 'matting', label: '抠图' },
  { key: 'draw', label: '绘图' },
  { key: 'image_edit', label: '图像编辑' },
  { key: 'remove_watermark', label: '去水印' },
  { key: 'image_outpaint', label: '扩图' },
  { key: 'image_clarity', label: '图像变清晰' },
  { key: 'extract_image_elements', label: '提取图像元素' },
];

export interface AISettings {
  models: AIModelConfig[];
  /** AI 抠图配置列表（与模型配置分离，因抠图服务非 OpenAI 协议） */
  aiMattingConfigs?: AIMattingConfig[];
  /** 新建项目时本地目录默认父路径（可选） */
  defaultProjectRoot?: string;
  /** 画布视口尺寸变化时自动按画布适配缩放 */
  canvasAutoFitViewport?: boolean;
  /** 弹窗遮罩是否使用模糊效果；默认 true */
  modalMaskBlur?: boolean;
}
