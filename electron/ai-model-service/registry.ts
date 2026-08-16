/**
 * AI 模型服务 - 模型注册与调度
 */
import type { MattingAdapter, MattingInput, MattingResult } from './types';
import { mvanetAdapter } from './adapters/mvanet';
import { birefnetAdapter } from './adapters/birefnet';
import { rvmAdapter } from './adapters/rvm';
import { u2netpAdapter } from './adapters/u2netp';
import { rmbg2Adapter } from './adapters/rmbg2';
import { backgroundRemovalAdapter } from './adapters/backgroundRemoval';

const MATTING_TAG = '抠图';

/** 已注册的抠图适配器，key 为模型 id */
const mattingAdapters = new Map<string, MattingAdapter>();

function registerAdapter(adapter: MattingAdapter): void {
  if (adapter.tag !== MATTING_TAG) return;
  mattingAdapters.set(adapter.id, adapter);
}

// 注册 MVANet、BiRefNet、RVM、U2NetP、RMBG-2、Background Removal
registerAdapter(mvanetAdapter);
registerAdapter(birefnetAdapter);
registerAdapter(rvmAdapter);
registerAdapter(u2netpAdapter);
registerAdapter(rmbg2Adapter);
// registerAdapter(backgroundRemovalAdapter);

/** 按 id 获取抠图适配器 */
export function getMattingAdapter(id: string): MattingAdapter | null {
  return mattingAdapters.get(id) ?? null;
}

/** 执行抠图，返回 RGBA Buffer 或抛出/返回错误 */
export async function runMatting(
  modelId: string,
  input: MattingInput
): Promise<MattingResult> {
  const adapter = getMattingAdapter(modelId);
  if (!adapter) {
    return {
      ok: false,
      code: 'MODEL_NOT_FOUND',
      message: `未找到抠图模型: ${modelId}`,
    };
  }
  return adapter.run(input);
}

/** 列出已注册的抠图模型 */
export function listMattingModels(): { id: string; name: string }[] {
  return Array.from(mattingAdapters.values()).map((a) => ({ id: a.id, name: a.name }));
}
