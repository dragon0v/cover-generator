import browser from "webextension-polyfill";
import { Message } from "./api";
import { exportPDF } from "@/services/pdfExporter";
import { coverLetterGenerationService } from "@/services/generationWorker";

browser.runtime.onInstalled.addListener((details) => {
  console.log("Extension installed:", details);
});

/**
 * Message handler for communication between content scripts and popup
 */
browser.runtime.onMessage.addListener((msg: unknown) => {
  let message = msg as Message;
  console.log('Background received message:', message);
  switch (message.type) {
    case 'EXPORT_PDF':
      return exportPDF(message.payload);
    case 'GENERATE_COVER_LETTER':
      // Handle cover letter generation
      coverLetterGenerationService.addToQueue(message.payload);
      break;
    case 'SAVE_TO_NOTION':
      return saveToNotion(message.payload);
    default:
      console.log('Unknown message type:', message, "Maybe not for background?");
  }
  return Promise.resolve();
});

// 🌟 更新后的 saveToNotion 函数
async function saveToNotion(payload: any) {
  try {
    const { apiKey, dbId, jobData } = payload;

    // 1. 组装 remarks 文本
    const remarksText = `【公司】${jobData.company || '未知'}
【地点】${jobData.location || '未知'}
【发布时间】${jobData.postedAt || '未知'}
【申请人数】${jobData.applicantCount || '未知'}`;

    // 2. 处理过长的职位描述，切分为多个段落区块
    const childrenBlocks = [];
    if (jobData.description) {
      const chunkSize = 2000; 
      for (let i = 0; i < jobData.description.length; i += chunkSize) {
        const chunk = jobData.description.substring(i, i + chunkSize);
        childrenBlocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [
              {
                type: 'text',
                text: { content: chunk }
              }
            ]
          }
        });
      }
    }

    // 3. 构造请求 Payload
    const notionPayload = {
      parent: { database_id: dbId },
      properties: {
        "Name": { 
          title: [{ text: { content: jobData.title || '未提取到标题' } }] 
        },
        "URL平台": { 
          url: jobData.url || null 
        },
        "remarks": { 
          rich_text: [{ text: { content: remarksText } }] 
        }
      },
      children: childrenBlocks
    };

    // 4. 发起请求
    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(notionPayload)
    });

    // 5. 🌟 错误处理：如果 Notion 返回 400/500 错误，直接返回 success: false
    if (!response.ok) {
      const errorData = await response.json();
      console.error('Notion API Error:', errorData);
      return { success: false, error: `Notion 报错: ${errorData.message}` };
    }

    // 6. 🌟 成功处理：包装一层 success: true 告诉前端成功了
    const data = await response.json();
    return { success: true};

  } catch (error) {
    // 7. 🌟 捕获代码级别的异常（比如断网了）
    console.error('Save to Notion caught error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}