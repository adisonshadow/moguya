/**
 * 解析 MOSS-TTS-Nano 本地权重目录（ModelScope 根目录 / mlx-community 子目录）。
 * 与 python/mlx_nano_model_paths.py 逻辑对齐。
 */
import fs from 'node:fs';
import path from 'node:path';

const NANO_SUBDIR_NAMES = [
  'mlx-int8',
  'mlx',
  'MOSS-TTS-Nano-100M',
  'MOSS-TTS-Nano',
  'openmoss/MOSS-TTS-Nano',
] as const;

export function dirHasMlxNanoWeights(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  const configPath = path.join(dir, 'config.json');
  if (!fs.existsSync(configPath)) return false;
  if (fs.existsSync(path.join(dir, 'model.safetensors'))) return true;
  if (fs.existsSync(path.join(dir, 'model.safetensors.index.json'))) return true;
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.safetensors'));
  } catch {
    return false;
  }
}

function readConfigModelType(dir: string): string {
  try {
    const raw = fs.readFileSync(path.join(dir, 'config.json'), 'utf-8');
    const cfg = JSON.parse(raw) as { model_type?: string };
    return String(cfg.model_type ?? '').toLowerCase();
  } catch {
    return '';
  }
}

/** 有 config 但无 MLX safetensors，多为 ModelScope/HF 原始权重。 */
export function dirLooksHfOnly(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
  if (dirHasMlxNanoWeights(dir)) return false;
  if (fs.existsSync(path.join(dir, 'pytorch_model.bin'))) return true;
  const mt = readConfigModelType(dir);
  if (mt && mt !== 'moss_tts_nano') return true;
  return false;
}

export function resolveMlxNanoModelDir(modelRoot: string): string | null {
  const root = path.resolve(modelRoot.trim());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  if (dirHasMlxNanoWeights(root)) return root;
  for (const name of NANO_SUBDIR_NAMES) {
    const cand = path.join(root, name);
    if (dirHasMlxNanoWeights(cand)) return cand;
  }
  try {
    for (const name of fs.readdirSync(root).sort()) {
      const cand = path.join(root, name);
      if (fs.statSync(cand).isDirectory() && dirHasMlxNanoWeights(cand)) return cand;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export type NanoModelDiagnosis =
  | { ok: true; resolved: string; root: string }
  | { ok: false; kind: 'hf_only' | 'not_found'; root: string; message: string };

const HF_ONLY_MSG =
  '检测到 HuggingFace / ModelScope 原始权重（含 pytorch_model.bin，非 MLX）。' +
  '芝绘本地 Nano 需 mlx-audio 的 MLX 包：请从 Hugging Face 下载 mlx-community/MOSS-TTS-Nano-100M 并指向该目录，' +
  '或将本目录用 mlx-lm 转换后把「模型目录」改为 MLX 输出路径。';

const NOT_FOUND_MSG =
  '未找到含 config.json 与 *.safetensors 的 MLX 权重目录。' +
  '请指向 mlx-community/MOSS-TTS-Nano-100M 解压目录，或 ModelScope 包内已转换的 mlx / mlx-int8 子目录。';

export function diagnoseNanoModelRoot(modelRoot: string): NanoModelDiagnosis {
  const root = path.resolve((modelRoot ?? '').trim());
  const resolved = resolveMlxNanoModelDir(root);
  if (resolved) {
    return { ok: true, resolved, root };
  }
  if (dirLooksHfOnly(root)) {
    return { ok: false, kind: 'hf_only', root, message: HF_ONLY_MSG };
  }
  return { ok: false, kind: 'not_found', root, message: NOT_FOUND_MSG };
}
