/**
 * AI 模型配置持久化（见功能文档 3.1、技术文档 3、开发计划 2.3）
 * 存储路径：userData/yiman/ai-settings.json，不提交版本库
 */
import { app } from 'electron';
import path from 'node:path';
import fs from 'node:fs';
import { randomUUID } from 'node:crypto';

export interface AIModelConfig {
  id: string;
  name?: string;
  provider?: string;
  apiUrl: string;
  apiKey: string;
  model?: string;
  modelDisplayName?: string;
  primaryVersion?: string;
  capabilityKeys: string[];
  presetKey?: string;
  isLocal?: boolean;
  /** MiniMax 音色复刻 / 音色设计 API 必填 GroupId */
  minimaxGroupId?: string;
}

export type AIMattingProvider = 'volcengine';

export interface AIMattingConfig {
  id: string;
  name?: string;
  provider: AIMattingProvider;
  accessKeyId: string;
  secretAccessKey: string;
  region?: string;
  enabled?: boolean;
}

/** 本地 TTS 单模型配置（与渲染进程 types/settings 对齐） */
export interface LocalTtsModelProfile {
  modelPath: string;
  idleTimeoutMinutes?: number;
  /** 仅 MOSS：MOSS-Audio-Tokenizer 目录 */
  mossAudioTokenizerPath?: string;
  enabled?: boolean;
}

/** 本地 TTS 配置 */
export interface LocalTtsConfig {
  enabled: boolean;
  modelKey: string;
  profiles: Record<string, LocalTtsModelProfile>;
}

/** 本地音效单模型配置 */
export interface LocalSfxModelProfile {
  modelPath: string;
  idleTimeoutMinutes?: number;
  mossAudioTokenizerPath?: string;
  defaultDurationSeconds?: number;
}

/** 本地音效配置 */
export interface LocalSfxConfig {
  enabled: boolean;
  modelKey: string;
  profiles: Record<string, LocalSfxModelProfile>;
}

function migrateLocalSfxFromDisk(raw: Record<string, unknown> | undefined): LocalSfxConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const modelKey = (typeof raw.modelKey === 'string' ? raw.modelKey : null) ?? 'moss_sound_effect';
  const profiles: Record<string, LocalSfxModelProfile> = {};
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      const row: LocalSfxModelProfile = {
        modelPath: typeof p.modelPath === 'string' ? p.modelPath : '',
        idleTimeoutMinutes: typeof p.idleTimeoutMinutes === 'number' ? p.idleTimeoutMinutes : 3,
        defaultDurationSeconds: typeof p.defaultDurationSeconds === 'number' ? p.defaultDurationSeconds : 6,
      };
      if (typeof p.mossAudioTokenizerPath === 'string' && p.mossAudioTokenizerPath.trim()) {
        row.mossAudioTokenizerPath = p.mossAudioTokenizerPath.trim();
      }
      profiles[k] = row;
    }
  }
  return {
    enabled: raw.enabled === true,
    modelKey,
    profiles,
  };
}

function migrateLocalTtsFromDisk(raw: Record<string, unknown> | undefined): LocalTtsConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const modelKey = (typeof raw.modelKey === 'string' ? raw.modelKey : null) ?? 'longcat_audio_dit';
  const profiles: Record<string, LocalTtsModelProfile> = {};
  if (raw.profiles && typeof raw.profiles === 'object') {
    for (const [k, v] of Object.entries(raw.profiles as Record<string, unknown>)) {
      if (!v || typeof v !== 'object') continue;
      const p = v as Record<string, unknown>;
      const row: LocalTtsModelProfile = {
        modelPath: typeof p.modelPath === 'string' ? p.modelPath : '',
        idleTimeoutMinutes: typeof p.idleTimeoutMinutes === 'number' ? p.idleTimeoutMinutes : 3,
        enabled: p.enabled === true,
      };
      if (
        (k === 'moss_tts' || k === 'moss_tts_local_mlx' || k === 'moss_tts_nano') &&
        typeof p.mossAudioTokenizerPath === 'string' &&
        p.mossAudioTokenizerPath.trim()
      ) {
        row.mossAudioTokenizerPath = p.mossAudioTokenizerPath.trim();
      }
      profiles[k] = row;
    }
  }
  const legacyPath = typeof raw.modelPath === 'string' ? raw.modelPath.trim() : '';
  if (legacyPath && !(profiles[modelKey]?.modelPath ?? '').trim()) {
    profiles[modelKey] = {
      modelPath: legacyPath,
      idleTimeoutMinutes: typeof raw.idleTimeoutMinutes === 'number' ? raw.idleTimeoutMinutes : 3,
      enabled: true,
    };
  }
  if (profiles.moss_tts_local_mlx && !profiles.moss_tts) {
    profiles.moss_tts = profiles.moss_tts_local_mlx;
    delete profiles.moss_tts_local_mlx;
  }
  let resolvedModelKey = modelKey;
  if (resolvedModelKey === 'moss_tts_local_mlx') {
    resolvedModelKey = 'moss_tts';
  }
  return {
    enabled: raw.enabled === true,
    modelKey: resolvedModelKey,
    profiles,
  };
}

export interface NovelWriterConfig {
  coverImageCount: number;
  /** 封面助手：提示词中带「作者 xxx」署名 */
  authorName?: string;
}

function normalizeNovelWriterAuthorName(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const s = raw
    .replace(/[\r\n\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 64);
  return s || undefined;
}

export interface AISettings {
  models: AIModelConfig[];
  aiMattingConfigs?: AIMattingConfig[];
  localTts?: LocalTtsConfig;
  localSfx?: LocalSfxConfig;
  novelWriter?: NovelWriterConfig;
  /** 有声书 */
  audiobook?: {
    voiceSamplesRootDir?: string;
    presetVoiceSamplesRootDir?: string;
    customVoiceSamplesRootDir?: string;
    defaultTtsModelKey?: string;
    savedVoiceSamples?: Array<{
      id: string;
      name: string;
      relativePath: string;
      voiceDescription?: string;
      createdAt: string;
    }>;
  };
  novelBgVideo?: string;
  projectBgVideo?: string;
  audiobookBgVideo?: string;
  toolboxBgVideo?: string;
  defaultProjectRoot?: string;
  canvasAutoFitViewport?: boolean;
  modalMaskBlur?: boolean;
  skills?: unknown[];
  connectors?: unknown[];
}

/** 旧版多模态配置，用于迁移 */
interface LegacyAIModalityConfig {
  provider?: string;
  apiUrl: string;
  apiKey: string;
  model?: string;
}

interface LegacyAISettings {
  text?: LegacyAIModalityConfig;
  image?: LegacyAIModalityConfig;
  video?: LegacyAIModalityConfig;
  audio?: LegacyAIModalityConfig;
}

function defaultModel(): AIModelConfig {
  return {
    id: randomUUID(),
    apiUrl: '',
    apiKey: '',
    capabilityKeys: [],
  };
}

function migrateFromLegacy(parsed: LegacyAISettings): AISettings {
  const models: AIModelConfig[] = [];
  const add = (legacy: LegacyAIModalityConfig | undefined, keys: string[]) => {
    if (!legacy) return;
    models.push({
      id: randomUUID(),
      name: undefined,
      provider: legacy.provider,
      apiUrl: legacy.apiUrl ?? '',
      apiKey: legacy.apiKey ?? '',
      model: legacy.model,
      capabilityKeys: keys,
    });
  };
  add(parsed.text, ['script']);
  add(parsed.image, ['draw']);
  add(parsed.video, ['video']);
  add(parsed.audio, ['voice_over', 'music', 'sound_effect']);
  return { models };
}

function getSettingsPath(): string {
  const userData = app.getPath('userData');
  const dir = path.join(userData, 'yiman');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, 'ai-settings.json');
}

export function loadAISettings(): AISettings {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw);
      // 新版格式：{ models: [...], aiMattingConfigs?: [...] }
      if (Array.isArray(parsed?.models)) {
        const result: AISettings = {
          models: parsed.models.map((m: Partial<AIModelConfig>) => ({
            ...defaultModel(),
            ...m,
            id: m.id || randomUUID(),
            capabilityKeys: Array.isArray(m.capabilityKeys) ? m.capabilityKeys : [],
            isLocal: m.isLocal === true,
            presetKey: m.presetKey,
          })),
        };
        if (Array.isArray(parsed.aiMattingConfigs)) {
          result.aiMattingConfigs = parsed.aiMattingConfigs.map((c: Partial<AIMattingConfig>) => ({
            id: c.id || randomUUID(),
            name: c.name,
            provider: c.provider || 'volcengine',
            accessKeyId: c.accessKeyId ?? '',
            secretAccessKey: c.secretAccessKey ?? '',
            region: c.region ?? 'cn-north-1',
            enabled: c.enabled !== false,
          }));
        }
        if (typeof parsed.defaultProjectRoot === 'string') {
          result.defaultProjectRoot = parsed.defaultProjectRoot;
        }
        if (typeof parsed.canvasAutoFitViewport === 'boolean') {
          result.canvasAutoFitViewport = parsed.canvasAutoFitViewport;
        }
        if (typeof parsed.modalMaskBlur === 'boolean') {
          result.modalMaskBlur = parsed.modalMaskBlur;
        }
        if (parsed.novelWriter && typeof parsed.novelWriter === 'object') {
          const nw = parsed.novelWriter as Record<string, unknown>;
          const coverCount = typeof nw.coverImageCount === 'number' ? nw.coverImageCount : 4;
          const authorName = normalizeNovelWriterAuthorName(nw.authorName);
          const defaultWorkDir =
            typeof nw.defaultWorkDir === 'string' ? nw.defaultWorkDir.trim() : '';
          result.novelWriter = {
            coverImageCount: Math.max(1, Math.min(12, coverCount)),
            ...(authorName ? { authorName } : {}),
            ...(defaultWorkDir ? { defaultWorkDir } : {}),
          };
        }
        if (typeof parsed.novelBgVideo === 'string') {
          result.novelBgVideo = parsed.novelBgVideo;
        }
        if (typeof parsed.projectBgVideo === 'string') {
          result.projectBgVideo = parsed.projectBgVideo;
        }
        if (typeof parsed.audiobookBgVideo === 'string') {
          result.audiobookBgVideo = parsed.audiobookBgVideo;
        }
        if (typeof parsed.toolboxBgVideo === 'string') {
          result.toolboxBgVideo = parsed.toolboxBgVideo;
        }
        if (parsed.localTts && typeof parsed.localTts === 'object') {
          const migrated = migrateLocalTtsFromDisk(parsed.localTts as Record<string, unknown>);
          if (migrated) result.localTts = migrated;
        }
        if (parsed.localSfx && typeof parsed.localSfx === 'object') {
          const migratedSfx = migrateLocalSfxFromDisk(parsed.localSfx as Record<string, unknown>);
          if (migratedSfx) result.localSfx = migratedSfx;
        }
        if (parsed.audiobook && typeof parsed.audiobook === 'object') {
          const ab = parsed.audiobook as Record<string, unknown>;
          const legacyRoot = typeof ab.voiceSamplesRootDir === 'string' ? ab.voiceSamplesRootDir.trim() : '';
          const presetRoot =
            typeof ab.presetVoiceSamplesRootDir === 'string' ?
              ab.presetVoiceSamplesRootDir.trim()
            : legacyRoot;
          const customRoot =
            typeof ab.customVoiceSamplesRootDir === 'string' ?
              ab.customVoiceSamplesRootDir.trim()
            : legacyRoot;
          const defaultTtsModelKey =
            typeof ab.defaultTtsModelKey === 'string' ? ab.defaultTtsModelKey.trim() : '';
          const savedRaw = ab.savedVoiceSamples;
          const savedVoiceSamples =
            Array.isArray(savedRaw) ?
              savedRaw
                .map((x: unknown) => {
                  const o = x as Record<string, unknown>;
                  const id = typeof o.id === 'string' ? o.id.trim() : '';
                  const name = typeof o.name === 'string' ? o.name.trim() : '';
                  const relativePath =
                    typeof o.relativePath === 'string' ? o.relativePath.trim().replace(/\\/g, '/') : '';
                  const createdAt =
                    typeof o.createdAt === 'string' ? o.createdAt.trim() : new Date().toISOString();
                  const voiceDescription =
                    typeof o.voiceDescription === 'string' ? o.voiceDescription.trim() : undefined;
                  if (!id || !name || !relativePath) return null;
                  return { id, name, relativePath, createdAt, voiceDescription };
                })
                .filter((x): x is NonNullable<typeof x> => x != null)
            : [];

          const row: NonNullable<AISettings['audiobook']> = {};
          if (presetRoot) row.presetVoiceSamplesRootDir = presetRoot;
          if (customRoot) row.customVoiceSamplesRootDir = customRoot;
          if (defaultTtsModelKey) row.defaultTtsModelKey = defaultTtsModelKey;
          if (savedVoiceSamples.length > 0) row.savedVoiceSamples = savedVoiceSamples;
          if (Object.keys(row).length > 0) result.audiobook = row;
        }
        if (Array.isArray(parsed.skills)) {
          result.skills = parsed.skills;
        }
        if (Array.isArray(parsed.connectors)) {
          result.connectors = parsed.connectors;
        }
        return result;
      }
      // 旧版格式：{ text, image, video, audio }
      const migrated = migrateFromLegacy(parsed as LegacyAISettings);
      migrated.aiMattingConfigs = Array.isArray(parsed.aiMattingConfigs)
        ? parsed.aiMattingConfigs.map((c: Partial<AIMattingConfig>) => ({
            ...defaultMattingConfig(),
            ...c,
            id: c.id || randomUUID(),
          }))
        : [];
      return migrated;
    }
  } catch (e) {
    console.error('loadAISettings:', e);
  }
  return {
    models: [
      { ...defaultModel(), apiUrl: 'https://api.openai.com/v1', model: 'gpt-3.5-turbo', capabilityKeys: ['script'] },
    ],
    aiMattingConfigs: [],
  };
}

function defaultMattingConfig(): AIMattingConfig {
  return {
    id: randomUUID(),
    provider: 'volcengine',
    accessKeyId: '',
    secretAccessKey: '',
    region: 'cn-north-1',
    enabled: true,
  };
}

export function saveAISettings(data: AISettings): { ok: boolean; error?: string } {
  try {
    const p = getSettingsPath();
    if (fs.existsSync(p)) {
      try {
        fs.copyFileSync(p, `${p}.bak`);
      } catch {
        /* 备份失败不阻断保存 */
      }
    }
    const toSave: AISettings = {
      models: data.models.map((m) => {
        const row: AIModelConfig = {
          id: m.id || randomUUID(),
          name: m.name,
          provider: m.provider,
          apiUrl: m.apiUrl ?? '',
          apiKey: m.apiKey ?? '',
          model: m.model,
          capabilityKeys: Array.isArray(m.capabilityKeys) ? m.capabilityKeys : [],
        };
        if (m.modelDisplayName) row.modelDisplayName = m.modelDisplayName;
        if (m.primaryVersion) row.primaryVersion = m.primaryVersion;
        if (m.presetKey) row.presetKey = m.presetKey;
        if (m.isLocal === true) row.isLocal = true;
        if (m.minimaxGroupId?.trim()) row.minimaxGroupId = m.minimaxGroupId.trim();
        return row;
      }),
      aiMattingConfigs: Array.isArray(data.aiMattingConfigs)
        ? data.aiMattingConfigs.map((c) => ({
            ...defaultMattingConfig(),
            ...c,
            id: c.id || randomUUID(),
            provider: c.provider || 'volcengine',
            accessKeyId: c.accessKeyId ?? '',
            secretAccessKey: c.secretAccessKey ?? '',
            region: c.region ?? 'cn-north-1',
          }))
        : [],
    };
    if (data.localTts) {
      const lt = data.localTts;
      toSave.localTts = {
        enabled: lt.enabled === true,
        modelKey: lt.modelKey ?? 'longcat_audio_dit',
        profiles: lt.profiles && typeof lt.profiles === 'object' ? lt.profiles : {},
      };
    }
    if (data.localSfx) {
      const ls = data.localSfx;
      toSave.localSfx = {
        enabled: ls.enabled === true,
        modelKey: ls.modelKey ?? 'moss_sound_effect',
        profiles: ls.profiles && typeof ls.profiles === 'object' ? ls.profiles : {},
      };
    }
    if (data.defaultProjectRoot !== undefined) {
      toSave.defaultProjectRoot = data.defaultProjectRoot;
    }
    if (data.canvasAutoFitViewport !== undefined) {
      toSave.canvasAutoFitViewport = data.canvasAutoFitViewport;
    }
    if (data.modalMaskBlur !== undefined) {
      toSave.modalMaskBlur = data.modalMaskBlur;
    }
    if (data.novelWriter) {
      const nw = data.novelWriter;
      const authorName = normalizeNovelWriterAuthorName(nw.authorName);
      const defaultWorkDir = (nw.defaultWorkDir ?? '').trim();
      toSave.novelWriter = {
        coverImageCount: Math.max(1, Math.min(12, nw.coverImageCount ?? 4)),
        ...(authorName ? { authorName } : {}),
        ...(defaultWorkDir ? { defaultWorkDir } : {}),
      };
    }
    if (data.novelBgVideo !== undefined) {
      toSave.novelBgVideo = data.novelBgVideo;
    }
    if (data.projectBgVideo !== undefined) {
      toSave.projectBgVideo = data.projectBgVideo;
    }
    if (data.audiobookBgVideo !== undefined) {
      toSave.audiobookBgVideo = data.audiobookBgVideo;
    }
    if (data.toolboxBgVideo !== undefined) {
      toSave.toolboxBgVideo = data.toolboxBgVideo;
    }
    if (data.audiobook && typeof data.audiobook === 'object') {
      const legacyRoot =
        typeof data.audiobook.voiceSamplesRootDir === 'string' ? data.audiobook.voiceSamplesRootDir.trim() : '';
      const presetRoot =
        typeof data.audiobook.presetVoiceSamplesRootDir === 'string' ?
          data.audiobook.presetVoiceSamplesRootDir.trim()
        : legacyRoot;
      const customRoot =
        typeof data.audiobook.customVoiceSamplesRootDir === 'string' ?
          data.audiobook.customVoiceSamplesRootDir.trim()
        : legacyRoot;
      const defaultTtsModelKey =
        typeof data.audiobook.defaultTtsModelKey === 'string' ? data.audiobook.defaultTtsModelKey.trim() : '';
      const sv = Array.isArray(data.audiobook.savedVoiceSamples) ?
        data.audiobook.savedVoiceSamples.map((x) => ({
          id: String(x?.id ?? '').trim(),
          name: String(x?.name ?? '').trim(),
          relativePath: String(x?.relativePath ?? '').trim().replace(/\\/g, '/'),
          voiceDescription:
            typeof x?.voiceDescription === 'string' && x.voiceDescription.trim()
              ? x.voiceDescription.trim()
              : undefined,
          createdAt: String(x?.createdAt ?? '').trim() || new Date().toISOString(),
        }))
      : [];
      const row: NonNullable<AISettings['audiobook']> = {};
      if (presetRoot) row.presetVoiceSamplesRootDir = presetRoot;
      if (customRoot) row.customVoiceSamplesRootDir = customRoot;
      if (defaultTtsModelKey) row.defaultTtsModelKey = defaultTtsModelKey;
      if (sv.length > 0) row.savedVoiceSamples = sv.filter((x) => x.id && x.name && x.relativePath);
      toSave.audiobook = Object.keys(row).length > 0 ? row : {};
    }
    if (Array.isArray(data.skills)) {
      toSave.skills = data.skills;
    }
    if (Array.isArray(data.connectors)) {
      toSave.connectors = data.connectors;
    }
    fs.writeFileSync(p, JSON.stringify(toSave, null, 2), 'utf-8');
    return { ok: true };
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
