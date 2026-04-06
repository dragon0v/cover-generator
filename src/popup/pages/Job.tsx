import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import browser from 'webextension-polyfill';
import { toast } from 'sonner';
import { JobDetails, JobPlatform } from '@/models/JobDetails';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/popup/components/ui/card';
import { Input } from '@/popup/components/ui/input';
import { Label } from '@/popup/components/ui/label';
import { Textarea } from '@/popup/components/ui/textarea';
import { Button } from '@/popup/components/ui/button';
import { Spinner } from '@/popup/components/ui/spinner';
import { Alert, AlertDescription } from '@/popup/components/ui/alert';
import { AlertCircle } from 'lucide-react';
import { api as contentScript } from '@/content/api';
import { api } from '@/background/api';
import { browserStorageService } from '@/infra/storage';
import { createTask } from '@/models/generationTask';
import { SectionInstructions } from '@/services/coverLetterGeneration/prompt';

export default function Job() {
  const [jobDetails, setJobDetails] = useState<JobDetails | null>(null);
  const [company, setCompany] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [isExtracting, setIsExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentUrl, setCurrentUrl] = useState<string>('');
  const [instructions, setInstructions] = useState<SectionInstructions>({});
  
  // 🌟 新增：Notion 保存状态
  const [isSavingNotion, setIsSavingNotion] = useState(false);
  
  const navigate = useNavigate();

  // On mount: get current tab URL and try extract job details
  useEffect(() => {
    browser.tabs.query({ active: true, currentWindow: true })
      .then(tabs => {
        if (tabs[0]?.url) {
          setCurrentUrl(tabs[0].url);
        }
      })
      .catch(err => {
        console.error('[Job] Failed to get current tab:', err);
      });
    // Try extract job details once on mount
    handleExtractJob();
  }, []);

  const handleExtractJob = async () => {
    setIsExtracting(true);
    setError(null);

    try {
      const tabs = await browser.tabs.query({ active: true, currentWindow: true });
      if (!tabs[0]?.id) {
        throw new Error('No active tab found');
      }

      const currentTabUrl = tabs[0].url || '';
      const isSupportedPage = currentTabUrl.includes('linkedin.com/jobs') || 
                              currentTabUrl.includes('arbetsformedlingen.se/platsbanken/annonser');
      
      if (!isSupportedPage) {
        throw new Error('Please navigate to a LinkedIn or Arbetsförmedlingen job posting to extract job details');
      }

      const response = await contentScript.extractJobDetails();
      if (response instanceof Error) {
        setError(response.message);
      } else {
        setJobDetails(response);
        setError(null);
      }
    } catch (err) {
      console.error('[Job] Extraction error:', err);
      setError(
        err instanceof Error
          ? err.message
          : 'Cannot auto-detect job details. Please enter job information manually.'
      );
    } finally {
      setIsExtracting(false);
    }
  };

  const handleUpdate = () => {
    const updated: JobDetails = {
      id: jobDetails?.id || crypto.randomUUID(),
      company,
      title,
      description,
      url: jobDetails?.url || currentUrl || window.location.href,
      platform: jobDetails?.platform || JobPlatform.MANUAL,
      extractedAt: jobDetails?.extractedAt || new Date(),
      isManual: !jobDetails || jobDetails.isManual,
    };

    setJobDetails(updated);
  };

  // Update local state when jobDetails changes (after extraction)
  useEffect(() => {
    if (jobDetails) {
      if (jobDetails.company !== company) setCompany(jobDetails.company);
      if (jobDetails.title !== title) setTitle(jobDetails.title);
      if (jobDetails.description !== description) setDescription(jobDetails.description);
    }
  }, [jobDetails?.id]);

  // 处理保存到 Notion 的逻辑
  const handleSaveToNotion = async () => {
    if (!title.trim()) {
      toast.error('Please ensure Title is filled before saving.');
      return;
    }

    // 使用正则智能清理结尾的 "… more"、"... more" 或 "...more" (忽略大小写)
    const cleanDescription = description
      .trim()
      .replace(/(?:\.\.\.|…)?\s*(?:see|show)?\s*more$/i, '')
      .trim();

    // 整合当前的表单数据和之前提取到的隐藏数据(location, postedAt等)
    const currentJobData = {
      ...jobDetails,
      title,
      company,
      description: cleanDescription,
      url: jobDetails?.url || currentUrl,
    };

    setIsSavingNotion(true);
    const toastId = toast.loading('Saving to Notion...');

    try {
      // 获取用户在 Settings 中填写的 Notion 配置
      const result = await browser.storage.sync.get(['notionApiKey', 'notionDbId', 'skillsMapping']);
      if (!result.notionApiKey || !result.notionDbId) {
        toast.dismiss(toastId);
        toast.error('Notion not configured. Please go to Settings first.');
        return;
      }

      console.log('skillsMapping:', result.skillsMapping); // 调试输出映射关系

      // 🌟 核心匹配算法，允许skillsmapping为空
      const matchedSkills: string[] = [];
      if (result.skillsMapping) {
        const lines = (result.skillsMapping as string).split('\n');
        const lowerJD = description.toLowerCase(); // 转小写匹配，提高命中率

        lines.forEach(line => {
          const [matchWord, notionTag] = line.split(':').map(s => s.trim());
          if (matchWord && notionTag && lowerJD.includes(matchWord.toLowerCase())) {
            // 如果匹配到了，且标签还没在结果里，就加进去
            if (!matchedSkills.includes(notionTag)) {
              matchedSkills.push(notionTag);
            }
          }
        });
      }
      console.log('Matched skills based on mapping:', matchedSkills);

      // 发送消息给 background script
      const response = await browser.runtime.sendMessage({
        type: 'SAVE_TO_NOTION',
        payload: {
          apiKey: result.notionApiKey,
          dbId: result.notionDbId,
          jobData: currentJobData,
          matchedSkills: matchedSkills, // 🌟 传给后台
        },
      })as { success: boolean; error?: string };

      toast.dismiss(toastId);
      if (response && response.success) {
        toast.success('🎉 Successfully saved to Notion!');
      } else {
        toast.error(`Save failed: ${response?.error || 'Unknown error'}`);
      }
    } catch (err) {
      toast.dismiss(toastId);
      toast.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
      console.error('[Job] Save to Notion error:', err);
    } finally {
      setIsSavingNotion(false);
    }
  };

  const handleGenerateCoverLetter = async () => {
    try {
      if (!company.trim() || !title.trim() || !description.trim()) {
        toast.error('Please fill in all required fields');
        return;
      }

      if (!jobDetails) {
        toast.error('Job details not found');
        return;
      }

      const userProfile = await browserStorageService.loadProfile();
      
      if (!userProfile) {
        toast.error('Please create a user profile first');
        return;
      }

      const llmConfig = await browserStorageService.loadLLMSettings();

      const updatedJobDetails: JobDetails = {
        ...jobDetails,
        company,
        title,
        description,
      };

      const task = createTask(userProfile, updatedJobDetails, {
        instructions,
        model: llmConfig?.model,
        temperature: llmConfig?.temperature,
        maxTokens: llmConfig?.maxTokens,
      });

      const result = await api.generateCoverLetter(task);
      
      if (result instanceof Error) {
        toast.error(result.message);
      } else {
        toast.success('Cover letter generation started! Check the Generation tab for progress.');
        navigate('/tasks');
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start generation');
    }
  };

  return (
    <div className="container mx-auto p-4 space-y-6 mb-12">
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Job Details</CardTitle>
          <CardDescription>
            Extract job details from the current page or enter them manually
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          
          {/* 🌟 按钮操作区：改为上下排列 (flex-col)，Notion 按钮在上 */}
          <div className="flex flex-col gap-2">
            
            {/* 1. Save to Notion 按钮放在最上面 */}
            <Button 
              onClick={handleSaveToNotion} 
              disabled={isSavingNotion || !title.trim() || !company.trim()}
              className="w-full bg-black text-white hover:bg-zinc-800"
            >
              {isSavingNotion ? (
                <>
                  <Spinner className="mr-2 h-4 w-4 animate-spin" />
                  Saving...
                </>
              ) : (
                '💾 Save to Notion'
              )}
            </Button>

            {/* 2. Extract 按钮放在下面 */}
            {(currentUrl.includes('linkedin.com/jobs') || 
              currentUrl.includes('arbetsformedlingen.se/platsbanken/annonser')) && (
              <Button 
                onClick={handleExtractJob} 
                disabled={isExtracting}
                className="w-full"
                variant="outline"
              >
                {isExtracting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4 animate-spin" />
                    Extracting...
                  </>
                ) : (
                  'Extract Job'
                )}
              </Button>
            )}
          </div>

          <div className="space-y-2">
            <Label htmlFor="company">
              Company <span className="text-destructive">*</span>
            </Label>
            <Input
              id="company"
              type="text"
              value={company}
              onChange={e => setCompany(e.target.value)}
              onBlur={handleUpdate}
              placeholder="e.g., Google"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="title">
              Job Title <span className="text-destructive">*</span>
            </Label>
            <Input
              id="title"
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              onBlur={handleUpdate}
              placeholder="e.g., Senior Software Engineer"
              maxLength={200}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="description">
              Job Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="description"
              value={description}
              onChange={e => setDescription(e.target.value)}
              onBlur={handleUpdate}
              placeholder="Paste or enter the job description here..."
              rows={8}
              maxLength={10000}
            />
            <p className="text-xs text-muted-foreground text-right">
              {description.length} / 10,000 characters
            </p>
          </div>
        </CardContent>
      </Card>

      {/* 生成指令区块及底部的 Start Generation 按钮保留不变 */}
      <Card>
        <CardHeader>
          <CardTitle>Generation Instructions</CardTitle>
          <CardDescription>
            Customize how the cover letter should be generated (optional)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="opening-instruction">Opening Section</Label>
            <Textarea
              value={instructions.opening || ''}
              onChange={e => setInstructions({ ...instructions, opening: e.target.value })}
              placeholder="e.g., Make it warm and engaging, mentioning why I'm excited about this role"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="about-me-instruction">About Me Section</Label>
            <Textarea
              value={instructions.aboutMe || ''}
              onChange={e => setInstructions({ ...instructions, aboutMe: e.target.value })}
              placeholder="e.g., Highlight 3-4 most relevant experiences, focus on technical achievements"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="why-me-instruction">Why Me Section</Label>
            <Textarea
              value={instructions.whyMe || ''}
              onChange={e => setInstructions({ ...instructions, whyMe: e.target.value })}
              placeholder="e.g., Emphasize problem-solving skills and leadership experience"
              rows={3}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="why-company-instruction">Why Company Section</Label>
            <Textarea
              value={instructions.whyCompany || ''}
              onChange={e => setInstructions({ ...instructions, whyCompany: e.target.value })}
              placeholder="e.g., Research their recent projects and mention what excites you about them"
              rows={3}
            />
          </div>

          <div className="text-xs text-muted-foreground">
            <p>💡 Tip: Leave sections blank to use the default generation approach</p>
          </div>
        </CardContent>
      </Card>

      <Button 
        onClick={handleGenerateCoverLetter}
        disabled={!company.trim() || !title.trim() || !description.trim()}
        className="w-full"
      >
        Start Cover Letter Generation
      </Button>
    </div>
  );
}