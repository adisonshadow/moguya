import { describe, expect, it } from 'vitest';
import { dirHasMlxSfxWeights, resolveMlxSfxModelDir } from './mlxSfxModelPaths';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

describe('mlxSfxModelPaths', () => {
  it('识别含 config 与 safetensors 的目录', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'yiman-sfx-'));
    fs.writeFileSync(path.join(tmp, 'config.json'), '{}');
    fs.writeFileSync(path.join(tmp, 'model.safetensors'), '');
    expect(dirHasMlxSfxWeights(tmp)).toBe(true);
    expect(resolveMlxSfxModelDir(tmp)).toBe(tmp);
  });

  it('解析 mlx-4bit 子目录', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yiman-sfx-root-'));
    const sub = path.join(root, 'mlx-4bit');
    fs.mkdirSync(sub);
    fs.writeFileSync(path.join(sub, 'config.json'), '{}');
    fs.writeFileSync(path.join(sub, 'model.safetensors'), '');
    expect(resolveMlxSfxModelDir(root)).toBe(sub);
  });
});
