/**
 * MOSS-SoundEffect 常驻 Python 子进程与 HTTP 路由逻辑
 */
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { mossSoundEffectHealthCheck } from './adapters/mossSoundEffectLocalMlx';
import { resolveMlxSfxModelDir } from './adapters/mlxSfxModelPaths';
import {
  resolveYimanEmbeddedPythonExe,
  resolveYimanSfxMainPy,
  yimanEmbeddedPythonReady,
} from './pythonPaths';

export const SFX_MOSS_PORT = 54324;
export const SFX_MOSS_LABEL = 'MOSS-SoundEffect';

type SfxRawProfile = {
  modelPath?: string;
  idleTimeoutMinutes?: number;
  mossAudioTokenizerPath?: string;
  defaultDurationSeconds?: number;
};

export type LocalSfxPayload = {
  enabled?: boolean;
  modelKey?: string;
  profiles?: Record<string, SfxRawProfile>;
};

let residentMossSfxProc: ChildProcess | null = null;
let residentMossSfxIdleTimer: ReturnType<typeof setTimeout> | null = null;
let sfxMossLastExitWasIdleKill = false;
let sfxProfiles: Record<string, SfxRawProfile> = {};

function sfxSvcLog(...args: unknown[]): void {
  console.log(`[SFX ${SFX_MOSS_LABEL}]`, ...args);
}

function logSfxPythonEvent(parsed: {
  event?: string;
  backend?: string;
  model?: string;
  load_time_s?: number;
  port?: number;
  timeout_s?: number;
  error?: string;
  traceback?: string;
}): void {
  switch (parsed.event) {
    case 'loading':
      sfxSvcLog('开始载入模型…', parsed.model ?? '');
      break;
    case 'ready':
      sfxSvcLog('模型已载入', `${parsed.load_time_s ?? '?'}s`);
      break;
    case 'error':
      sfxSvcLog('Python 错误', parsed.error ?? '');
      if (parsed.traceback) console.error(`[SFX ${SFX_MOSS_LABEL}] traceback:\n`, parsed.traceback);
      break;
    case 'listening':
      sfxSvcLog('HTTP 常驻', `127.0.0.1:${parsed.port ?? SFX_MOSS_PORT}`);
      break;
    default:
      break;
  }
}

function handleSfxPythonJsonLine(
  line: string,
  onReady: (loadTimeS: number | undefined) => void,
): void {
  try {
    const parsed = JSON.parse(line) as Parameters<typeof logSfxPythonEvent>[0];
    logSfxPythonEvent(parsed);
    if (parsed.event === 'ready') onReady(parsed.load_time_s);
  } catch {
    /* ignore */
  }
}

export function applyLocalSfxFromPayload(
  parsed: LocalSfxPayload | null | undefined,
  logLabel?: string,
): void {
  if (!parsed || typeof parsed !== 'object') return;
  sfxProfiles =
    parsed.profiles && typeof parsed.profiles === 'object' ? { ...parsed.profiles } : {};
  console.log('[AI]', logLabel ?? 'SFX 配置已应用:', parsed.modelKey ?? 'moss_sound_effect');
}

export function loadSfxConfig(): void {
  try {
    const raw = process.env.YIMAN_LOCAL_SFX_CONFIG;
    if (!raw) return;
    applyLocalSfxFromPayload(JSON.parse(raw) as LocalSfxPayload, 'SFX 配置已从环境变量加载');
  } catch {
    /* ignore */
  }
}

function mossSfxResolvedModelPath(): string {
  const p = sfxProfiles.moss_sound_effect ?? {};
  const configured = (p.modelPath ?? '').trim();
  if (!configured) return '';
  return resolveMlxSfxModelDir(configured) ?? configured;
}

function mossSfxCodecDirFromEnv(): string | undefined {
  const t = (sfxProfiles.moss_sound_effect?.mossAudioTokenizerPath ?? '').trim();
  if (t && fs.existsSync(t)) return t;
  return undefined;
}

function idleTimeoutMinForSfx(): number {
  return sfxProfiles.moss_sound_effect?.idleTimeoutMinutes ?? 3;
}

function resetSfxIdleTimer(): void {
  if (residentMossSfxIdleTimer) clearTimeout(residentMossSfxIdleTimer);
  const timeoutMin = idleTimeoutMinForSfx();
  if (timeoutMin <= 0) return;
  residentMossSfxIdleTimer = setTimeout(() => {
    if (residentMossSfxProc) {
      sfxSvcLog(`空闲超时 ${timeoutMin} 分钟，结束常驻进程`);
      sfxMossLastExitWasIdleKill = true;
      residentMossSfxProc.kill();
      residentMossSfxProc = null;
    }
  }, timeoutMin * 60_000);
}

export async function killResidentSfxForReload(reason: string): Promise<void> {
  if (residentMossSfxIdleTimer) clearTimeout(residentMossSfxIdleTimer);
  residentMossSfxIdleTimer = null;
  const proc = residentMossSfxProc;
  residentMossSfxProc = null;
  if (!proc || proc.exitCode !== null) return;
  sfxSvcLog(reason, '终止常驻 Python');
  proc.kill();
  await new Promise<void>((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    proc.once('exit', finish);
    proc.once('error', finish);
    setTimeout(finish, 8000);
  });
}

export async function validateLocalSfxProfile(body: {
  modelKey?: string;
  profile?: SfxRawProfile;
}): Promise<{ ok: boolean; message?: string }> {
  const key = body.modelKey;
  const pr = body.profile ?? {};
  const modelPath = (pr.modelPath ?? '').trim();
  if (!key) return { ok: false, message: '缺少 modelKey' };
  if (key === 'moss_sound_effect') {
    const tokenizerPath = (pr.mossAudioTokenizerPath ?? '').trim();
    if (tokenizerPath && !fs.existsSync(tokenizerPath)) {
      return { ok: false, message: `MOSS-Audio-Tokenizer 目录不存在: ${tokenizerPath}` };
    }
    return mossSoundEffectHealthCheck(modelPath);
  }
  return { ok: false, message: `未知 modelKey: ${key}` };
}

export async function ensureResidentSfxBackend(): Promise<{ ok: boolean; message?: string }> {
  if (residentMossSfxProc && residentMossSfxProc.exitCode === null) {
    resetSfxIdleTimer();
    return { ok: true };
  }

  const modelPath = mossSfxResolvedModelPath();
  if (!modelPath || !fs.existsSync(modelPath)) {
    return { ok: false, message: '音效模型未配置或路径不存在' };
  }
  if (!yimanEmbeddedPythonReady()) {
    return {
      ok: false,
      message:
        '未找到嵌入式 Python（python/env）。请在 python 目录执行 python3 -m venv env && pip install -r requirements.txt',
    };
  }

  try {
    const checkRes = await fetch(`http://127.0.0.1:${SFX_MOSS_PORT}/health`);
    if (checkRes.ok) {
      const j = (await checkRes.json().catch(() => ({}))) as { backend?: string; ok?: boolean };
      if (j.backend === 'sfx_moss' || j.ok === true) {
        resetSfxIdleTimer();
        sfxSvcLog(`复用 127.0.0.1:${SFX_MOSS_PORT} 常驻`);
        return { ok: true };
      }
      return { ok: false, message: `端口 ${SFX_MOSS_PORT} 已被占用，请重启 AI 模型服务` };
    }
  } catch {
    /* not running */
  }

  const timeoutSec = idleTimeoutMinForSfx() * 60;
  sfxSvcLog('启动 Python 常驻（首次载入可能较慢）…');
  const childEnv = { ...process.env, PYTHONUNBUFFERED: '1' } as NodeJS.ProcessEnv;
  const codecDir = mossSfxCodecDirFromEnv();
  const configuredTok = (sfxProfiles.moss_sound_effect?.mossAudioTokenizerPath ?? '').trim();
  if (configuredTok && !codecDir) {
    sfxSvcLog('Tokenizer 路径无效，未设置 YIMAN_MOSS_SFX_CODEC_DIR', configuredTok);
  }
  if (codecDir) {
    childEnv.YIMAN_MOSS_SFX_CODEC_DIR = codecDir;
    sfxSvcLog('MOSS-Audio-Tokenizer → YIMAN_MOSS_SFX_CODEC_DIR', codecDir);
  }

  const child = spawn(
    resolveYimanEmbeddedPythonExe(),
    [
      resolveYimanSfxMainPy(),
      '--backend',
      'sfx_moss',
      '--model',
      modelPath,
      '--port',
      String(SFX_MOSS_PORT),
      '--timeout',
      String(timeoutSec > 0 ? timeoutSec : 999999),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
  );
  residentMossSfxProc = child;

  return new Promise((resolve) => {
    let buf = '';
    let stderrAcc = '';
    let settled = false;
    const finish = (result: { ok: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        handleSfxPythonJsonLine(line, (loadTimeS) => {
          resetSfxIdleTimer();
          finish({ ok: true, message: `模型加载 ${loadTimeS}s` });
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (c) => {
      const chunk = c.toString();
      stderrAcc += chunk;
      const s = chunk.trim();
      if (s) console.error(`[SFX ${SFX_MOSS_LABEL}][stderr]`, s.slice(0, 2000));
    });
    child.on('exit', (code) => {
      sfxMossLastExitWasIdleKill = false;
      residentMossSfxProc = null;
      const errTail = code !== 0 && stderrAcc.trim() ? stderrAcc.trimEnd().slice(-600) : '';
      finish({
        ok: false,
        message: code === 0 ? '常驻进程已退出' : `进程退出 code=${code}${errTail ? ` | ${errTail}` : ''}`,
      });
    });
    setTimeout(() => {
      if (residentMossSfxProc === child && child.exitCode === null && !settled) {
        finish({ ok: false, message: '模型加载超时（600s）' });
        child.kill();
      }
    }, 600_000);
  });
}

function parseSfxPythonErrorBody(errText: string): string {
  let s = errText.trim();
  if (!s) return '音效生成失败';
  try {
    const j = JSON.parse(s) as { error?: string };
    if (typeof j.error === 'string' && j.error.trim()) return j.error.trim();
  } catch {
    /* ignore */
  }
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

export async function generateMossSoundEffect(params: {
  description: string;
  durationSeconds: number;
}): Promise<{ ok: true; buffer: Buffer } | { ok: false; error: string }> {
  const ensure = await ensureResidentSfxBackend();
  if (!ensure.ok) {
    return { ok: false, error: ensure.message ?? '常驻服务未就绪' };
  }
  try {
    const res = await fetch(`http://127.0.0.1:${SFX_MOSS_PORT}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description: params.description,
        durationSeconds: params.durationSeconds,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { ok: false, error: parseSfxPythonErrorBody(errText) };
    }
    resetSfxIdleTimer();
    const buffer = Buffer.from(await res.arrayBuffer());
    return { ok: true, buffer };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type SfxRouteHelpers = {
  parseJsonBody: (req: IncomingMessage) => Promise<unknown>;
  sendJson: (res: ServerResponse, req: IncomingMessage, status: number, data: unknown) => void;
  sendAudio: (res: ServerResponse, req: IncomingMessage, buffer: Buffer) => void;
};

export async function handleSfxHttpRoute(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  helpers: SfxRouteHelpers,
): Promise<boolean> {
  const { parseJsonBody, sendJson, sendAudio } = helpers;

  if (req.method === 'POST' && pathname === '/api/v1/sfx/validate-profile') {
    try {
      const body = (await parseJsonBody(req)) as { modelKey?: string; profile?: SfxRawProfile };
      const r = await validateLocalSfxProfile(body);
      sendJson(res, req, 200, r);
    } catch (e) {
      sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/v1/sfx/reload-config') {
    try {
      const body = (await parseJsonBody(req)) as { localSfx?: LocalSfxPayload };
      const ls = body.localSfx;
      if (!ls || typeof ls !== 'object') {
        sendJson(res, req, 400, { ok: false, message: '缺少 body.localSfx' });
        return true;
      }
      applyLocalSfxFromPayload(ls, 'SFX 配置热更新');
      process.env.YIMAN_LOCAL_SFX_CONFIG = JSON.stringify(ls);
      await killResidentSfxForReload('SFX 配置变更');
      sendJson(res, req, 200, { ok: true, message: '已刷新本地音效配置' });
    } catch (e) {
      sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  if (req.method === 'GET' && pathname === '/api/v1/sfx/MOSS-SoundEffect/health') {
    const path = mossSfxResolvedModelPath();
    if (!path) {
      sendJson(res, req, 200, { ok: false, message: 'MOSS-SoundEffect 模型目录未配置' });
      return true;
    }
    const r = await mossSoundEffectHealthCheck(path);
    sendJson(res, req, 200, r);
    return true;
  }

  if (req.method === 'POST' && pathname === '/api/v1/sfx/MOSS-SoundEffect') {
    try {
      const body = (await parseJsonBody(req)) as {
        description?: string;
        text?: string;
        durationSeconds?: number;
      };
      const description = (body.description ?? body.text ?? '').trim();
      if (!description) {
        sendJson(res, req, 400, { ok: false, error: 'description 不能为空' });
        return true;
      }
      let duration = Number(body.durationSeconds ?? 6);
      if (!Number.isFinite(duration)) duration = 6;
      duration = Math.max(2, Math.min(15, duration));

      const gen = await generateMossSoundEffect({ description, durationSeconds: duration });
      if (!gen.ok) {
        sendJson(res, req, 503, { ok: false, error: gen.error });
        return true;
      }
      sfxSvcLog('生成完成', `${gen.buffer.length} 字节`);
      sendAudio(res, req, gen.buffer);
    } catch (e) {
      sendJson(res, req, 500, { ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return true;
  }

  return false;
}
