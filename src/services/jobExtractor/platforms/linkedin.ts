import { v4 as uuidv4 } from 'uuid';
import { JobDetails, JobPlatform } from '../../../models/JobDetails';
import { JobExtractor, ExtractionError } from '..';

/**
 * Extractor for LinkedIn job postings
 * Supports both linkedin.com/jobs and linkedin.com/in/jobs URLs
 */
export class LinkedInExtractor implements JobExtractor {
  readonly id = 'linkedin';
  readonly name = 'LinkedIn';
  readonly urlPatterns = [
    /^https?:\/\/(www\.)?linkedin\.com\/jobs\/.+/,
    /^https?:\/\/(www\.)?linkedin\.com\/in\/.+\/jobs\/.+/,
  ];

  canExtract(url: string): boolean {
    return this.urlPatterns.some(pattern => pattern.test(url));
  }

  async extract(document: Document): Promise<JobDetails | null> {
    try {
      console.log('Starting LinkedIn extraction for URL:', document.location.href);
      const url = document.location.href;
      
      if (!this.canExtract(url)) {
        throw new ExtractionError(
          'URL does not match LinkedIn job posting pattern',
          this.name,
          url
        );
      }

      // Extract company name
      const company = this.extractCompany(document);
      console.log('Extracted company:', company);
      if (!company) {
        throw new ExtractionError('Could not extract company name', this.name, url);
      }

      // Extract job title
      const title = this.extractTitle(document);
      console.log('Extracted title:', title);
      if (!title) {
        throw new ExtractionError('Could not extract job title', this.name, url);
      }

      // Extract job description
      const description = this.extractDescription(document);
      console.log('Extracted description:', description);
      if (!description) {
        throw new ExtractionError('Could not extract job description', this.name, url);
      }

      const jobDetails: JobDetails = {
        id: uuidv4(),
        url,
        company,
        title,
        description,
        platform: JobPlatform.LINKEDIN,
        extractedAt: new Date(),
        isManual: false,
      };

      if (!this.validate(jobDetails)) {
        throw new ExtractionError('Extracted data failed validation', this.name, url);
      }

      return jobDetails;
    } catch (error) {
      if (error instanceof ExtractionError) {
        throw error;
      }
      throw new ExtractionError(
        `Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        this.name,
        document.location.href
      );
    }
  }

  validate(details: JobDetails): boolean {
    return !!(
      details.company &&
      details.company.length > 0 &&
      details.company.length <= 200 &&
      details.title &&
      details.title.length > 0 &&
      details.title.length <= 200 &&
      details.description &&
      details.description.length >= 10 &&
      details.description.length <= 10000 &&
      details.url &&
      details.platform === JobPlatform.LINKEDIN
    );
  }

  private extractCompany(document: Document): string | null {
    // 优先尝试使用带有业务语义的属性选择器（URL 路径或 aria-label）
    const selectors = [
      'a[href*="/company/"]', // 🌟 新版：任何指向公司主页的链接
      '[aria-label^="Company, "]', // 🌟 新版备用：带有公司标签的区块
      '.jobs-unified-top-card__company-name', // 兼容旧版
      '.job-details-jobs-unified-top-card__company-name',
      '.topcard__org-name-link',
      '.topcard__flavor--target'
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // 如果抓到的是 aria-label (例如 "Company, Bambuser.")，做一下字符串清理
        if (selector === '[aria-label^="Company, "]') {
           const label = element.getAttribute('aria-label');
           if (label) return label.replace('Company, ', '').replace('.', '').trim();
        }
        
        const text = element.textContent?.trim();
        if (text) {
          // 清理多余的空白符和换行
          return text.replace(/\s+/g, ' ');
        }
      }
    }
    return null;
  }

  private extractTitle(document: Document): string | null {
  // 1. 获取所有可能的标题容器
  const containers = document.querySelectorAll('div[data-display-contents="true"] p');
  
  // 2. 定义公司名称（用来排除，防止 title 误抓成公司名）
  const companyName = this.extractCompany(document);

  for (const element of Array.from(containers)) {
    const text = element.textContent?.trim();

    if (text) {
      // 🌟 核心过滤逻辑：
      // 1. 排除掉和公司名完全一样的内容
      // 2. 排除掉 Premium 广告和短字符（如 "Apply", "Save"）
      // 3. 排除掉包含 "Company," 开头的无障碍标签
      if (
        text !== companyName && 
        text.length > 3 && 
        !/Try Premium|SEK 0|LinkedIn Premium|Company,/i.test(text)
      ) {
        console.log('🌟 成功锁定职位标题:', text);
        return text;
      }
    }
  }

  // 3. 兜底逻辑：如果上面的循环没找到，尝试找页面唯一的 h1
  const h1 = document.querySelector('main h1') || document.querySelector('h1');
  const h1Text = h1?.textContent?.trim();
  if (h1Text && !h1Text.includes('Premium')) {
    return h1Text;
  }

  return null;
  }


  private extractDescription(document: Document): string | null {
    // LinkedIn job description is typically in a div with specific classes
    // We prioritize data-testid as it's the most stable against UI updates
    const selectors = [
      '[data-testid="expandable-text-box"]', // 🌟 新版 LinkedIn 的终极稳定选择器
      '.jobs-description__content',          // 兼容之前的版本
      '.job-details-jobs-unified-top-card__job-insight', 
      '.description__text',                  // 更老的版本
      '.show-more-less-html__markup',
      '[class*="job-description"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        // Clone the element to avoid modifying the original DOM
        const clone = element.cloneNode(true) as HTMLElement;
        
        // Replace <br> tags with newlines before extracting text
        const brTags = clone.querySelectorAll('br');
        brTags.forEach(br => {
          br.replaceWith('\n');
        });
        
        // Replace block-level elements with newlines
        const blockElements = clone.querySelectorAll('p, div, li');
        blockElements.forEach(block => {
          // Add newline after each block element
          if (block.nextSibling) {
            block.after('\n');
          }
        });
        
        const text = clone.textContent?.trim();
        if (text) {
          // Normalize whitespace but preserve line breaks
          // Replace multiple spaces/tabs with single space, but keep newlines
          return text
            .replace(/[ \t]+/g, ' ')  // Replace multiple spaces/tabs with single space
            .replace(/\n{3,}/g, '\n\n')  // Replace 3+ newlines with 2 newlines
            .trim();
        }
      }
    }

    return null;
  }

  private extractSkills(document: Document): string[] {
    const skills: string[] = [];
    
    // LinkedIn sometimes shows skill pills or badges
    const skillSelectors = [
      '.job-details-skill-match-status-list__skill',
      '[class*="skill-pill"]',
      '[class*="skill-badge"]',
    ];

    for (const selector of skillSelectors) {
      const elements = document.querySelectorAll(selector);
      elements.forEach(element => {
        const skill = element.textContent?.trim();
        if (skill && !skills.includes(skill)) {
          skills.push(skill);
        }
      });
    }

    return skills;
  }
}
