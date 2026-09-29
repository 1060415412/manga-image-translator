# 漫画中文本地化教程

## 1. 环境准备

建议使用 Python 3.11，并准备 Node.js 20 或更高版本。

```powershell
cd C:\manga-image-translator

# 前端依赖
cd front
npm install
cd ..
```

后端依赖应安装在项目使用的 Python 虚拟环境中：

```powershell
C:\manga-image-translator-deps\venv\Scripts\python.exe -m pip install -r requirements.txt
```

首次使用检测、OCR、翻译和擦除模型时可能会下载模型权重。若暂时不需要额外擦除模型，前端选择“不擦除”，可避免下载 Lama 或 Stable Diffusion 权重。

## 2. 配置翻译器

不要把 API 密钥直接写进源码或提交到 GitHub。复制环境变量模板并在本机配置：

```powershell
Copy-Item .env.example .env
```

DeepSeek 配置至少需要：

```text
DEEPSEEK_API_KEY=你的密钥
DEEPSEEK_API_BASE=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

前端的 `front/.env` 只保存本地开发配置，也不要提交真实密钥。

## 3. 启动服务

后端会在 `8000` 启动 FastAPI，并自动启动内部翻译实例 `8001`：

```powershell
cd C:\manga-image-translator
C:\manga-image-translator-deps\venv\Scripts\python.exe server\main.py --host 127.0.0.1 --port 8000 --verbose
```

另开一个终端启动前端：

```powershell
cd C:\manga-image-translator\front
npm run dev -- --host 127.0.0.1
```

打开 <http://127.0.0.1:5173/>。

## 4. 批量翻译

1. 在上传区域选择多张 PNG、JPG、WEBP 或 BMP 图片。
2. 选择原文擦除器。首次运行建议使用“不擦除”验证整体流程。
3. 点击“开始批量翻译”。
4. 翻译过程中可以点击“停止”。
5. 任务中有失败或未完成图片时，点击“继续翻译未完成”，已完成图片不会重复处理。
6. 可下载单张图片、全部图片，或下载包含所有完成结果的 ZIP 压缩包。

## 5. 常见问题

### 内部服务返回 429

确保只启动一个 FastAPI 主服务，并让它自动管理一个内部翻译实例。不要另外重复启动同一端口的 `shared` 实例。

### 擦除模型下载失败

切换到“不擦除”或“保留原图”。Lama 和 Stable Diffusion 需要额外模型权重，并且首次下载依赖网络。

### DeepSeek 请求失败

检查本机的 `DEEPSEEK_API_KEY`、API 地址、模型名称和网络连接。不要在浏览器、截图、日志或公开仓库中展示密钥。

### 前端无法访问后端

确认 `8000` 正常监听，并检查 `front/.env` 中的 API 地址配置。前端开发服务器默认使用 `5173`。

## 6. 本地化提示词

本项目提供了可复用的中文漫画本地化提示词：

`examples/manga_localization_gpt.yaml`

它要求译文保持条目数量、编号、说话人字段和阅读顺序不变，并限制译文长度，便于嵌字回气泡。
