/**
 * AI 设置存储（精简版，剥离自芝绘 src/utils/settingsStorage.ts）
 * 蘑菇鸭只跑 Electron，直接读写 window.yiman.settings。
 * 已移除 localStorage 降级与 Skill/Connector 迁移逻辑。
 */
import type { AISettings } from '@/types/settings';

/** 是否使用 Electron 存储（有 window.yiman.settings） */
export function hasElectronSettings(): boolean {
  return !!(
    typeof window !== 'undefined' &&
    window.yiman?.settings?.get &&
    window.yiman?.settings?.save
  );
}

/** 获取 AI 设置 */
export async function getAISettings(): Promise<AISettings | null> {
  if (!hasElectronSettings()) return null;
  try {
    const data = await window.yiman!.settings!.get();
    return (data as AISettings) ?? null;
  } catch (e) {
    console.error('[settingsStorage] Electron get 失败', e);
    return null;
  }
}

/** 保存 AI 设置 */
export async function saveAISettings(
  data: AISettings,
): Promise<{ ok: boolean; error?: string }> {
  if (!hasElectronSettings()) return { ok: false, error: 'Electron 不可用' };
  try {
    return await window.yiman!.settings!.save(data);
  } catch (e) {
    console.error('[settingsStorage] Electron save 失败', e);
    return { ok: false, error: String(e) };
  }
}
