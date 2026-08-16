/**
 * 配置订阅上下文（精简版，剥离自芝绘 src/contexts/ConfigContext.tsx）
 * 蘑菇鸭只保留 useConfigSubscribe：加载 AI 设置（模型列表），供抠图面板使用。
 * 已移除 Settings Modal、novel 工作目录、AIChat expert registry、MCP bridge。
 */
import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { AISettings } from '@/types/settings';
import { getAISettings } from '@/utils/settingsStorage';

interface ConfigContextValue {
  config: AISettings | null;
  /** 重新加载配置 */
  refreshConfig: () => Promise<void>;
}

const ConfigContext = createContext<ConfigContextValue | null>(null);

export function ConfigProvider({ children }: { children: React.ReactNode }) {
  const [config, setConfig] = useState<AISettings | null>(null);

  const refreshConfig = useCallback(async () => {
    try {
      const data = await getAISettings();
      setConfig(data);
    } catch (e) {
      console.error('[ConfigContext] refreshConfig 失败', e);
    }
  }, []);

  useEffect(() => {
    refreshConfig();
  }, [refreshConfig]);

  return (
    <ConfigContext.Provider value={{ config, refreshConfig }}>
      {children}
    </ConfigContext.Provider>
  );
}

/** 订阅配置变化，配置保存后自动获取最新值 */
export function useConfigSubscribe(): AISettings | null {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigSubscribe must be used within ConfigProvider');
  return ctx.config;
}

/** 仅读取当前配置 */
export function useConfig() {
  return useConfigSubscribe();
}

/** 获取完整配置上下文（含 refreshConfig） */
export function useConfigContext() {
  const ctx = useContext(ConfigContext);
  if (!ctx) throw new Error('useConfigContext must be used within ConfigProvider');
  return ctx;
}
