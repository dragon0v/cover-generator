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

// 🌟 支持动态探测表头的 saveToNotion 函数
async function saveToNotion(payload: any) {
  try {
    const { apiKey, dbId, jobData, matchedSkills } = payload;

    // ==========================================
    // 第一步：先读取 Notion 数据库的表头 (Schema)
    // ==========================================
    const dbResponse = await fetch(`https://api.notion.com/v1/databases/${dbId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28'
      }
    });

    if (!dbResponse.ok) {
      const dbError = await dbResponse.json();
      return { success: false, error: `读取数据库失败: ${dbError.message}` };
    }

    const dbInfo = await dbResponse.json();
    const dbProperties = dbInfo.properties; // 这里包含了数据库所有的列名信息

    // ==========================================
    // 第二步：动态匹配列名并组装 Properties
    // ==========================================
    const pageProperties: any = {};

    // 1. 动态寻找标题列 (Notion 数据库一定有且仅有一个 type 为 'title' 的主键列)
    // 哪怕你的第一列不叫 "Name" 叫 "职位"，它也能自动找到并填入
    let titlePropName = 'Name'; 
    for (const [key, value] of Object.entries(dbProperties)) {
      if ((value as any).type === 'title') {
        titlePropName = key;
        break;
      }
    }
    pageProperties[titlePropName] = {
      title: [{ text: { content: jobData.title || '未提取到标题' } }]
    };

    // 2. 探测 "URL平台" 列是否存在
    if (dbProperties['URL平台']) {
      pageProperties['URL平台'] = {
        url: jobData.url || null
      };
    }

    // 3. 探测 "remarks" 列是否存在
    if (dbProperties['remarks']) {
      const remarksText = `【公司】${jobData.company || '未知'}
【地点】${jobData.location || '未知'}
【发布时间】${jobData.postedAt || '未知'}
【申请人数】${jobData.applicantCount || '未知'}`;

      pageProperties['remarks'] = {
        rich_text: [{ text: { content: remarksText } }]
      };
    }
    
    // 4. 探测 "信息渠道" 列是否存在 (多选类型 multi_select)
    if (dbProperties['信息渠道']) {
      pageProperties['信息渠道'] = {
        multi_select: [
          { name: '领英' } // 注意：多选题必须是一个数组，里面包着带 name 的对象
        ]
      };
    }

    // 5. 处理 "领域&技能点" 多选列
    console.log('in background, matchedSkills:', matchedSkills);
    if (dbProperties['领域&技能点'] && matchedSkills && matchedSkills.length > 0) {
      pageProperties['领域&技能点'] = {
        multi_select: matchedSkills.map((tag: string) => ({ name: tag }))
      };
    }

    // ==========================================
    // 第三步：处理正文 (Description)，并分块避免超长报错
    // ==========================================
    const childrenBlocks = [];
    if (jobData.description) {
      const chunkSize = 2000; 
      for (let i = 0; i < jobData.description.length; i += chunkSize) {
        const chunk = jobData.description.substring(i, i + chunkSize);
        childrenBlocks.push({
          object: 'block',
          type: 'paragraph',
          paragraph: {
            rich_text: [{ type: 'text', text: { content: chunk } }]
          }
        });
      }
    }

    // ==========================================
    // 第四步：发送最终请求，创建页面
    // ==========================================
    const notionPayload = {
      parent: { database_id: dbId },
      properties: pageProperties,
      children: childrenBlocks
    };

    const response = await fetch('https://api.notion.com/v1/pages', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Notion-Version': '2022-06-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(notionPayload)
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Notion API Error:', errorData);
      return { success: false, error: `保存失败: ${errorData.message}` };
    }

    return { success: true };

  } catch (error) {
    console.error('Save to Notion caught error:', error);
    return { 
      success: false, 
      error: error instanceof Error ? error.message : String(error) 
    };
  }
}