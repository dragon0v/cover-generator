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

  // 🌟 Notion 的基础状态
  const [notionApiKey, setNotionApiKey] = useState('');
  const [notionDbId, setNotionDbId] = useState('');
  const [savingNotion, setSavingNotion] = useState(false);

  // 🌟 Notion 的高级映射状态 (带有默认值)
  const [skillsMapping, setSkillsMapping] = useState('python:Python\njava:Java\n嵌入式:嵌入式\n开发:软件开发');

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

  // 🌟 读取 Chrome Storage 中的 Notion 配置 (加入 as string 修复 TS 报错)
  const loadNotionSettings = () => {
    chrome.storage.sync.get([
      'notionApiKey', 'notionDbId', 'titleCol', 'urlCol', 'remarksCol', 'remarksTemplate', 'skillsMapping'
    ], (result) => {
      if (result.notionApiKey) setNotionApiKey(result.notionApiKey as string);
      if (result.notionDbId) setNotionDbId(result.notionDbId as string);
      if (result.skillsMapping !== undefined) setSkillsMapping(result.skillsMapping as string);
    });
  };

  // 🌟 保存 Notion 配置
  const handleSaveNotion = async () => {
    setSavingNotion(true);
    try {
      await new Promise<void>((resolve) => {
        chrome.storage.sync.set({
          notionApiKey: notionApiKey.trim(),
          notionDbId: notionDbId.trim(),
          skillsMapping: skillsMapping
        }, () => resolve());
      });
      toast.success('Notion settings saved successfully!');
    } catch (err) {
      toast.error('Failed to save Notion settings');
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
      // 🌟 清理数据时顺便把 Notion 所有配置清空，并重置为默认值
      await new Promise<void>((resolve) => chrome.storage.sync.remove([
        'notionApiKey', 'notionDbId', 'titleCol', 'urlCol', 'remarksCol', 'remarksTemplate', 'skillsMapping'
      ], resolve));
      
      setConfig(null);
      setNotionApiKey('');
      setNotionDbId('');
      setSkillsMapping('python:Python\njava:Java\n嵌入式:嵌入式\n开发:软件开发');
      
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

      {/* 🌟 Notion 设置区块 */}
      <Card>
        <CardHeader>
          <CardTitle>Notion Integration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* 基础认证信息 */}
          <div className="space-y-4">
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
          </div>

          {/* 字段映射配置 */}
          <div className="pt-4 border-t border-border space-y-4">
            <h4 className="text-sm font-semibold">Database Mapping (Optional)</h4>
            
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Skills Mapping Dictionary</label>
              <p className="text-[10px] text-muted-foreground leading-tight">
                Format: <code className="bg-muted px-1 rounded">KeywordInJD:NotionTag</code>. One per line. Used to automatically assign tags to the multi-select property.
              </p>
              <textarea 
                value={skillsMapping} 
                onChange={(e) => setSkillsMapping(e.target.value)} 
                rows={4}
                placeholder="python:Python&#10;java:Java"
                className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              />
            </div>
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