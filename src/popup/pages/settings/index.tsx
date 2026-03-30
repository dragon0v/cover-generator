import { useState, useEffect } from 'react';
import { LLMSettings } from './llmSettings';
import { browserStorageService } from '@/infra/storage';
import { llmRegistry } from '@/infra/llm';
import { LLMProviderConfig } from '@/models/LLMProviderConfig';

import { Alert } from '@/popup/components/ui/alert'; 
import { toast } from 'sonner';

import { Button } from '@/popup/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/popup/components/ui/card';

const storageService = browserStorageService;

export default function Settings() {
  const [config, setConfig] = useState<LLMProviderConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [clearLoading, setClearLoading] = useState(false);
  const [clearSuccess, setClearSuccess] = useState(false);

  // 🌟 新增：Notion 的状态
  const [notionApiKey, setNotionApiKey] = useState('');
  const [notionDbId, setNotionDbId] = useState('');
  const [savingNotion, setSavingNotion] = useState(false);

  // Load config on mount
  useEffect(() => {
    loadConfig();
    loadNotionSettings(); // 🌟 加载 Notion 设置
  }, []);

  const loadConfig = async () => {
    try {
      setLoading(true);
      setError(null);
      const loadedConfig = await storageService.loadLLMSettings();
      setConfig(loadedConfig);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings');
      console.error('Failed to load provider config:', err);
    } finally {
      setLoading(false);
    }
  };

  // 🌟 新增：读取 Chrome Storage 中的 Notion 配置
  const loadNotionSettings = () => {
    chrome.storage.sync.get(['notionApiKey', 'notionDbId'], (result) => {
      if (result.notionApiKey) setNotionApiKey(result.notionApiKey);
      if (result.notionDbId) setNotionDbId(result.notionDbId);
    });
  };

  // 🌟 新增：保存 Notion 配置的函数
  const handleSaveNotion = async () => {
    setSavingNotion(true);
    try {
      await new Promise<void>((resolve) => {
        chrome.storage.sync.set({
          notionApiKey: notionApiKey.trim(),
          notionDbId: notionDbId.trim()
        }, () => resolve());
      });
      toast.success('Notion 配置保存成功！');
    } catch (err) {
      toast.error('Notion 配置保存失败');
      console.error(err);
    } finally {
      setSavingNotion(false);
    }
  };

  const handleClearAll = async () => {
    setClearLoading(true);
    setClearSuccess(false);
    setError(null);
    try {
      await storageService.clearAllData();
      // 🌟 清理数据时顺便把 Notion 配置也清空
      await new Promise<void>((resolve) => chrome.storage.sync.remove(['notionApiKey', 'notionDbId'], resolve));
      setConfig(null);
      setNotionApiKey('');
      setNotionDbId('');
      setClearSuccess(true);
      toast.success('All data cleared successfully.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to clear data');
    } finally {
      setClearLoading(false);
    }
  };

  const handleSave = async (newConfig: LLMProviderConfig) => {
    try {
      await storageService.saveLLMSettings(newConfig);
      setConfig(newConfig);
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : 'Failed to save settings');
    }
  };

  const handleValidate = async (configToValidate: LLMProviderConfig): Promise<{ valid: boolean; error?: string }> => {
    try {
      const provider = llmRegistry.get(configToValidate.providerId);
      const providerConfig = {
        apiKey: configToValidate.apiKey,
        endpoint: configToValidate.endpoint,
        model: configToValidate.model,
        temperature: configToValidate.temperature,
        maxTokens: configToValidate.maxTokens,
      };
      const result = await provider.validateConfig(providerConfig);
      return { valid: result.valid, error: result.error };
    } catch (err) {
      return { valid: false, error: err instanceof Error ? err.message : 'Validation failed' };
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <div className="text-muted-foreground">Loading settings...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6 mb-12">
      {error && (
        <Alert variant="destructive">
          <div className="text-sm">{error}</div>
        </Alert>
      )}

      {/* 原有的 LLM 设置区块 */}
      <LLMSettings
        config={config}
        onSave={handleSave}
        onValidate={handleValidate}
      />

      {/* 🌟 新增的 Notion 设置区块 */}
      <Card>
        <CardHeader>
          <CardTitle>Notion Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Notion API Secret
            </label>
            <input
              type="password"
              value={notionApiKey}
              onChange={(e) => setNotionApiKey(e.target.value)}
              placeholder="secret_xxxxxxxxxxxxxxxxx"
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
              Database ID
            </label>
            <input
              type="text"
              value={notionDbId}
              onChange={(e) => setNotionDbId(e.target.value)}
              placeholder="1234567890abcdef..."
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </div>
          <Button
            className="w-full"
            onClick={handleSaveNotion}
            disabled={savingNotion}
          >
            {savingNotion ? 'Saving...' : 'Save Notion Settings'}
          </Button>
        </CardContent>
      </Card>

      {/* 原有的清理数据区块 */}
      <Card className="pt-4 flex justify-end">
        <CardHeader>
          <CardTitle>Data & Privacy</CardTitle>
        </CardHeader>
        <CardContent>
          <Button
            className="w-full"
            variant="destructive"
            onClick={handleClearAll}
            disabled={clearLoading}
          >
            {clearLoading ? 'Clearing...' : 'Clear All Data'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}