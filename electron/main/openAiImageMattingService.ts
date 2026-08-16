/**
 * OpenAI 兼容 images/edits 抠图（通道 B：AIModelConfig + matting 能力）
 * 用于通义等兼容网关；若上游路径或字段不同，会返回 HTTP 错误信息便于排查。
 */
import type { AIModelConfig } from './settings';
import { resolveRequestModelId } from '../../src/utils/aiModelRequestId';

function editsUrl(apiUrl: string): string {
  const base = apiUrl.trim().replace(/\/$/, '');
  return base.endsWith('/v1') ? `${base}/images/edits` : `${base}/v1/images/edits`;
}

export async function mattePngWithOpenAiCompatibleImageEdits(
  model: AIModelConfig,
  imagePng: Buffer
): Promise<{ ok: true; png: Buffer } | { ok: false; error: string }> {
  try {
    if (!model.apiUrl?.trim()) return { ok: false, error: '未配置 API 地址' };
    if (!model.isLocal && !(model.apiKey ?? '').trim()) {
      return { ok: false, error: '未配置 API 密钥' };
    }

    const url = editsUrl(model.apiUrl);
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(imagePng)], { type: 'image/png' }), 'image.png');
    form.append(
      'prompt',
      'Remove the background and return a PNG with a transparent background. Keep the subject only.'
    );
    const modelName = (resolveRequestModelId(model) ?? '').trim();
    if (modelName) form.append('model', modelName);
    form.append('response_format', 'b64_json');

    const headers: Record<string, string> = {};
    if (!model.isLocal && (model.apiKey ?? '').trim()) {
      headers.Authorization = `Bearer ${model.apiKey.trim()}`;
    }

    const res = await fetch(url, { method: 'POST', headers, body: form });
    const ct = (res.headers.get('content-type') || '').toLowerCase();
    if (!ct.includes('application/json')) {
      const t = await res.text().catch(() => '');
      return { ok: false, error: `HTTP ${res.status} ${t.slice(0, 200)}` };
    }
    const json = (await res.json()) as {
      data?: Array<{ b64_json?: string; url?: string }>;
      error?: { message?: string };
      message?: string;
    };
    if (!res.ok) {
      const msg = json?.error?.message ?? json?.message ?? JSON.stringify(json).slice(0, 300);
      return { ok: false, error: `HTTP ${res.status} ${msg}` };
    }
    const b64 = json?.data?.[0]?.b64_json;
    if (typeof b64 === 'string' && b64.trim()) {
      return { ok: true, png: Buffer.from(b64.trim(), 'base64') };
    }
    const imgUrl = json?.data?.[0]?.url;
    if (typeof imgUrl === 'string' && imgUrl.trim()) {
      const imgRes = await fetch(imgUrl.trim());
      if (!imgRes.ok) return { ok: false, error: `拉取结果图失败 HTTP ${imgRes.status}` };
      const buf = Buffer.from(await imgRes.arrayBuffer());
      return { ok: true, png: buf };
    }
    return { ok: false, error: '响应中未找到 b64_json 或 url' };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
