/**
 * 抠图方式下拉：即时、具备 matting 的模型、内置 ONNX（见功能文档 3.1.5）
 */
import type { AIModelConfig } from '@/types/settings';
import { resolveRequestModelId } from '@/utils/aiModelRequestId';

export function buildMergedMattingOptions(models?: AIModelConfig[]): { value: string; label: string }[] {
  const options: { value: string; label: string }[] = [{ value: 'instant', label: '即时抠图' }];
  const matModels = (models ?? []).filter((m) => (m.capabilityKeys ?? []).includes('matting'));
  for (const m of matModels) {
    const labelBase = m.name?.trim() || resolveRequestModelId(m) || m.id;
    options.push({
      value: m.id,
      label: `${labelBase}${m.isLocal ? '（本地）' : ''}（模型抠图）`,
    });
  }
  options.push({ value: 'birefnet', label: 'BiRefNet（内置）' });
  options.push({ value: 'rmbg2', label: 'RMBG-2（内置）' });
  // options.push({ value: 'background-removal', label: 'Background Removal（内置）' });
  return options;
}
