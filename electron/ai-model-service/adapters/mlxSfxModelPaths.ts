/**
 * 解析 MOSS-SoundEffect 本地权重目录（与 python/mlx_sfx_model_paths.py 对齐）。
 */
import fs from 'node:fs';
import path from 'node:path';

const SFX_SUBDIR_NAMES = [
  'mlx-4bit',
  'mlx-int8',
  'mlx',
  'MOSS-SoundEffect-MLX-4bit',
  'MOSS-SoundEffect',
  'openmoss-sound-effect-mlx',
] as const;

export function dirHasMlxSfxWeights(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
  if (fs.existsSync(path.join(dir, 'model.safetensors'))) return true;
  if (fs.existsSync(path.join(dir, 'model.safetensors.index.json'))) return true;
  try {
    return fs.readdirSync(dir).some((f) => f.endsWith('.safetensors'));
  } catch {
    return false;
  }
}

export function dirLooksHfOnlySfx(dir: string): boolean {
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) return false;
  if (!fs.existsSync(path.join(dir, 'config.json'))) return false;
  if (dirHasMlxSfxWeights(dir)) return false;
  return fs.existsSync(path.join(dir, 'pytorch_model.bin'));
}

export function resolveMlxSfxModelDir(modelRoot: string): string | null {
  const root = path.resolve(modelRoot.trim());
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) return null;
  if (dirHasMlxSfxWeights(root)) return root;
  for (const name of SFX_SUBDIR_NAMES) {
    const cand = path.join(root, name);
    if (dirHasMlxSfxWeights(cand)) return cand;
  }
  try {
    for (const name of fs.readdirSync(root).sort()) {
      const cand = path.join(root, name);
      if (fs.statSync(cand).isDirectory() && dirHasMlxSfxWeights(cand)) return cand;
    }
  } catch {
    /* ignore */
  }
  return null;
}

export function diagnoseSfxModelRoot(modelRoot: string): {
  ok: boolean;
  resolved?: string;
  root: string;
  message?: string;
} {
  const root = path.resolve((modelRoot ?? '').trim());
  const resolved = resolveMlxSfxModelDir(root);
  if (resolved) {
    return { ok: true, resolved, root };
  }
  if (dirLooksHfOnlySfx(root)) {
    return {
      ok: false,
      root,
      message:
        '检测到非 MLX 权重。请下载 mlx-community/MOSS-SoundEffect-MLX-4bit 并指向含 safetensors 的目录。',
    };
  }
  return {
    ok: false,
    root,
    message:
      '未找到 MLX 权重（config.json + safetensors）。请指向 MOSS-SoundEffect-MLX-4bit 或其中 mlx-4bit 子目录。',
  };
}
