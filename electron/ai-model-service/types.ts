/**
 * AI 模型服务 - 统一类型定义
 * tag: 抠图
 */

/** 抠图输入 */
export interface MattingInput {
  /** RGB/RGBA 原始数据 */
  rgbData: Buffer;
  width: number;
  height: number;
  channels: number;
  /** 模型特定参数 */
  options?: Record<string, unknown>;
}

/** 抠图输出：原图尺寸的 RGBA Buffer */
export interface MattingOutput {
  ok: true;
  rgba: Buffer;
}

/** 抠图失败 */
export interface MattingError {
  ok: false;
  code: string;
  message: string;
  /** 可选：原始错误，便于开发调试 */
  detail?: string;
}

export type MattingResult = MattingOutput | MattingError;

/** 抠图适配器接口 */
export interface MattingAdapter {
  /** 模型唯一 ID，用于 registry 查找 */
  readonly id: string;
  /** 显示名称 */
  readonly name: string;
  /** 功能标签，如 "抠图" */
  readonly tag: string;
  /** 执行抠图 */
  run(input: MattingInput): Promise<MattingResult>;
}

/** 错误码 */
export const MattingErrorCode = {
  MODEL_NOT_FOUND: 'MODEL_NOT_FOUND',
  INVALID_INPUT: 'INVALID_INPUT',
  INFERENCE_FAILED: 'INFERENCE_FAILED',
  TIMEOUT: 'TIMEOUT',
  UNKNOWN: 'UNKNOWN',
} as const;

export function mattingError(code: string, message: string, detail?: string): MattingError {
  return { ok: false, code, message, detail };
}
