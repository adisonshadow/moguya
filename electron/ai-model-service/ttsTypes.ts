/**
 * AI 模型服务 - 本地 TTS 类型定义
 */

/** TTS 合成输入 */
export interface TtsInput {
  /** 待合成的文本 */
  text: string;
  /** 模型特定参数（语速、音色等） */
  options?: Record<string, unknown>;
}

/** TTS 合成输出 */
export interface TtsOutput {
  ok: true;
  /** 音频 Buffer（WAV 格式） */
  audio: Buffer;
  /** 音频格式 */
  format: 'wav' | 'mp3';
}

/** TTS 失败 */
export interface TtsError {
  ok: false;
  code: string;
  message: string;
  detail?: string;
}

export type TtsResult = TtsOutput | TtsError;

/** TTS 适配器接口 */
export interface TtsAdapter {
  /** 模型唯一 ID */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;
  /** 功能标签 */
  readonly tag: string;
  /** 模型本地路径 */
  readonly modelPath: string;
  /** 执行 TTS 合成 */
  run(input: TtsInput): Promise<TtsResult>;
  /** 健康检查：模型是否就绪 */
  healthCheck(): Promise<{ ok: boolean; message?: string }>;
}

/** TTS 错误码 */
export const TtsErrorCode = {
  MODEL_NOT_FOUND: 'TTS_MODEL_NOT_FOUND',
  PYTHON_NOT_FOUND: 'TTS_PYTHON_NOT_FOUND',
  INFERENCE_FAILED: 'TTS_INFERENCE_FAILED',
  TIMEOUT: 'TTS_TIMEOUT',
  INVALID_TEXT: 'TTS_INVALID_TEXT',
  UNKNOWN: 'TTS_UNKNOWN',
} as const;

export function ttsError(code: string, message: string, detail?: string): TtsError {
  return { ok: false, code, message, detail };
}
