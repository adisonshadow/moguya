import type { AIModelConfig } from '@/types/settings';

/**
 * 将旧版「完整 model 字符串」拆成显示名 + 主版本（末尾 6 位以上数字时按最后一处 `-` 分割）。
 * 见功能文档 3.1：用户配置 DisplayName 与 PrimaryVersion，请求时组合。
 */
export function splitLegacyModelId(legacy: string | undefined): {
  modelDisplayName: string;
  primaryVersion: string;
} {
  const s = (legacy ?? '').trim();
  if (!s) return { modelDisplayName: '', primaryVersion: '' };
  const m = s.match(/^(.*)-(\d{6,})$/);
  if (m) return { modelDisplayName: m[1], primaryVersion: m[2] };
  return { modelDisplayName: s, primaryVersion: '' };
}

/**
 * OpenAI 兼容 /chat、/images 等请求体中的 `model` 字段：优先 `modelDisplayName` + `primaryVersion`，
 * 再回退到旧版 `model` 完整字符串（兼容已保存配置）。
 */
export function resolveRequestModelId(m: AIModelConfig | null | undefined): string | undefined {
  if (!m) return undefined;
  const d = m.modelDisplayName?.trim();
  const v = m.primaryVersion?.trim();
  if (d && v) return `${d}-${v}`;
  if (d) return d;
  const legacy = m.model?.trim();
  if (legacy) return legacy;
  return undefined;
}
