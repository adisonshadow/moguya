/**
 * 火山引擎智能分割抠图服务
 * 对接火山引擎通用图像分割 - 智能分割 API
 * 接口文档：https://www.volcengine.com/docs/86081/1660405
 * 请求地址：https://visual.volcengineapi.com?Action=CVProcess&Version=2022-08-31
 *
 * 签名使用 @volcengine/openapi 的 Signer（与 @volcengine/sdk-core 同源）
 */
import { Signer } from '@volcengine/openapi';
import type { AIMattingConfig } from './settings';

const ACTION = 'CVProcess';
const VERSION = '2022-08-31';
const HOST = 'visual.volcengineapi.com';
/** 签名用 Service（文档：本服务 Service 为 cv） */
const SERVICE = 'cv';
/** 签名用 Region（文档：本服务 Region 为 cn-north-1） */
const SIGN_REGION = 'cn-north-1';

export interface VolcengineMattingResult {
  ok: boolean;
  imageBuffer?: Buffer;
  error?: string;
}

/**
 * 对单张图片执行智能分割抠图，返回 RGBA PNG Buffer
 */
export async function volcengineMatting(
  config: AIMattingConfig,
  imageBuffer: Buffer
): Promise<VolcengineMattingResult> {
  const { accessKeyId, secretAccessKey } = config;
  if (!accessKeyId || !secretAccessKey) {
    return { ok: false, error: '未配置 Access Key 或 Secret Key' };
  }

  const imageBase64 = imageBuffer.toString('base64');
  const body = {
    req_key: 'entity_seg',
    binary_data_base64: [imageBase64],
    return_format: 4, // 最大实体图层前景图 + 最大实体图层，取第一个为前景
  };
  const bodyStr = JSON.stringify(body);

  // 使用 @volcengine/openapi Signer 生成签名
  const request: {
    region: string;
    method: string;
    pathname: string;
    params: Record<string, string>;
    headers: Record<string, string>;
    body: string;
  } = {
    region: SIGN_REGION,
    method: 'POST',
    pathname: '/',
    params: { Action: ACTION, Version: VERSION },
    headers: {
      Host: HOST,
      'Content-Type': 'application/json',
    },
    body: bodyStr,
  };

  const signer = new Signer(request, SERVICE);
  signer.addAuthorization({
    accessKeyId,
    secretKey: secretAccessKey,
    sessionToken: '',
  });

  const queryString = `Action=${ACTION}&Version=${VERSION}`;
  const url = `https://${HOST}/?${queryString}`;
  const headers = request.headers as Record<string, string>;

  // ---------- 原来自实现签名逻辑（已停用，保留备查） ----------
  // const ALGORITHM = 'HMAC-SHA256';
  // const now = new Date();
  // const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, '');
  // const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '').slice(0, 15) + 'Z';
  // const hashedPayload = sha256Hex(bodyStr);
  // const signedHeaders = 'content-type;host;x-content-sha256;x-date';
  // const canonicalHeaders = [
  //   `content-type:${contentType}`,
  //   `host:${HOST}`,
  //   `x-content-sha256:${hashedPayload}`,
  //   `x-date:${amzDate}`,
  // ].join('\n') + '\n';
  // const credentialScope = `${dateStamp}/${SIGN_REGION}/${SERVICE}/request`;
  // const canonicalRequest = [
  //   method, uri, queryString, canonicalHeaders, signedHeaders, hashedPayload,
  // ].join('\n');
  // const hashedCanonicalRequest = sha256Hex(canonicalRequest);
  // const stringToSign = [ALGORITHM, amzDate, credentialScope, hashedCanonicalRequest].join('\n');
  // 注：原实现使用 VOLC 前缀，SDK 使用空前缀 kDatePrefix=""
  // const kDate = hmac(`VOLC${secretAccessKey}`, dateStamp);
  // const kRegion = hmac(kDate, SIGN_REGION);
  // const kService = hmac(kRegion, SERVICE);
  // const kSigning = hmac(kService, 'request');
  // const signature = hmacHex(kSigning, stringToSign);
  // const authHeader = `${ALGORITHM} Credential=${accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  // 原实现使用的辅助函数（保留以便回退）：
  // function sha256Hex(data: string): string { return crypto.createHash("sha256").update(data,"utf8").digest("hex"); }
  // function hmac(key: string|Buffer, data: string): Buffer { return crypto.createHmac("sha256",key).update(data,"utf8").digest(); }
  // function hmacHex(key: Buffer, data: string): string { return crypto.createHmac("sha256",key).update(data,"utf8").digest("hex"); }
  // ---------- 原签名逻辑结束 ----------

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: bodyStr,
    });

    const text = await res.text();
    const json = JSON.parse(text || '{}') as Record<string, unknown>;

    if (!res.ok) {
      const meta = json.ResponseMetadata as Record<string, unknown> | undefined;
      const err = meta?.Error as Record<string, string> | undefined;
      const msg =
        err?.Message ?? (json.message as string) ?? (json.Message as string) ?? text?.slice(0, 200) ?? `HTTP ${res.status}`;
      return { ok: false, error: msg };
    }

    const code = json.status ?? json.code;
    if (code !== 10000) {
      return {
        ok: false,
        error: (json.message as string) ?? (json.Message as string) ?? `业务错误 ${code}`,
      };
    }

    const data = json.data as Record<string, unknown> | undefined;
    const binaryData = data?.binary_data_base64 as string[] | undefined;
    if (Array.isArray(binaryData) && binaryData.length > 0) {
      const first = binaryData[0];
      if (typeof first === 'string') {
        return { ok: true, imageBuffer: Buffer.from(first, 'base64') };
      }
    }
    return { ok: false, error: '响应中未找到抠图结果' };
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    const cause = 'cause' in err && err.cause instanceof Error ? err.cause : null;
    const code = cause && 'code' in cause ? (cause as NodeJS.ErrnoException).code : null;
    const details: string[] = [err.message];
    if (cause?.message) details.push(`原因: ${cause.message}`);
    if (code) details.push(`错误码: ${code}`);
    const fullMsg = details.join('；');
    console.error('[火山引擎抠图] 请求失败:', fullMsg, cause || '');
    return { ok: false, error: `请求失败: ${fullMsg}` };
  }
}
