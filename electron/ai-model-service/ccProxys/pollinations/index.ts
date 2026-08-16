/**
 * Pollinations.ai CC Proxy — 将 OpenAI /v1/images/generations 协议翻译为 Pollinations GET API
 *
 * 使用方式：
 * 1. 在 server.ts 中 import 本模块并调用 registerRoutes(handler)
 * 2. 在 AI 模型设置中添加模型：
 *    - apiUrl: http://127.0.0.1:19815/api/v1/proxies/pollinations
 *    - model: pollinations/flux（或其他 Pollinations 支持的模型名）
 *    - apiKey: pk_IFqEQWTwuNNprLvN（如不填则使用默认 key）
 *    - capabilityKeys: ["draw"]
 * 3. 系统通过 OpenAI 协议调用 {apiUrl}/images/generations，本代理翻译为 Pollinations GET 请求
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

const DEFAULT_API_KEY = 'pk_IFqEQWTwuNNprLvN';
const DEFAULT_MODEL = 'flux';
const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

/** OpenAI images/generations 请求体 */
interface OpenAIRequest {
  model?: string;
  prompt?: string;
  n?: number;
  size?: string; // "1024x1024"
  response_format?: string;
}

/** OpenAI images/generations 响应体 */
interface OpenAIResponse {
  created: number;
  data: Array<{ url?: string; b64_json?: string }>;
}

/**
 * 从 OpenAI size 字符串中解析宽高
 * "1024x1024" → { width: 1024, height: 1024 }
 */
function parseSize(size: string | undefined): { width: number; height: number } {
  if (!size) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  const parts = size.split('x').map(Number);
  if (parts.length !== 2 || parts.some(isNaN)) return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  return { width: parts[0], height: parts[1] };
}

/**
 * 构建 Pollinations 图片 URL
 */
function buildPollinationsUrl(prompt: string, options: {
  model?: string;
  seed?: number;
  width?: number;
  height?: number;
  apiKey?: string;
}): string {
  const seed = options.seed ?? Math.floor(Math.random() * 1000000000);
  const model = options.model ?? DEFAULT_MODEL;
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const apiKey = options.apiKey ?? DEFAULT_API_KEY;

  let url = `https://gen.pollinations.ai/image/${encodeURIComponent(prompt)}`;
  url += `?model=${encodeURIComponent(model)}`;
  url += `&seed=${seed}`;
  url += `&nologo=true`;
  url += `&enhance=true`;
  url += `&width=${width}`;
  url += `&height=${height}`;
  url += `&key=${encodeURIComponent(apiKey)}`;

  return url;
}

/**
 * 解析请求体 JSON（缓冲流）
 */
function parseJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf-8');
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

/**
 * 发送 JSON 响应
 */
function sendJson(res: ServerResponse, statusCode: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  });
  res.end(body);
}

/**
 * 核心处理函数：将 OpenAI 格式的图片生成请求转发到 Pollinations
 */
async function handleImagesGenerations(body: OpenAIRequest, apiKey?: string): Promise<OpenAIResponse> {
  const prompt = (body.prompt ?? '').trim();
  const n = Math.min(Math.max(body.n ?? 1, 1), 6); // 1-6 张
  const { width, height } = parseSize(body.size);
  const model = body.model?.replace(/^pollinations\//, '') || DEFAULT_MODEL;
  const key = apiKey?.trim() || DEFAULT_API_KEY;

  const dataUrls: OpenAIResponse['data'] = [];

  for (let i = 0; i < n; i++) {
    const pollUrl = buildPollinationsUrl(prompt, {
      model,
      width,
      height,
      apiKey: key,
    });
    dataUrls.push({ url: pollUrl });
  }

  return {
    created: Math.floor(Date.now() / 1000),
    data: dataUrls,
  };
}

/**
 * HTTP 请求处理入口（用于 server.ts 的路由转发）
 *
 * @returns true 表示已处理，false 表示不属于本代理的路由
 */
export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  parsedPath: string,
  apiKey?: string,
): Promise<boolean> {
  // CORS preflight — 返回 200，不写 body，确保浏览器接受
  if (req.method === 'OPTIONS') {
    res.writeHead(200, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Max-Age': '86400',
    });
    res.end();
    return true;
  }

  if (req.method !== 'POST') return false;

  console.log(`[Pollinations Proxy] method=${req.method} path=${parsedPath}`);

  // 匹配 /api/v1/proxies/pollinations/images/generations
  // 或 /images/generations（当直接挂在 apiUrl 根路径时）
  if (!parsedPath.endsWith('/images/generations')) {
    console.log(`[Pollinations Proxy] path mismatch, returning false`);
    return false;
  }

  console.log(`[Pollinations Proxy] route matched, processing...`);

  try {
    const body = (await parseJsonBody(req)) as OpenAIRequest;
    console.log(`[Pollinations Proxy] body:`, JSON.stringify(body));
    const result = await handleImagesGenerations(body, apiKey);
    console.log(`[Pollinations Proxy] success, returning ${result.data.length} images`);
    sendJson(res, 200, result);
  } catch (e) {
    sendJson(res, 500, {
      error: {
        message: `Pollinations proxy error: ${e instanceof Error ? e.message : String(e)}`,
        type: 'proxy_error',
      },
    });
  }

  return true;
}

/**
 * 直接调用 Pollinations 生成单张图片，返回图片 URL
 * 供内部其他模块直接使用（不经过 HTTP）
 */
export async function generateImage(
  prompt: string,
  options?: {
    model?: string;
    width?: number;
    height?: number;
    apiKey?: string;
  },
): Promise<string> {
  const url = buildPollinationsUrl(prompt, {
    model: options?.model,
    width: options?.width,
    height: options?.height,
    apiKey: options?.apiKey,
  });
  return url;
}
