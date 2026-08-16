/**
 * AI 模型服务 - HTTP 客户端
 * 主进程调用独立服务，避免直接加载模型导致 OOM
 * 使用 Node http 替代 fetch，兼容 Electron 主进程
 */
import http from 'node:http';

const DEFAULT_PORT = 19815;
const DEFAULT_HOST = '127.0.0.1';
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 300;

function getHost(): string {
  const url = process.env.AIMODEL_SERVICE_URL;
  if (url) {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return DEFAULT_HOST;
    }
  }
  return DEFAULT_HOST;
}

function getPort(): number {
  const url = process.env.AIMODEL_SERVICE_URL;
  if (url) {
    try {
      const u = new URL(url);
      return parseInt(u.port || String(DEFAULT_PORT), 10);
    } catch {
      return DEFAULT_PORT;
    }
  }
  return DEFAULT_PORT;
}

export interface MattingApiResult {
  ok: true;
  rgbaBase64: string;
}

export interface MattingApiError {
  ok: false;
  error: string;
}

function httpPost(path: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const host = getHost();
    const port = getPort();
    const req = http.request(
      {
        hostname: host,
        port,
        path,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks).toString()));
        res.on('error', reject);
      }
    );
    req.on('error', reject);
    req.setTimeout(120000);
    req.write(body);
    req.end();
  });
}

/** 通过 HTTP 调用远程抠图服务，带重试 */
export async function callMattingApi(
  modelId: string,
  rgbData: Buffer,
  width: number,
  height: number,
  channels: number,
  options?: Record<string, unknown>
): Promise<{ ok: true; rgba: Buffer } | { ok: false; message: string }> {
  const rgbBase64 = rgbData.toString('base64');
  const body = JSON.stringify({ modelId, rgbBase64, width, height, channels, options });
  let lastErr: Error | null = null;
  for (let i = 0; i < MAX_RETRIES; i++) {
    try {
      const text = await httpPost('/matting/run', body);
      const json = JSON.parse(text) as MattingApiResult | MattingApiError;
      if (json.ok) {
        return { ok: true, rgba: Buffer.from(json.rgbaBase64, 'base64') };
      }
      return { ok: false, message: json.error ?? '抠图失败' };
    } catch (e) {
      lastErr = e instanceof Error ? e : new Error(String(e));
      if (i < MAX_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  const msg = lastErr?.message ?? '未知错误';
  return { ok: false, message: `连接 AI 模型服务失败: ${msg}` };
}

/** 检查服务是否就绪 */
export async function pingMattingService(): Promise<boolean> {
  try {
    const host = getHost();
    const port = getPort();
    await new Promise<void>((resolve, reject) => {
      const req = http.request(
        { hostname: host, port, path: '/health', method: 'GET' },
        (res) => {
          res.resume();
          res.statusCode === 200 ? resolve() : reject(new Error(`status ${res.statusCode}`));
        }
      );
      req.on('error', reject);
      req.setTimeout(3000);
      req.end();
    });
    return true;
  } catch {
    return false;
  }
}
