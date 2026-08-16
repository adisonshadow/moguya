/**
 * 通用：通过 pip 分发的本地插件宿主（检测安装、打开终端安装脚本、HTTP 探测）
 * 后续其它 pip 插件可复用 pipShow / openMacInstallScript / httpPing
 */
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { shell } from 'electron';

export function httpPing(url: string, timeoutMs = 4000): Promise<{ ok: boolean; statusCode: number }> {
  return new Promise((resolve) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      resolve({ ok: true, statusCode: res.statusCode ?? 0 });
    });
    req.on('error', () => resolve({ ok: false, statusCode: 0 }));
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, statusCode: 0 });
    });
  });
}

export function pipShow(packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile('python3', ['-m', 'pip', 'show', packageName], (err) => resolve(!err));
  });
}

/** 使用指定解释器（如 venv 内 python）检测包是否已安装 */
export function pipShowWithInterpreter(pythonExecutable: string, packageName: string): Promise<boolean> {
  return new Promise((resolve) => {
    execFile(pythonExecutable, ['-m', 'pip', 'show', packageName], (err) => resolve(!err));
  });
}

/** macOS：写入可执行的 .command 并由系统打开（通常进入终端执行） */
export function openMacPipInstallScript(lines: string[], titleComment = 'Yiman plugin install'): void {
  const nl = os.EOL;
  const body = ['#!/bin/bash', `echo "# ${titleComment}"`, ...lines, 'exec bash', ''].join(nl);
  const file = path.join(os.tmpdir(), `yiman-pip-install-${Date.now()}.command`);
  fs.writeFileSync(file, body, { encoding: 'utf8' });
  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* ignore */
  }
  void shell.openPath(file);
}

export function spawnDetached(
  cmd: string,
  args: string[],
  envOverride?: Record<string, string | undefined>
): ChildProcess | null {
  try {
    const env =
      envOverride && Object.keys(envOverride).length > 0
        ? { ...process.env, ...Object.fromEntries(Object.entries(envOverride).filter(([, v]) => v != null)) }
        : process.env;
    const c = spawn(cmd, args, {
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
      env,
    });
    c.unref();
    return c;
  } catch {
    return null;
  }
}
