/**
 * 单图抠图服务（蘑菇鸭）：供图片编辑器轮廓/抠图使用
 * 本地模型由 ai-model-service 托管；mattingModel 为配置 id（如 mat_xxx）时走云端
 */
import path from 'node:path';
import fs from 'node:fs';
import sharp from 'sharp';
import { callMattingApi } from '../ai-model-service/client';
import { loadAISettings } from './settings';
import { volcengineMatting } from './volcengineMattingService';
import { mattePngWithOpenAiCompatibleImageEdits } from './openAiImageMattingService';

export type MattingModel = 'rvm' | 'birefnet' | 'mvanet' | 'u2netp' | 'rmbg2'; // 'background-removal'

/**
 * 对单张图片执行抠图，供轮廓网格生成 / 编辑器 standalone 抠图使用
 * 返回 base64 PNG data URL
 */
export async function matteImageForContour(
  projectDir: string,
  relativePath: string,
  options?: { mattingModel?: MattingModel | string; downsampleRatio?: number }
): Promise<{ ok: boolean; dataUrl?: string; error?: string }> {
  try {
    const fullPath = path.join(path.normalize(projectDir), relativePath);
    if (!fs.existsSync(fullPath)) {
      return { ok: false, error: '图片不存在' };
    }
    const image = sharp(fullPath);
    const meta = await image.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w <= 0 || h <= 0) return { ok: false, error: '无法读取图片尺寸' };

    const model: MattingModel | string = options?.mattingModel ?? 'rvm';
    const downsampleRatio = options?.downsampleRatio ?? 0.5;
    const settings = loadAISettings();

    if (typeof model === 'string' && model.startsWith('mat_')) {
      const cfg = (settings.aiMattingConfigs ?? []).find((c) => c.id === model && c.enabled !== false);
      if (!cfg || cfg.provider !== 'volcengine') {
        return { ok: false, error: '无效的 AI 抠图配置' };
      }
      if (!(cfg.accessKeyId ?? '').trim() || !(cfg.secretAccessKey ?? '').trim()) {
        return { ok: false, error: '请在设置中补全火山引擎 Access Key' };
      }
      const pngBuffer = await image.png().toBuffer();
      const v = await volcengineMatting(cfg, pngBuffer);
      if (!v.ok || !v.imageBuffer) return { ok: false, error: v.error ?? 'AI 抠图失败' };
      const base64 = v.imageBuffer.toString('base64');
      return { ok: true, dataUrl: `data:image/png;base64,${base64}` };
    }

    const aiMattingModel = (settings.models ?? []).find(
      (m) => m.id === model && (m.capabilityKeys ?? []).includes('matting')
    );
    if (aiMattingModel) {
      const pngBuffer = await image.png().toBuffer();
      const r = await mattePngWithOpenAiCompatibleImageEdits(aiMattingModel, pngBuffer);
      if (!r.ok) return { ok: false, error: r.error ?? 'AI 模型抠图失败' };
      if (!r.png) return { ok: false, error: 'AI 模型抠图失败' };
      const base64 = r.png.toString('base64');
      return { ok: true, dataUrl: `data:image/png;base64,${base64}` };
    }

    const { data, info } = await image
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const apiModels: MattingModel[] = ['rvm', 'birefnet', 'mvanet', 'u2netp', 'rmbg2', 'background-removal'];
    const mattingOpts: Record<string, unknown> = {};
    if (model === 'rvm') mattingOpts.downsampleRatio = downsampleRatio;
    if (model === 'u2netp') mattingOpts.u2netpAlphaMatting = false;

    const res = apiModels.includes(model as MattingModel)
      ? await callMattingApi(model as MattingModel, data, info.width, info.height, info.channels, mattingOpts)
      : { ok: false as const, message: '请使用 RVM/BiRefNet、火山 AI 抠图或具备抠图能力的模型' };

    if (!res.ok || !res.rgba) {
      const msg = !res.ok && 'message' in res ? res.message : '抠图失败';
      return { ok: false, error: msg };
    }

    const pngBuffer = await sharp(res.rgba, {
      raw: { width: info.width, height: info.height, channels: 4, premultiplied: false },
    })
      .png()
      .toBuffer();

    const base64 = pngBuffer.toString('base64');
    const dataUrl = `data:image/png;base64,${base64}`;
    return { ok: true, dataUrl };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
