/**
 * Lama Cleaner / IOPaint 本地服务：固定 userData 下 venv、端口探测、子进程启动、安装脚本
 * 使用虚拟环境避免 macOS Homebrew Python 的 PEP 668 externally-managed-environment
 */
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { app } from 'electron';
import { httpPing, spawnDetached, openMacPipInstallScript, pipShowWithInterpreter } from './hostedPipPlugin';

export const LAMA_CLEANER_PORT = 9380;

function ensureWritableDir(dir: string): boolean {
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

const LAMA_VENV_DIR_NAME = 'venv-lama-cleaner';

function lamaVenvPythonPath(venvRoot: string): string {
  if (process.platform === 'win32') {
    return path.join(venvRoot, 'Scripts', 'python.exe');
  }
  const p3 = path.join(venvRoot, 'bin', 'python3');
  const p = path.join(venvRoot, 'bin', 'python');
  if (fs.existsSync(p3)) return p3;
  return p;
}

function lamaVenvExists(baseDir: string): boolean {
  return fs.existsSync(lamaVenvPythonPath(path.join(baseDir, LAMA_VENV_DIR_NAME)));
}

/**
 * 优先 userData/yiman；若异常落到 /var/root 或不可写，则回退到 ~/.yiman。
 * 若 venv 仅存在于备用目录（历史安装曾走 fallback），继续沿用该目录，避免误判「需重装」。
 */
function resolveLamaBaseDir(): string {
  const userDataYiman = path.join(app.getPath('userData'), 'yiman');
  const homeFallback = path.join(os.homedir(), '.yiman');

  const userDataOk = !userDataYiman.startsWith('/var/root') && ensureWritableDir(userDataYiman);
  const fallbackOk = ensureWritableDir(homeFallback);

  if (fallbackOk && lamaVenvExists(homeFallback) && !lamaVenvExists(userDataYiman)) {
    return homeFallback;
  }
  if (userDataOk && lamaVenvExists(userDataYiman)) {
    return userDataYiman;
  }
  if (userDataOk) {
    return userDataYiman;
  }
  if (fallbackOk) return homeFallback;
  return userDataYiman;
}

/** venv 根目录 */
export function getLamaVenvRoot(): string {
  return path.join(resolveLamaBaseDir(), LAMA_VENV_DIR_NAME);
}

/** PyTorch 缓存目录（与安装脚本一致，避免 ~/.cache/torch 权限异常导致安装/运行失败） */
function getIopaintTorchHome(): string {
  const candidates = [
    path.join(resolveLamaBaseDir(), 'torch-cache'),
    path.join(app.getPath('userData'), 'yiman', 'torch-cache'),
    path.join(os.tmpdir(), 'yiman-torch-cache'),
  ];
  for (const dir of candidates) {
    if (ensureWritableDir(dir)) return dir;
  }
  return candidates[0]!;
}

/** venv 内 Python 可执行文件（Windows Scripts，Unix bin） */
export function getLamaVenvPythonExecutable(): string {
  return lamaVenvPythonPath(getLamaVenvRoot());
}

export function lamaCleanerBaseUrl(): string {
  return `http://127.0.0.1:${LAMA_CLEANER_PORT}`;
}

export async function isLamaCleanerHealthy(): Promise<boolean> {
  const u = `${lamaCleanerBaseUrl()}/api/v1/server-config`;
  const r = await httpPing(u, 3000);
  return r.ok && r.statusCode >= 200 && r.statusCode < 500;
}

/** IOPaint 官方推荐 Python 3.10；其它小版本易出现依赖 wheel / 构建问题，故仅接受 3.10 */
function isLamaVenvPythonSupported(): boolean {
  const py = getLamaVenvPythonExecutable();
  if (!fs.existsSync(py)) return true;
  try {
    execFileSync(py, [
      '-c',
      'import sys; v=sys.version_info; raise SystemExit(0 if v.major==3 and v.minor==10 else 1)',
    ]);
    return true;
  } catch {
    return false;
  }
}

async function isLamaInstalledInVenv(): Promise<boolean> {
  const py = getLamaVenvPythonExecutable();
  if (!fs.existsSync(py)) return false;
  if (await pipShowWithInterpreter(py, 'lama-cleaner')) return true;
  if (await pipShowWithInterpreter(py, 'iopaint')) return true;
  return false;
}

/** Apple Silicon（darwin + arm64）上 IOPaint 可用 MPS，性能优于 CPU */
function iopaintStartDevice(): 'mps' | 'cpu' {
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mps';
  return 'cpu';
}

/** 使用 venv 内解释器启动 IOPaint */
function startLamaDetached(): boolean {
  const py = getLamaVenvPythonExecutable();
  if (!fs.existsSync(py)) return false;
  const torchHome = getIopaintTorchHome();
  try {
    fs.mkdirSync(torchHome, { recursive: true });
  } catch {
    /* ignore */
  }
  const host = '127.0.0.1';
  const port = String(LAMA_CLEANER_PORT);
  const dev = iopaintStartDevice();
  const args = ['-m', 'iopaint', 'start', '--host', host, '--port', port, '--model', 'lama', '--device', dev];
  const c = spawnDetached(py, args, { TORCH_HOME: torchHome });
  return !!c;
}

async function waitHealthy(maxWaitMs: number, stepMs = 400): Promise<boolean> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    if (await isLamaCleanerHealthy()) return true;
    await new Promise((r) => setTimeout(r, stepMs));
  }
  return isLamaCleanerHealthy();
}

export type LamaEnsureResult =
  | { ok: true; baseUrl: string }
  | { ok: false; needInstall: true }
  | { ok: false; needInstall?: false; error: string };

/** Bash 单引号安全包裹路径 */
function bashSingleQuoted(pathStr: string): string {
  return `'${pathStr.replace(/'/g, `'\"'\"'`)}'`;
}

/**
 * 若服务已就绪则直接返回；否则在 venv 已安装包时后台启动并轮询；
 * venv 不存在或未装包则 needInstall（终端脚本会 python3.10 -m venv + pip install）。
 */
export async function ensureLamaCleanerRunning(): Promise<LamaEnsureResult> {
  if (await isLamaCleanerHealthy()) {
    return { ok: true, baseUrl: lamaCleanerBaseUrl() };
  }
  if (!isLamaVenvPythonSupported()) {
    return { ok: false, needInstall: true };
  }
  const installed = await isLamaInstalledInVenv();
  if (!installed) {
    return { ok: false, needInstall: true };
  }
  const started = startLamaDetached();
  if (!started) {
    return {
      ok: false,
      error: `无法在虚拟环境中启动服务，请检查：${getLamaVenvPythonExecutable()}`,
    };
  }
  const up = await waitHealthy(120_000);
  if (!up) {
    return {
      ok: false,
      error:
        '服务未及时响应（首次运行可能需下载模型）。请查看终端或日志，稍后重试。',
    };
  }
  return { ok: true, baseUrl: lamaCleanerBaseUrl() };
}

/** 打开终端：创建 userData 下 venv、pip 安装、启动（避免系统 pip PEP 668） */
export function openLamaCleanerInstallTerminal(): void {
  const port = String(LAMA_CLEANER_PORT);
  const venvDir = getLamaVenvRoot();
  const quotedVenv = bashSingleQuoted(venvDir);

  openMacPipInstallScript(
    [
      'echo ""',
      'echo ">>> 安装前可在此会话中执行任意 shell（导出环境变量、代理、镜像地址等）"',
      'echo ">>> 每行一条（常用：export FOO=bar）。不需要则直接回车开始创建 venv 与安装"',
      'while IFS= read -r line; do',
      '  [ -z "$line" ] && break',
      '  eval "$line" || echo "!!! 上一行未能执行，请检查语法；继续输入下一行，或空行结束"',
      'done',
      'echo ""',
      'set -e',
      `VENV_DIR=${quotedVenv}`,
      'V_PARENT="$(dirname "$VENV_DIR")"',
      'if ! mkdir -p "$V_PARENT" 2>/dev/null; then',
      '  echo ">>> 父目录无写权限，使用 sudo 创建（可能提示输入本机密码）…"',
      '  sudo mkdir -p "$V_PARENT"',
      'fi',
      'echo ">>> 将目录归属当前用户（修复曾用 root/sudo 创建导致的 Permission denied）…"',
      'sudo chown -R "$(whoami):$(id -gn)" "$V_PARENT"',
      'if [ -e "$VENV_DIR" ]; then',
      '  sudo chown -R "$(whoami):$(id -gn)" "$VENV_DIR" || true',
      'fi',
      'if [ ! -d "$VENV_DIR/bin" ]; then',
      '  echo ">>> 创建虚拟环境（仅使用 python3.10，与 IOPaint 官方建议一致）…"',
      '  if ! command -v python3.10 >/dev/null 2>&1; then',
      '    echo "!!! 未在 PATH 中找到 python3.10。请安装（示例）："',
      '    echo "    brew install python@3.10"',
      '    echo "    brew link python@3.10 --force  # 或把 python3.10 加入 PATH"',
      '    exit 1',
      '  fi',
      '  BOOT_PY="$(command -v python3.10)"',
      '  echo ">>> 使用解释器: $BOOT_PY — $($BOOT_PY -V)"',
      '  "$BOOT_PY" -m venv "$VENV_DIR"',
      'fi',
      'PY="$VENV_DIR/bin/python3"',
      'if [ ! -x "$PY" ]; then PY="$VENV_DIR/bin/python"; fi',
      'if ! "$PY" -c "import sys; v=sys.version_info; raise SystemExit(0 if v.major==3 and v.minor==10 else 1)"; then',
      '  echo ""',
      '  echo "!!! 现有虚拟环境不是 Python 3.10（芝绘仅支持 3.10 跑 IOPaint），请删后重建。"',
      '  echo "!!! 请先关闭本终端窗口，执行下面一行删除旧环境，再在芝绘里重新打开「在终端安装并启动」："',
      '  echo "    rm -rf \"$VENV_DIR\""',
      '  echo ""',
      '  exit 1',
      'fi',
      'echo ">>> 当前 venv Python — $($PY -V)"',
      'export TORCH_HOME="$V_PARENT/torch-cache"',
      'mkdir -p "$TORCH_HOME"',
      'echo ">>> PyTorch 缓存使用 TORCH_HOME=$TORCH_HOME（绕过无权限的 ~/.cache/torch）"',
      'echo ">>> 在虚拟环境中安装 PyTorch（含 macOS MPS）与 IOPaint（原包名 lama-cleaner）…"',
      '"$PY" -m pip install -U pip',
      '"$PY" -m pip install torch torchvision torchaudio',
      '"$PY" -m pip install -U iopaint',
      'IOPAINT_DEVICE=cpu',
      'if [ "$(uname -s)" = "Darwin" ] && [ "$(uname -m)" = "arm64" ]; then IOPAINT_DEVICE=mps; echo ">>> 检测到 Apple Silicon，使用 GPU（MPS）"; fi',
      `echo ">>> 启动服务 http://127.0.0.1:${port}（请保持本窗口打开）…"`,
      `"$PY" -m iopaint start --host 127.0.0.1 --port ${port} --model lama --device "$IOPAINT_DEVICE"`,
    ],
    `Yiman: venv install IOPaint`
  );
}
