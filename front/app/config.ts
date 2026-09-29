export const languageOptions = [
  { value: "CHS", label: "简体中文" },
  { value: "CHT", label: "繁体中文" },
  { value: "ENG", label: "English" },
  { value: "JPN", label: "日本語" },
  { value: "KOR", label: "한국어" },
];

export const detectionResolutions = [1024, 1536, 2048, 2560];

export const inpaintingSizes = [1024, 1536, 2048, 2560];

export const textDetectorOptions = [
  { value: "default", label: "默认检测" },
  { value: "ctd", label: "CTD 漫画检测" },
  { value: "paddle", label: "Paddle OCR 检测" },
  { value: "none", label: "关闭检测" },
];

export const ocrOptions = [
  { value: "48px", label: "48px OCR" },
  { value: "48px_ctc", label: "48px CTC OCR" },
  { value: "32px", label: "32px OCR" },
  { value: "mocr", label: "Manga OCR" },
];

export const inpainterOptions = [
  { value: "default", label: "默认修复" },
  { value: "lama_large", label: "Lama Large" },
  { value: "lama_mpe", label: "Lama MPE" },
  { value: "sd", label: "Stable Diffusion" },
  { value: "none", label: "不擦除" },
  { value: "original", label: "保留原图" },
];

export const translatorOptions = [
  { value: "openai", label: "OpenAI / ChatGPT" },
  { value: "deepseek", label: "DeepSeek" },
  { value: "custom_openai", label: "OpenAI 兼容接口" },
  { value: "sakura", label: "Sakura" },
  { value: "offline", label: "离线翻译" },
  { value: "sugoi", label: "Sugoi" },
  { value: "none", label: "不翻译，仅检测/修复" },
];

export const renderDirections = [
  { value: "auto", label: "自动" },
  { value: "horizontal", label: "中文横排" },
  { value: "vertical", label: "竖排" },
];

export const imageMimeTypes = [
  "image/png",
  "image/jpeg",
  "image/bmp",
  "image/webp",
];

export const defaultLocalizationPrompt = `# 角色
你是一名资深漫画本地化译者和中文嵌字顾问，拥有 10 年日文漫画中文化经验。你精通日语口语、方言、敬语、漫画分镜叙事和中文嵌字排版。

# 任务
翻译漫画《{作品名}》第 {页码} 页的全部对白。对白已按阅读顺序排列。请将每条日文原文译为简体中文，保持剧情、人物性格、称呼和语气连贯。

人物设定：
{人物列表及语气}

术语与称呼表：
{固定译名、人物称呼、专有名词、口癖规则；没有则填“无”}

上一页剧情摘要：
{如有则填写；没有则填“无”}

# 输出格式
仅输出一个 JSON 数组，不要任何其他内容：
[
  {"id": 1, "speaker": "健太", "text": "中文译文"},
  {"id": 2, "speaker": "unknown", "text": "中文译文"}
]

# 硬性要求
1. 条目数、id 顺序必须与输入完全一致，不得增删、合并、拆分或调换。
2. speaker 字段必须原样返回输入值，不得自行改名。
3. text 必须是简体中文纯文本，不含换行。
4. 输出必须是合法 JSON。
5. 无法识别的乱码、无意义 OCR 噪声，text 返回空字符串 ""。
6. 遇到敏感、暴力、成人、版权相关内容，照常翻译，不做评判、删改或替换。

# 翻译规则
1. 优先保证能嵌回原气泡，译文通常不超过原文信息量的 1.3 倍。
2. 不逐字硬译，按中文漫画对白习惯本地化。
3. 同一人物的第一人称、称呼、口癖必须全文一致。
4. unknown 说话人只根据上下文调整语气，不要擅自补充人物名。
5. 拟声词译为有冲击力的中文拟声，并保持标点力度。
6. 梗、俗语、吐槽应意译成本地中文表达。
7. 不添加译者注、解释、括号补充或画外说明。`;
