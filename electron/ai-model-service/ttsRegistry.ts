/**
 * AI 模型服务 - 本地 TTS 模型注册与调度
 */
import type { TtsAdapter, TtsInput, TtsResult } from './ttsTypes';
import { LongCatAudioDiTAdapter } from './adapters/longcatAudioDit';

const TTS_TAG = '本地TTS';

/** 已注册的 TTS 适配器，key 为模型 id */
const ttsAdapters = new Map<string, TtsAdapter>();

function registerAdapter(adapter: TtsAdapter): void {
  if (adapter.tag !== TTS_TAG) return;
  ttsAdapters.set(adapter.id, adapter);
}

/**
 * 注册本地 TTS 适配器
 * 由主进程在读取配置后调用
 */
export function registerTtsAdapter(adapter: TtsAdapter): void {
  registerAdapter(adapter);
}

/**
 * 根据配置创建并注册 LongCat-AudioDiT 适配器
 */
export function registerLongCatAudioDiT(modelPath: string): TtsAdapter {
  const adapter = new LongCatAudioDiTAdapter(modelPath);
  registerAdapter(adapter);
  return adapter;
}

/** 按 id 获取 TTS 适配器 */
export function getTtsAdapter(id: string): TtsAdapter | null {
  return ttsAdapters.get(id) ?? null;
}

/** 执行 TTS 合成 */
export async function runTts(
  modelId: string,
  input: TtsInput
): Promise<TtsResult> {
  const adapter = getTtsAdapter(modelId);
  if (!adapter) {
    return {
      ok: false,
      code: 'TTS_MODEL_NOT_FOUND',
      message: `未找到本地 TTS 模型: ${modelId}`,
    };
  }
  return adapter.run(input);
}

/** 健康检查 */
export async function healthCheckTts(modelId: string): Promise<{ ok: boolean; message?: string }> {
  const adapter = getTtsAdapter(modelId);
  if (!adapter) {
    return { ok: false, message: `未找到本地 TTS 模型: ${modelId}` };
  }
  return adapter.healthCheck();
}

/** 列出已注册的本地 TTS 模型 */
export function listTtsModels(): { id: string; name: string; modelPath: string }[] {
  return Array.from(ttsAdapters.values()).map((a) => ({
    id: a.id,
    name: a.name,
    modelPath: a.modelPath,
  }));
}
