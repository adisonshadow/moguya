/**
 * AI 模型服务 - 独立 HTTP API
 * 抠图（ONNX）+ 本地 TTS（常驻 Python 子进程代理）
 */
import http from 'node:http';
import fs from 'node:fs';
import { spawn, type ChildProcess } from 'node:child_process';
import { runMatting, listMattingModels } from './registry';
import { MossTtsLocalMlxAdapter } from './adapters/mossTtsLocalMlx';
import { MossTtsNanoLocalMlxAdapter } from './adapters/mossTtsNanoLocalMlx';
import { resolveMlxNanoModelDir } from './adapters/mlxNanoModelPaths';
import { handleRequest as handlePollinationsProxy } from './ccProxys/pollinations';
import {
  resolveYimanEmbeddedPythonExe,
  resolveYimanTtsMainPy,
  yimanEmbeddedPythonReady,
} from './pythonPaths';
import { handleSfxHttpRoute, loadSfxConfig } from './sfxResidentService';

const DEFAULT_PORT = 19815;
const PORT = parseInt(process.env.AIMODEL_PORT ?? String(DEFAULT_PORT), 10);
const TTS_LONGCAT_PORT = 54321;
const TTS_MOSS_PORT = 54322;
const TTS_MOSS_NANO_PORT = 54323;
function ttsSvcLog(restLabel: string, ...args: unknown[]): void {
  console.log(`[TTS ${restLabel}]`, ...args);
}

/** Python 常驻服务 JSON 错误体可能被当作字符串再次包装 */
function parseTtsPythonErrorBody(errText: string): string {
  let s = errText.trim();
  if (!s) return 'TTS 合成失败';
  for (let i = 0; i < 3; i += 1) {
    try {
      const j = JSON.parse(s) as { error?: unknown };
      if (typeof j.error === 'string' && j.error.trim()) {
        s = j.error.trim();
        continue;
      }
      break;
    } catch {
      break;
    }
  }
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/** 解析 Python 子进程 stdout 中的 JSON 行并打日志（不依赖是否仍在等 ready） */
const LC_LABEL = 'LongCat-AudioDiT';
const MOSS_LABEL = 'MOSS-TTS';
const MOSS_NANO_LABEL = 'MOSS-TTS-Nano';

type TtsBackendKind = 'longcat' | 'moss' | 'moss_nano';

function ttsLabelForBackend(backend?: string): string {
  if (backend === 'moss') return MOSS_LABEL;
  if (backend === 'moss_nano') return MOSS_NANO_LABEL;
  return LC_LABEL;
}

function ttsPortForBackend(backend?: string): number {
  if (backend === 'moss') return TTS_MOSS_PORT;
  if (backend === 'moss_nano') return TTS_MOSS_NANO_PORT;
  return TTS_LONGCAT_PORT;
}

function logTtsPythonEvent(
  parsed: {
    event?: string;
    backend?: string;
    model?: string;
    load_time_s?: number;
    port?: number;
    timeout_s?: number;
    elapsed?: number;
    error?: string;
    traceback?: string;
    /** LongCat tokenizer 预热 */
    pretrained?: string;
    elapsed_s?: number;
    text_chars?: number;
    lang?: string;
    steps?: number;
    cfg_strength?: number;
    seed?: number;
    has_ref_audio?: boolean;
    has_ref_text?: boolean;
    wall_synthesis_s?: number;
    mlx_processing_time_s?: number;
    samples?: number;
    audio_duration_human?: string;
    sample_rate?: number;
    peak_memory_gb?: number;
    ref_path?: string;
    cache_hit?: boolean;
    from_disk?: boolean;
    wall_encode_s?: number;
    frames?: number;
    cache_key_prefix?: string;
  },
  labelOverride?: string,
): void {
  const label = labelOverride ?? ttsLabelForBackend(parsed.backend);
  const defaultListenPort = ttsPortForBackend(parsed.backend);
  switch (parsed.event) {
    case 'loading':
      ttsSvcLog(label, '开始载入模型到内存…', parsed.model ?? '');
      break;
    case 'ready':
      ttsSvcLog(label, '模型已载入内存，耗时', `${parsed.load_time_s ?? '?'}s`);
      break;
    case 'error':
      ttsSvcLog(label, 'Python 上报错误', parsed.error ?? '(无 message)');
      if (parsed.traceback) {
        console.error(`[TTS ${label}] traceback:\n`, parsed.traceback);
      }
      break;
    case 'listening':
      ttsSvcLog(
        label,
        'HTTP 常驻已监听',
        `127.0.0.1:${parsed.port ?? defaultListenPort}`,
        '空闲超时',
        `${parsed.timeout_s ?? '?'}s`,
      );
      break;
    case 'idle_timeout':
      ttsSvcLog(label, 'Python 侧空闲超时，即将退出常驻并释放内存', `(elapsed≈${Math.round(parsed.elapsed ?? 0)}s)`);
      break;
    case 'shutdown':
      ttsSvcLog(label, 'Python 常驻进程已结束，内存已释放');
      break;
    case 'longcat_tokenizer_warmup':
      ttsSvcLog(label, 'UMT5 tokenizer 已预热（含缓存补丁）', `pretrained=${parsed.pretrained ?? '?'}`, `耗时 ${parsed.elapsed_s ?? '?'}s`);
      break;
    case 'longcat_generate_start':
      ttsSvcLog(
        label,
        '合成开始',
        `text_chars=${parsed.text_chars ?? '?'} lang=${parsed.lang ?? '?'}`,
        `steps=${parsed.steps ?? '?'} cfg=${parsed.cfg_strength ?? '?'} seed=${parsed.seed ?? '?'}`,
        `ref_audio=${parsed.has_ref_audio === true ? 'yes' : 'no'} ref_text=${parsed.has_ref_text === true ? 'yes' : 'no'}`,
      );
      break;
    case 'longcat_generate_done':
      ttsSvcLog(
        label,
        '合成完成（Python）',
        `wall_synthesis_s=${parsed.wall_synthesis_s ?? '?'}`,
        `mlx_processing_time_s=${parsed.mlx_processing_time_s ?? '?'}`,
        `samples=${parsed.samples ?? '?'}`,
        `audio_duration=${parsed.audio_duration_human ?? '?'}`,
        `sr=${parsed.sample_rate ?? '?'}`,
        `peak_memory_gb=${parsed.peak_memory_gb ?? '?'}`,
      );
      break;
    case 'moss_nano_generate_start':
      ttsSvcLog(
        label,
        '合成开始',
        `text_chars=${parsed.text_chars ?? '?'}`,
        `ref_audio=${parsed.has_ref_audio === true ? 'yes' : 'no'}`,
      );
      break;
    case 'moss_nano_generate_done':
      ttsSvcLog(
        label,
        '合成完成（Python）',
        `wall_synthesis_s=${parsed.wall_synthesis_s ?? '?'}`,
        `mlx_processing_time_s=${parsed.mlx_processing_time_s ?? '?'}`,
        `sr=${parsed.sample_rate ?? '?'}`,
      );
      break;
    case 'voice_ref_encode_start':
      ttsSvcLog(label, '参考音色编码开始', parsed.ref_path ?? '');
      break;
    case 'voice_ref_encode_done':
      ttsSvcLog(
        label,
        '参考音色编码完成',
        `cache_hit=${String(parsed.cache_hit)}`,
        `from_disk=${String(parsed.from_disk)}`,
        `wall_encode_s=${parsed.wall_encode_s ?? '?'}`,
        `frames=${parsed.frames ?? '?'}`,
      );
      break;
    case 'voice_ref_cache_evict':
      ttsSvcLog(label, '参考音色 LRU 淘汰', parsed.cache_key_prefix ?? '');
      break;
    default:
      break;
  }
}

function handleTtsPythonJsonLine(
  line: string,
  label: string,
  onReady: (loadTimeS: number | undefined) => void,
): void {
  try {
    const parsed = JSON.parse(line) as Parameters<typeof logTtsPythonEvent>[0];
    logTtsPythonEvent(parsed, label);
    if (parsed.event === 'ready') {
      onReady(parsed.load_time_s);
    }
  } catch {
    /* 非 JSON 行忽略 */
  }
}

// ===== 常驻 TTS 服务管理 =====

let residentLongcatProc: ChildProcess | null = null;
let residentLongcatIdleTimer: ReturnType<typeof setTimeout> | null = null;
let residentMossProc: ChildProcess | null = null;
let residentMossIdleTimer: ReturnType<typeof setTimeout> | null = null;
let residentMossNanoProc: ChildProcess | null = null;
let residentMossNanoIdleTimer: ReturnType<typeof setTimeout> | null = null;
/** Node 在空闲定时器里 kill 子进程时为 true，便于 exit 日志区分原因 */
let ttsLongcatLastExitWasIdleKill = false;
let ttsMossLastExitWasIdleKill = false;
let ttsMossNanoLastExitWasIdleKill = false;

/** LongCat 常驻进程使用的解析后配置（来自 profiles.longcat_audio_dit + 旧版扁平字段） */
let ttsConfig: {
  modelPath?: string;
  idleTimeoutMin?: number;
} = {};

type RawProfile = {
  modelPath?: string;
  idleTimeoutMinutes?: number;
  mossAudioTokenizerPath?: string;
};

/** 完整 env JSON，含各模型 profile */
let ttsProfiles: Record<string, RawProfile> = {};

type LocalTtsPayload = {
  modelKey?: string;
  modelPath?: string;
  idleTimeoutMin?: number;
  idleTimeoutMinutes?: number;
  profiles?: Record<string, RawProfile>;
};

function applyLocalTtsFromPayload(parsed: LocalTtsPayload | null | undefined, logLabel?: string): void {
  if (!parsed || typeof parsed !== 'object') return;
  ttsProfiles = parsed.profiles && typeof parsed.profiles === 'object' ? { ...parsed.profiles } : {};
  const lc = ttsProfiles.longcat_audio_dit ?? {};
  const idleMin =
    lc.idleTimeoutMinutes ??
    parsed.idleTimeoutMin ??
    parsed.idleTimeoutMinutes ??
    3;
  ttsConfig = {
    modelPath: (lc.modelPath ?? parsed.modelPath ?? '').trim() || undefined,
    idleTimeoutMin: idleMin,
  };
  console.log('[AI]', logLabel ?? 'TTS 配置已应用:', parsed.modelKey || 'longcat_audio_dit');
}

function killResidentTtsForReload(reason: string): Promise<void> {
  if (residentLongcatIdleTimer) clearTimeout(residentLongcatIdleTimer);
  residentLongcatIdleTimer = null;
  if (residentMossIdleTimer) clearTimeout(residentMossIdleTimer);
  residentMossIdleTimer = null;
  if (residentMossNanoIdleTimer) clearTimeout(residentMossNanoIdleTimer);
  residentMossNanoIdleTimer = null;

  const lcProc = residentLongcatProc;
  const mossProc = residentMossProc;
  const nanoProc = residentMossNanoProc;
  residentLongcatProc = null;
  residentMossProc = null;
  residentMossNanoProc = null;

  const killAndWait = (proc: ChildProcess | null, tag: string): Promise<void> => {
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    console.log(`[TTS ${tag}] ${reason}，终止常驻 Python 以便下次加载新路径/超时`);
    ttsSvcLog(tag, '(reload) SIGTERM/KILL 发往子进程 PID', proc.pid ?? '?');

    void proc.kill();

    return new Promise((resolve) => {
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
  };

  return Promise.all([
    killAndWait(lcProc, LC_LABEL),
    killAndWait(mossProc, MOSS_LABEL),
    killAndWait(nanoProc, MOSS_NANO_LABEL),
  ]).then(() => undefined);
}

function loadTtsConfig(): void {
  try {
    const raw = process.env.YIMAN_LOCAL_TTS_CONFIG;
    if (!raw) return;
    applyLocalTtsFromPayload(JSON.parse(raw) as LocalTtsPayload, 'TTS 配置已从环境变量加载');
  } catch {
    /* ignore */
  }
}

function mossResolvedModelPath(): string {
  const p = ttsProfiles.moss_tts ?? ttsProfiles.moss_tts_local_mlx ?? {};
  return (p.modelPath ?? '').trim();
}

/** 用户配置的 MOSS-Audio-Tokenizer 根目录 → 注入 Python 的 YIMAN_MOSS_CODEC_DIR */
function mossAudioTokenizerDirFromEnv(): string | undefined {
  const p = ttsProfiles.moss_tts ?? ttsProfiles.moss_tts_local_mlx ?? {};
  const t = (p.mossAudioTokenizerPath ?? '').trim();
  if (t && fs.existsSync(t)) return t;
  return undefined;
}

function mossNanoResolvedModelPath(): string {
  const p = ttsProfiles.moss_tts_nano ?? {};
  const configured = (p.modelPath ?? '').trim();
  if (!configured) return '';
  return resolveMlxNanoModelDir(configured) ?? configured;
}

/** MOSS-Audio-Tokenizer-Nano → YIMAN_MOSS_NANO_CODEC_DIR */
function mossNanoAudioTokenizerDirFromEnv(): string | undefined {
  const p = ttsProfiles.moss_tts_nano ?? {};
  const t = (p.mossAudioTokenizerPath ?? '').trim();
  if (t && fs.existsSync(t)) return t;
  return undefined;
}

function localTtsModelKeyToBackend(modelKey: string): TtsBackendKind | undefined {
  if (modelKey === 'longcat_audio_dit') return 'longcat';
  if (modelKey === 'moss_tts' || modelKey === 'moss_tts_local_mlx') return 'moss';
  if (modelKey === 'moss_tts_nano') return 'moss_nano';
  return undefined;
}

function ttsPortForKind(kind: TtsBackendKind): number {
  if (kind === 'longcat') return TTS_LONGCAT_PORT;
  if (kind === 'moss') return TTS_MOSS_PORT;
  return TTS_MOSS_NANO_PORT;
}

async function postToResidentTts(
  kind: TtsBackendKind,
  path: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; data: Record<string, unknown> }> {
  const port = ttsPortForKind(kind);
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  let data: Record<string, unknown> = {};
  try {
    data = (await res.json()) as Record<string, unknown>;
  } catch {
    data = { error: await res.text().catch(() => '') };
  }
  return { ok: res.ok, status: res.status, data };
}

async function invalidateVoiceCachesOnResidents(clearDisk = false): Promise<void> {
  const kinds: TtsBackendKind[] = ['longcat', 'moss', 'moss_nano'];
  await Promise.all(
    kinds.map(async (kind) => {
      try {
        await postToResidentTts(kind, '/invalidate-voice-cache', { clearDisk });
      } catch {
        /* 常驻未启动时忽略 */
      }
    }),
  );
}

async function warmVoiceReference(params: {
  modelKey: string;
  referenceAudioPath: string;
  referenceText?: string;
}): Promise<{ ok: boolean; message?: string; cache_hit?: boolean; from_disk?: boolean }> {
  const backend = localTtsModelKeyToBackend(params.modelKey);
  if (!backend) {
    return { ok: false, message: `未知 modelKey: ${params.modelKey}` };
  }
  const ref = params.referenceAudioPath.trim();
  if (!ref || !fs.existsSync(ref)) {
    return { ok: false, message: `参考音频不存在: ${ref}` };
  }
  const ensure = await ensureResidentTtsBackend(backend);
  if (!ensure.ok) {
    return { ok: false, message: ensure.message };
  }
  const tag =
    backend === 'longcat' ? LC_LABEL : backend === 'moss' ? MOSS_LABEL : MOSS_NANO_LABEL;
  ttsSvcLog(tag, '预热参考音色编码', ref);
  const pyBody: Record<string, unknown> = { referenceAudioPath: ref };
  if (params.referenceText?.trim()) pyBody.referenceText = params.referenceText.trim();
  const r = await postToResidentTts(backend, '/warm-voice-reference', pyBody);
  if (!r.ok) {
    const err = typeof r.data.error === 'string' ? r.data.error : `HTTP ${r.status}`;
    return { ok: false, message: err };
  }
  return {
    ok: r.data.ok === true,
    message: '参考音色已编码并缓存',
    cache_hit: r.data.cache_hit === true,
    from_disk: r.data.from_disk === true,
  };
}

async function validateLocalTtsProfile(body: {
  modelKey?: string;
  profile?: RawProfile;
}): Promise<{ ok: boolean; message?: string }> {
  const key = body.modelKey;
  const pr = body.profile ?? {};
  const modelPath = (pr.modelPath ?? '').trim();
  const idleMin = pr.idleTimeoutMinutes ?? 3;
  if (!key) return { ok: false, message: '缺少 modelKey' };

  if (key === 'longcat_audio_dit') {
    if (!modelPath) return { ok: false, message: '请填写模型目录' };
    if (!fs.existsSync(modelPath)) return { ok: false, message: `模型目录不存在: ${modelPath}` };
    if (!yimanEmbeddedPythonReady()) {
      return {
        ok: false,
        message:
          '未找到嵌入式 Python（python/env）。请在项目 python 目录执行：python3 -m venv env && source env/bin/activate && pip install -r requirements.txt',
      };
    }
    try {
      const { execSync } = await import('node:child_process');
      execSync(`"${resolveYimanEmbeddedPythonExe()}" --version`, { timeout: 5000 });
    } catch {
      return { ok: false, message: '嵌入式 Python 不可用' };
    }
    return {
      ok: true,
      message: `LongCat 配置检查通过 | 空闲超时将按 ${idleMin} 分钟（写入保存后生效）`,
    };
  }

  if (key === 'moss_tts' || key === 'moss_tts_local_mlx') {
    const tokenizerPath = (pr.mossAudioTokenizerPath ?? '').trim();
    if (tokenizerPath && !fs.existsSync(tokenizerPath)) {
      return { ok: false, message: `MOSS-Audio-Tokenizer 目录不存在: ${tokenizerPath}` };
    }
    const adapter = new MossTtsLocalMlxAdapter(modelPath);
    return adapter.healthCheck();
  }

  if (key === 'moss_tts_nano') {
    const tokenizerPath = (pr.mossAudioTokenizerPath ?? '').trim();
    if (tokenizerPath && !fs.existsSync(tokenizerPath)) {
      return { ok: false, message: `MOSS-Audio-Tokenizer-Nano 目录不存在: ${tokenizerPath}` };
    }
    const adapter = new MossTtsNanoLocalMlxAdapter(modelPath);
    return adapter.healthCheck();
  }

  return { ok: false, message: `未知 modelKey: ${key}` };
}

function idleTimeoutMinForKind(kind: TtsBackendKind): number {
  if (kind === 'longcat') return ttsConfig.idleTimeoutMin ?? 3;
  if (kind === 'moss') {
    return (
      ttsProfiles.moss_tts?.idleTimeoutMinutes ??
      ttsProfiles.moss_tts_local_mlx?.idleTimeoutMinutes ??
      3
    );
  }
  return ttsProfiles.moss_tts_nano?.idleTimeoutMinutes ?? 3;
}

function resetTtsIdleTimer(kind: TtsBackendKind): void {
  const timeoutMin = idleTimeoutMinForKind(kind);
  if (kind === 'longcat') {
    if (residentLongcatIdleTimer) clearTimeout(residentLongcatIdleTimer);
    if (timeoutMin <= 0) return;
    residentLongcatIdleTimer = setTimeout(() => {
      if (residentLongcatProc) {
        ttsSvcLog(
          LC_LABEL,
          `因 Node 侧空闲超时（${timeoutMin} 分钟无合成请求），正在结束常驻进程并释放内存…`,
        );
        ttsLongcatLastExitWasIdleKill = true;
        residentLongcatProc.kill();
        residentLongcatProc = null;
      }
    }, timeoutMin * 60_000);
    return;
  }
  if (kind === 'moss') {
    if (residentMossIdleTimer) clearTimeout(residentMossIdleTimer);
    if (timeoutMin <= 0) return;
    residentMossIdleTimer = setTimeout(() => {
      if (residentMossProc) {
        ttsSvcLog(
          MOSS_LABEL,
          `因 Node 侧空闲超时（${timeoutMin} 分钟无合成请求），正在结束常驻进程并释放内存…`,
        );
        ttsMossLastExitWasIdleKill = true;
        residentMossProc.kill();
        residentMossProc = null;
      }
    }, timeoutMin * 60_000);
    return;
  }
  if (residentMossNanoIdleTimer) clearTimeout(residentMossNanoIdleTimer);
  if (timeoutMin <= 0) return;
  residentMossNanoIdleTimer = setTimeout(() => {
    if (residentMossNanoProc) {
      ttsSvcLog(
        MOSS_NANO_LABEL,
        `因 Node 侧空闲超时（${timeoutMin} 分钟无合成请求），正在结束常驻进程并释放内存…`,
      );
      ttsMossNanoLastExitWasIdleKill = true;
      residentMossNanoProc.kill();
      residentMossNanoProc = null;
    }
  }, timeoutMin * 60_000);
}

async function ensureResidentTtsBackend(kind: TtsBackendKind): Promise<{ ok: boolean; message?: string }> {
  const tag =
    kind === 'longcat' ? LC_LABEL : kind === 'moss' ? MOSS_LABEL : MOSS_NANO_LABEL;
  const port =
    kind === 'longcat' ? TTS_LONGCAT_PORT : kind === 'moss' ? TTS_MOSS_PORT : TTS_MOSS_NANO_PORT;
  const expectBackend = kind;
  const existing =
    kind === 'longcat'
      ? residentLongcatProc
      : kind === 'moss'
        ? residentMossProc
        : residentMossNanoProc;

  if (existing && existing.exitCode === null) {
    resetTtsIdleTimer(kind);
    return { ok: true };
  }

  let modelPath: string;
  const timeoutSec = idleTimeoutMinForKind(kind) * 60;

  if (kind === 'longcat') {
    modelPath = (ttsConfig.modelPath ?? '').trim();
  } else if (kind === 'moss') {
    modelPath = mossResolvedModelPath();
  } else {
    modelPath = mossNanoResolvedModelPath();
  }

  if (!modelPath || !fs.existsSync(modelPath)) {
    return { ok: false, message: 'TTS 模型未配置或路径不存在' };
  }

  if (!yimanEmbeddedPythonReady()) {
    return {
      ok: false,
      message:
        '未找到嵌入式 Python（python/env）。请在项目 python 目录执行：python3 -m venv env && source env/bin/activate && pip install -r requirements.txt',
    };
  }

  try {
    const checkRes = await fetch(`http://127.0.0.1:${port}/health`);
    if (checkRes.ok) {
      const j = (await checkRes.json().catch(() => ({}))) as { backend?: string };
      if (j.backend === expectBackend) {
        resetTtsIdleTimer(kind);
        ttsSvcLog(tag, `检测到 127.0.0.1:${port} 已有常驻进程，复用（${tag}）`);
        return { ok: true };
      }
      return {
        ok: false,
        message: `端口 ${port} 已被其他进程占用，请重启 AI 模型服务后再试`,
      };
    }
  } catch {
    /* 未运行 */
  }

  ttsSvcLog(tag, '正在启动 Python 常驻子进程，随后将把模型载入内存（首次可能较慢）…');
  const childEnv = { ...process.env, PYTHONUNBUFFERED: '1' } as NodeJS.ProcessEnv;
  if (kind === 'moss') {
    const codecDir = mossAudioTokenizerDirFromEnv();
    const mp = ttsProfiles.moss_tts ?? ttsProfiles.moss_tts_local_mlx ?? {};
    const configuredTok = (mp.mossAudioTokenizerPath ?? '').trim();
    if (configuredTok && !codecDir) {
      ttsSvcLog(
        tag,
        '已填写 MOSS-Audio-Tokenizer 路径但目录不存在或不可读，未设置 YIMAN_MOSS_CODEC_DIR；请检查路径并保存设置',
        configuredTok,
      );
    }
    if (codecDir) {
      childEnv.YIMAN_MOSS_CODEC_DIR = codecDir;
      ttsSvcLog(tag, 'MOSS-Audio-Tokenizer → YIMAN_MOSS_CODEC_DIR', codecDir);
    }
  } else if (kind === 'moss_nano') {
    const codecDir = mossNanoAudioTokenizerDirFromEnv();
    const mp = ttsProfiles.moss_tts_nano ?? {};
    const configuredTok = (mp.mossAudioTokenizerPath ?? '').trim();
    if (configuredTok && !codecDir) {
      ttsSvcLog(
        tag,
        '已填写 MOSS-Audio-Tokenizer-Nano 路径但目录不存在或不可读，未设置 YIMAN_MOSS_NANO_CODEC_DIR；请检查路径并保存设置',
        configuredTok,
      );
    }
    if (codecDir) {
      childEnv.YIMAN_MOSS_NANO_CODEC_DIR = codecDir;
      ttsSvcLog(tag, 'MOSS-Audio-Tokenizer-Nano → YIMAN_MOSS_NANO_CODEC_DIR', codecDir);
    }
  }
  const child = spawn(
    resolveYimanEmbeddedPythonExe(),
    [
      resolveYimanTtsMainPy(),
      '--backend',
      kind,
      '--model',
      modelPath,
      '--port',
      String(port),
      '--timeout',
      String(timeoutSec > 0 ? timeoutSec : 999999),
    ],
    { stdio: ['ignore', 'pipe', 'pipe'], env: childEnv },
  );

  if (kind === 'longcat') {
    residentLongcatProc = child;
  } else if (kind === 'moss') {
    residentMossProc = child;
  } else {
    residentMossNanoProc = child;
  }

  return new Promise((resolve) => {
    let buf = '';
    let stderrAcc = '';
    let settled = false;
    const finish = (result: { ok: boolean; message?: string }) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const flushStdoutTail = () => {
      const tail = buf.trim();
      buf = '';
      if (!tail) return;
      try {
        const parsed = JSON.parse(tail) as { event?: string; error?: string; traceback?: string };
        if (parsed.event === 'error') {
          logTtsPythonEvent(parsed, tag);
          if (parsed.traceback) {
            console.error(`[TTS ${tag}] traceback（stdout 尾行）:\n`, parsed.traceback);
          }
        } else {
          ttsSvcLog(tag, 'Python stdout 未换行尾段', tail.slice(0, 400));
        }
      } catch {
        if (tail.length > 0) {
          ttsSvcLog(tag, 'Python stdout 尾段（非 JSON）', tail.slice(0, 600));
        }
      }
    };
    const onData = (chunk: Buffer) => {
      buf += chunk.toString();
      let idx: number;
      while ((idx = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        handleTtsPythonJsonLine(line, tag, (loadTimeS) => {
          resetTtsIdleTimer(kind);
          finish({ ok: true, message: `模型加载耗时 ${loadTimeS}s` });
        });
      }
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', (c) => {
      const chunk = c.toString();
      stderrAcc += chunk;
      const s = chunk.trim();
      if (s) {
        console.error(`[TTS ${tag}][Python stderr]`, s.length > 4000 ? `${s.slice(0, 4000)}…(共 ${s.length} 字)` : s);
      }
    });
    child.on('exit', (code, signal) => {
      flushStdoutTail();
      if (stderrAcc.trim() && code !== 0) {
        const full = stderrAcc.trimEnd();
        console.error(`[TTS ${tag}] Python stderr 汇总（退出码 ${code ?? '?'}）:\n`, full);
        ttsSvcLog(tag, 'stderr 汇总（摘录末 2000 字）', full.slice(-2000));
      }
      const idleKill =
        kind === 'longcat'
          ? ttsLongcatLastExitWasIdleKill
          : kind === 'moss'
            ? ttsMossLastExitWasIdleKill
            : ttsMossNanoLastExitWasIdleKill;
      const reason = idleKill
        ? '原因：Node 侧空闲超时'
        : signal
          ? `signal=${signal}`
          : `code=${code}`;
      ttsSvcLog(tag, `常驻子进程已退出（${reason}），${tag} 不再占用常驻内存`);
      if (kind === 'longcat') {
        ttsLongcatLastExitWasIdleKill = false;
        residentLongcatProc = null;
      } else if (kind === 'moss') {
        ttsMossLastExitWasIdleKill = false;
        residentMossProc = null;
      } else {
        ttsMossNanoLastExitWasIdleKill = false;
        residentMossNanoProc = null;
      }
      const errTail = code !== 0 && stderrAcc.trim() ? stderrAcc.trimEnd().slice(-800) : '';
      finish({
        ok: false,
        message:
          code === 0
            ? '常驻进程已退出'
            : `进程退出 code=${code}${errTail ? ` | stderr 摘录: ${errTail}` : ''}`,
      });
    });
    const READY_MS = 600_000;
    setTimeout(() => {
      const procRef =
        kind === 'longcat'
          ? residentLongcatProc
          : kind === 'moss'
            ? residentMossProc
            : residentMossNanoProc;
      if (!settled && procRef && procRef.exitCode === null) {
        try {
          procRef.kill();
        } catch {
          /* ignore */
        }
        if (kind === 'longcat') {
          residentLongcatProc = null;
        } else if (kind === 'moss') {
          residentMossProc = null;
        } else {
          residentMossNanoProc = null;
        }
        finish({ ok: false, message: `启动超时（>${READY_MS / 60_000} 分钟）` });
      }
    }, READY_MS);
  });
}

// ===== CORS（本地开发页从 localhost:5173 访问 127.0.0.1:19815，需预检与宽松头）=====

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  /** 预检里浏览器会带 Access-Control-Request-Headers；回显或 * 均可放开跨域 */
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Max-Age': '86400',
};

function corsHeadersForRequest(req: http.IncomingMessage): Record<string, string> {
  const requested = req.headers['access-control-request-headers'];
  if (requested && typeof requested === 'string') {
    return { ...CORS_HEADERS, 'Access-Control-Allow-Headers': requested };
  }
  return { ...CORS_HEADERS };
}

function sendOptions(res: http.ServerResponse, req: http.IncomingMessage): void {
  res.writeHead(204, corsHeadersForRequest(req));
  res.end();
}

function sendJson(res: http.ServerResponse, req: http.IncomingMessage, status: number, data: unknown): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    ...corsHeadersForRequest(req),
  });
  res.end(JSON.stringify(data));
}

function sendAudio(res: http.ServerResponse, req: http.IncomingMessage, audioBuffer: Buffer): void {
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Content-Length': String(audioBuffer.length),
    ...corsHeadersForRequest(req),
  });
  res.end(audioBuffer);
}

// ===== HTTP API =====

function parseJsonBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}'));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

export async function startServer(): Promise<void> {
  loadTtsConfig();
  loadSfxConfig();

  const server = http.createServer(async (req, res) => {
    const url = req.url ?? '/';
    const parsed = new URL(url, 'http://localhost');

    if (req.method === 'OPTIONS') {
      sendOptions(res, req);
      return;
    }

    // ===== 通用 =====
    if (req.method === 'GET' && parsed.pathname === '/health') {
      sendJson(res, req, 200, { ok: true });
      return;
    }

    // ===== 抠图 =====
    if (req.method === 'GET' && parsed.pathname === '/matting/models') {
      sendJson(res, req, 200, { models: listMattingModels() });
      return;
    }

    if (req.method === 'POST' && parsed.pathname === '/matting/run') {
      try {
        const body = (await parseJsonBody(req)) as {
          modelId?: string; rgbBase64?: string; width?: number; height?: number; channels?: number;
          options?: Record<string, unknown>;
        };
        const { modelId, rgbBase64, width, height, channels } = body;
        if (!modelId || !rgbBase64 || !width || !height || !channels) {
          sendJson(res, req, 400, { ok: false, error: '缺少参数' });
          return;
        }
        const result = await runMatting(modelId, {
          rgbData: Buffer.from(rgbBase64, 'base64'), width, height, channels, options: body.options,
        });
        if (result.ok) {
          sendJson(res, req, 200, { ok: true, rgbaBase64: result.rgba.toString('base64') });
        } else {
          sendJson(res, req, 200, { ok: false, error: result.message });
        }
      } catch (e) {
        sendJson(res, req, 500, { ok: false, error: `服务异常: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }

    // ===== 本地 TTS REST API =====

    // POST /api/v1/tts/validate-profile — 设置页「测试」用（可不重启服务）
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/validate-profile') {
      try {
        const body = (await parseJsonBody(req)) as { modelKey?: string; profile?: RawProfile };
        const r = await validateLocalTtsProfile(body);
        sendJson(res, req, 200, r);
      } catch (e) {
        sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // POST /api/v1/tts/warm-voice-reference — 有声书批量合成前预热参考音色编码
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/warm-voice-reference') {
      try {
        const body = (await parseJsonBody(req)) as {
          modelKey?: string;
          referenceAudioPath?: string;
          referenceText?: string;
        };
        const modelKey = (body.modelKey ?? '').trim();
        const referenceAudioPath = (body.referenceAudioPath ?? '').trim();
        if (!modelKey || !referenceAudioPath) {
          sendJson(res, req, 400, { ok: false, message: '缺少 modelKey 或 referenceAudioPath' });
          return;
        }
        const r = await warmVoiceReference({
          modelKey,
          referenceAudioPath,
          referenceText:
            typeof body.referenceText === 'string' ? body.referenceText : undefined,
        });
        sendJson(res, req, r.ok ? 200 : 422, r);
      } catch (e) {
        sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // POST /api/v1/tts/invalidate-voice-cache — 清空三端 Python 参考音色内存缓存
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/invalidate-voice-cache') {
      try {
        const body = (await parseJsonBody(req)) as { clearDisk?: boolean };
        await invalidateVoiceCachesOnResidents(body.clearDisk === true);
        sendJson(res, req, 200, { ok: true, message: '已清空参考音色缓存' });
      } catch (e) {
        sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // POST /api/v1/tts/reload-config — 持久化本地 TTS 后热更新（免重启 Electron / ai-server）
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/reload-config') {
      try {
        const body = (await parseJsonBody(req)) as { localTts?: LocalTtsPayload };
        const lt = body.localTts;
        if (!lt || typeof lt !== 'object') {
          sendJson(res, req, 400, { ok: false, message: '缺少 body.localTts' });
          return;
        }
        applyLocalTtsFromPayload(lt, 'TTS 配置已通过 reload-config 热更新');
        process.env.YIMAN_LOCAL_TTS_CONFIG = JSON.stringify(lt);
        await invalidateVoiceCachesOnResidents(false);
        await killResidentTtsForReload('本地 TTS 配置变更');
        sendJson(res, req, 200, { ok: true, message: '已刷新本地 TTS 配置并已结束旧常驻进程' });
      } catch (e) {
        sendJson(res, req, 500, { ok: false, message: e instanceof Error ? e.message : String(e) });
      }
      return;
    }

    // GET /api/v1/tts/MOSS-TTS/health（兼容旧路径 …/MOSS-TTS-Local-MLX/health）
    if (
      req.method === 'GET' &&
      (parsed.pathname === '/api/v1/tts/MOSS-TTS/health' ||
        parsed.pathname === '/api/v1/tts/MOSS-TTS-Local-MLX/health')
    ) {
      ttsSvcLog(MOSS_LABEL, '健康检查被调用（不加载模型、不触发合成）');
      const mossPath = mossResolvedModelPath();
      if (!mossPath) {
        sendJson(res, req, 200, { ok: false, message: 'MOSS 模型目录未配置' });
        return;
      }
      const adapter = new MossTtsLocalMlxAdapter(mossPath);
      const h = await adapter.healthCheck();
      sendJson(res, req, 200, { ok: h.ok, message: h.message });
      return;
    }

    // POST /api/v1/tts/MOSS-TTS（兼容旧路径 …/MOSS-TTS-Local-MLX）
    if (
      req.method === 'POST' &&
      (parsed.pathname === '/api/v1/tts/MOSS-TTS' ||
        parsed.pathname === '/api/v1/tts/MOSS-TTS-Local-MLX')
    ) {
      try {
        const body = (await parseJsonBody(req)) as {
          text?: string;
          speed?: number;
          referenceAudioPath?: string;
          referenceText?: string;
          ref_text?: string;
        };
        const text = (body.text ?? '').trim();
        if (!text) {
          sendJson(res, req, 400, { ok: false, error: 'text is required' });
          return;
        }
        const speed = body.speed ?? 1.0;
        const referenceAudioPath =
          typeof body.referenceAudioPath === 'string' ? body.referenceAudioPath.trim() : '';
        const referenceText =
          (typeof body.referenceText === 'string' ? body.referenceText.trim() : '') ||
          (typeof body.ref_text === 'string' ? body.ref_text.trim() : '');
        const pyBody: Record<string, unknown> = { text, speed };
        if (referenceAudioPath) pyBody.referenceAudioPath = referenceAudioPath;
        if (referenceText) pyBody.referenceText = referenceText;
        ttsSvcLog(MOSS_LABEL, `${MOSS_LABEL} 合成接口被调用`, `文本 ${text.length} 字`);
        const ensureResult = await ensureResidentTtsBackend('moss');
        if (!ensureResult.ok) {
          sendJson(res, req, 503, { ok: false, error: ensureResult.message });
          return;
        }
        const ttsRes = await fetch(`http://127.0.0.1:${TTS_MOSS_PORT}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pyBody),
        });
        if (!ttsRes.ok) {
          const errText = await ttsRes.text().catch(() => '');
          sendJson(res, req, ttsRes.status, { ok: false, error: parseTtsPythonErrorBody(errText) });
          return;
        }
        resetTtsIdleTimer('moss');
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        ttsSvcLog(MOSS_LABEL, `${MOSS_LABEL} 合成完成`, `音频 ${audioBuffer.length} 字节`);
        sendAudio(res, req, audioBuffer);
      } catch (e) {
        sendJson(res, req, 500, { ok: false, error: `TTS 异常: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }

    // GET /api/v1/tts/MOSS-TTS-Nano/health
    if (req.method === 'GET' && parsed.pathname === '/api/v1/tts/MOSS-TTS-Nano/health') {
      ttsSvcLog(MOSS_NANO_LABEL, '健康检查被调用（不加载模型、不触发合成）');
      const nanoPath = mossNanoResolvedModelPath();
      if (!nanoPath) {
        sendJson(res, req, 200, { ok: false, message: 'MOSS-TTS-Nano 模型目录未配置' });
        return;
      }
      const adapter = new MossTtsNanoLocalMlxAdapter(nanoPath);
      const h = await adapter.healthCheck();
      sendJson(res, req, 200, { ok: h.ok, message: h.message });
      return;
    }

    // POST /api/v1/tts/MOSS-TTS-Nano
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/MOSS-TTS-Nano') {
      try {
        const body = (await parseJsonBody(req)) as {
          text?: string;
          speed?: number;
          referenceAudioPath?: string;
        };
        const text = (body.text ?? '').trim();
        if (!text) {
          sendJson(res, req, 400, { ok: false, error: 'text is required' });
          return;
        }
        const referenceAudioPath =
          typeof body.referenceAudioPath === 'string' ? body.referenceAudioPath.trim() : '';
        const pyBody: Record<string, unknown> = { text };
        if (referenceAudioPath) pyBody.referenceAudioPath = referenceAudioPath;
        ttsSvcLog(MOSS_NANO_LABEL, `${MOSS_NANO_LABEL} 合成接口被调用`, `文本 ${text.length} 字`);
        const ensureResult = await ensureResidentTtsBackend('moss_nano');
        if (!ensureResult.ok) {
          sendJson(res, req, 503, { ok: false, error: ensureResult.message });
          return;
        }
        const ttsRes = await fetch(`http://127.0.0.1:${TTS_MOSS_NANO_PORT}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pyBody),
        });
        if (!ttsRes.ok) {
          const errText = await ttsRes.text().catch(() => '');
          sendJson(res, req, ttsRes.status, { ok: false, error: parseTtsPythonErrorBody(errText) });
          return;
        }
        resetTtsIdleTimer('moss_nano');
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        ttsSvcLog(MOSS_NANO_LABEL, `${MOSS_NANO_LABEL} 合成完成`, `音频 ${audioBuffer.length} 字节`);
        sendAudio(res, req, audioBuffer);
      } catch (e) {
        sendJson(res, req, 500, { ok: false, error: `TTS 异常: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }

    // GET /api/v1/tts/LongCat-AudioDiT/health
    if (req.method === 'GET' && parsed.pathname === '/api/v1/tts/LongCat-AudioDiT/health') {
      ttsSvcLog(LC_LABEL, '健康检查被调用（不加载模型、不触发合成）');
      const modelPath = ttsConfig.modelPath;
      if (!modelPath) {
        sendJson(res, req, 200, { ok: false, message: 'TTS 模型未配置' });
        return;
      }
      if (!fs.existsSync(modelPath)) {
        sendJson(res, req, 200, { ok: false, message: `模型目录不存在: ${modelPath}` });
        return;
      }
      if (!yimanEmbeddedPythonReady()) {
        sendJson(res, req, 200, {
          ok: false,
          message:
            '未找到嵌入式 Python（python/env）。请在项目 python 目录创建 venv 并 pip install -r requirements.txt',
        });
        return;
      }
      try {
        const { execSync } = await import('node:child_process');
        execSync(`"${resolveYimanEmbeddedPythonExe()}" --version`, { timeout: 5000 });
      } catch {
        sendJson(res, req, 200, { ok: false, message: '嵌入式 Python 不可用' });
        return;
      }
      sendJson(res, req, 200, { ok: true, message: `模型: ${modelPath} | 空闲超时: ${ttsConfig.idleTimeoutMin ?? 3}分钟` });
      return;
    }

    // POST /api/v1/tts/LongCat-AudioDiT
    if (req.method === 'POST' && parsed.pathname === '/api/v1/tts/LongCat-AudioDiT') {
      try {
        const body = (await parseJsonBody(req)) as {
          text?: string;
          speed?: number;
          referenceAudioPath?: string;
          referenceText?: string;
          ref_text?: string;
        };
        const text = (body.text ?? '').trim();
        if (!text) {
          sendJson(res, req, 400, { ok: false, error: 'text is required' });
          return;
        }

        const speed = body.speed ?? 1.0;
        const referenceAudioPath =
          typeof body.referenceAudioPath === 'string' ? body.referenceAudioPath.trim() : '';
        const referenceText =
          (typeof body.referenceText === 'string' ? body.referenceText.trim() : '') ||
          (typeof body.ref_text === 'string' ? body.ref_text.trim() : '');
        const pyBody: Record<string, unknown> = { text, speed };
        if (referenceAudioPath) pyBody.referenceAudioPath = referenceAudioPath;
        if (referenceText) pyBody.referenceText = referenceText;
        ttsSvcLog(LC_LABEL, `${LC_LABEL} 合成接口被调用`, `文本 ${text.length} 字，speed=${speed}`);

        // 确保常驻服务在运行
        const ensureResult = await ensureResidentTtsBackend('longcat');
        if (!ensureResult.ok) {
          sendJson(res, req, 503, { ok: false, error: ensureResult.message });
          return;
        }

        // 代理到 Python 常驻服务
        const ttsRes = await fetch(`http://127.0.0.1:${TTS_LONGCAT_PORT}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(pyBody),
        });

        if (!ttsRes.ok) {
          const errText = await ttsRes.text().catch(() => '');
          sendJson(res, req, ttsRes.status, { ok: false, error: parseTtsPythonErrorBody(errText) });
          return;
        }

        resetTtsIdleTimer('longcat');
        const audioBuffer = Buffer.from(await ttsRes.arrayBuffer());
        ttsSvcLog(
          LC_LABEL,
          `${LC_LABEL} 合成完成`,
          `音频 ${audioBuffer.length} 字节（模型仍在常驻内存，直至空闲超时）`,
        );
        sendAudio(res, req, audioBuffer);
      } catch (e) {
        sendJson(res, req, 500, { ok: false, error: `TTS 异常: ${e instanceof Error ? e.message : String(e)}` });
      }
      return;
    }

    // ===== 本地音效 REST API =====
    if (await handleSfxHttpRoute(req, res, parsed.pathname, { parseJsonBody, sendJson, sendAudio })) {
      return;
    }

    // ===== CC Proxies（自定义 API 代理） =====
    if (await handlePollinationsProxy(req, res, parsed.pathname)) {
      return;
    }

    sendJson(res, req, 404, { ok: false, error: 'Not Found' });
  });

  server.listen(PORT, '127.0.0.1', () => {
    console.log(JSON.stringify({ ready: true, port: PORT }));
  });

  server.on('error', (e) => {
    console.error('[AI Model Service] 启动失败:', e);
    process.exit(1);
  });
}
