/**
 * AI 模型服务 - 统一入口
 */
export { runMatting, getMattingAdapter, listMattingModels } from './registry';
export type { MattingInput, MattingOutput, MattingResult, MattingAdapter } from './types';
export { MattingErrorCode, mattingError } from './types';

// 本地 TTS 导出
export {
  runTts,
  getTtsAdapter,
  listTtsModels,
  healthCheckTts,
  registerTtsAdapter,
  registerLongCatAudioDiT,
} from './ttsRegistry';
export type { TtsInput, TtsOutput, TtsResult, TtsAdapter as TtsAdapterType } from './ttsTypes';
export { TtsErrorCode, ttsError as ttsErrorFn } from './ttsTypes';
