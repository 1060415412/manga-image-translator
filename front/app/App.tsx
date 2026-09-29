import React, { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@iconify/react";
import JSZip from "jszip";
import { inpainterOptions } from "./config";

type QueueStatus =
  | "queued"
  | "pending"
  | "detection"
  | "ocr"
  | "textline_merge"
  | "mask-generation"
  | "inpainting"
  | "translating"
  | "rendering"
  | "processing"
  | "finished"
  | "error"
  | "cancelled";

type QueueItem = {
  id: string;
  file: File;
  sourceUrl: string;
  resultUrl?: string;
  width: number;
  height: number;
  status: QueueStatus;
  queuePosition?: string;
  error?: string;
};

type InpainterKey = "default" | "lama_large" | "lama_mpe" | "sd" | "none" | "original";
type InpainterStatus = {
  available: boolean;
  requires_model: boolean;
  label: string;
  error?: string;
};

const imageTypes = ["image/png", "image/jpeg", "image/webp", "image/bmp"];
const maxFileSize = 25 * 1024 * 1024;
const llmConfigPath = import.meta.env.VITE_LLM_GPT_CONFIG || "./examples/manga_localization_gpt.yaml";
const llmTranslator = import.meta.env.VITE_LLM_TRANSLATOR || "deepseek";

const statusLabels: Record<QueueStatus, string> = {
  queued: "等待处理",
  pending: "后端排队",
  detection: "文字检测",
  ocr: "OCR 识别",
  textline_merge: "整理文字区域",
  "mask-generation": "生成擦除区域",
  inpainting: "擦除原文",
  translating: "翻译文本",
  rendering: "嵌字渲染",
  processing: "处理中",
  finished: "已完成",
  error: "处理失败",
  cancelled: "已取消",
};

const statusPercent: Record<QueueStatus, number> = {
  queued: 0,
  pending: 5,
  detection: 18,
  ocr: 32,
  textline_merge: 42,
  "mask-generation": 58,
  inpainting: 70,
  translating: 82,
  rendering: 94,
  processing: 10,
  finished: 100,
  error: 100,
  cancelled: 0,
};

function makeId(file: File) {
  return `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2)}`;
}

function readImageSize(sourceUrl: string) {
  return new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = () => reject(new Error("图片无法解码"));
    image.src = sourceUrl;
  });
}

function getApiBase() {
  return (import.meta.env.VITE_API_BASE || "/api").replace(/\/$/, "");
}

function buildConfig(inpainter: InpainterKey) {
  return JSON.stringify({
    detector: { detector: "default", detection_size: 1536, box_threshold: 0.7, unclip_ratio: 2.3 },
    ocr: { ocr: "48px" },
    inpainter: { inpainter, inpainting_size: 2048, inpainting_precision: "bf16" },
    translator: {
      translator: llmTranslator,
      target_lang: "CHS",
      no_text_lang_skip: true,
      gpt_config: llmConfigPath,
    },
    render: {
      direction: "auto",
      alignment: "auto",
      font_size_minimum: -1,
      no_hyphenation: true,
    },
    mask_dilation_offset: 30,
    kernel_size: 3,
  });
}

export const App: React.FC = () => {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [running, setRunning] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [uploadNotice, setUploadNotice] = useState("");
  const [dragging, setDragging] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [inpainter, setInpainter] = useState<InpainterKey>(
    (import.meta.env.VITE_INPAINTER || "none") as InpainterKey,
  );
  const [inpainterStatus, setInpainterStatus] = useState<Record<string, InpainterStatus>>({});
  const preparingRef = useRef(false);
  const abortControllers = useRef<Map<string, AbortController>>(new Map());

  useEffect(() => {
    fetch(`${getApiBase()}/models/inpainters`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`模型状态请求失败（${response.status}）`);
        return response.json() as Promise<Record<string, InpainterStatus>>;
      })
      .then(setInpainterStatus)
      .catch(() => setUploadNotice("无法读取擦除模型状态，已默认使用“不擦除”模式"));
  }, []);

  const selected = items.find((item) => item.id === selectedId) || items[0];
  const finishedCount = items.filter((item) => item.status === "finished").length;
  const failedCount = items.filter((item) => item.status === "error").length;
  const unfinishedCount = items.filter((item) => ["queued", "error", "cancelled"].includes(item.status)).length;

  const addFiles = async (files: File[]) => {
    if (files.length === 0 || preparingRef.current) return;
    preparingRef.current = true;
    setPreparing(true);
    setUploadNotice("");

    const existingKeys = new Set(items.map((item) => `${item.file.name}-${item.file.size}-${item.file.lastModified}`));
    const candidates: QueueItem[] = [];
    const skipped: string[] = [];
    for (const file of files) {
      const fileKey = `${file.name}-${file.size}-${file.lastModified}`;
      if (!imageTypes.includes(file.type)) {
        skipped.push(`${file.name}（格式不支持）`);
        continue;
      }
      if (file.size > maxFileSize) {
        skipped.push(`${file.name}（超过 25 MB）`);
        continue;
      }
      if (existingKeys.has(fileKey)) {
        skipped.push(`${file.name}（重复文件）`);
        continue;
      }
      existingKeys.add(fileKey);

      const sourceUrl = URL.createObjectURL(file);
      try {
        const { width, height } = await readImageSize(sourceUrl);
        candidates.push({ id: makeId(file), file, sourceUrl, width, height, status: "queued" });
      } catch {
        URL.revokeObjectURL(sourceUrl);
        skipped.push(`${file.name}（图片无法解码）`);
      }
    }

    if (candidates.length > 0) {
      setItems((current) => [...current, ...candidates]);
      setSelectedId((current) => current || candidates[0].id);
    }
    if (skipped.length > 0) {
      setUploadNotice(`已加入 ${candidates.length} 张；跳过 ${skipped.length} 张：${skipped.join("、")}`);
    } else {
      setUploadNotice(`已加入 ${candidates.length} 张图片`);
    }
    preparingRef.current = false;
    setPreparing(false);
  };

  const updateItem = (id: string, patch: Partial<QueueItem>) => {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  };

  const removeItem = (id: string) => {
    const item = items.find((entry) => entry.id === id);
    if (!item) return;
    URL.revokeObjectURL(item.sourceUrl);
    if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    setItems((current) => current.filter((entry) => entry.id !== id));
    setSelectedId((current) => (current === id ? undefined : current));
  };

  const clearAll = () => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    items.forEach((item) => {
      URL.revokeObjectURL(item.sourceUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    setItems([]);
    setSelectedId(undefined);
    setRunning(false);
    setUploadNotice("");
    setPreparing(false);
  };

  const processStream = async (item: QueueItem, response: Response) => {
    if (!response.body) throw new Error("后端没有返回流式数据");
    const reader = response.body.getReader();
    let buffer = new Uint8Array();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const combined = new Uint8Array(buffer.length + value.length);
      combined.set(buffer);
      combined.set(value, buffer.length);
      buffer = combined;

      while (buffer.length >= 5) {
        const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
        const payloadLength = view.getUint32(1, false);
        const messageLength = payloadLength + 5;
        if (buffer.length < messageLength) break;

        const code = buffer[0];
        const payload = buffer.slice(5, messageLength);
        if (code === 0) {
          const resultUrl = URL.createObjectURL(new Blob([payload], { type: "image/png" }));
          updateItem(item.id, { status: "finished", resultUrl });
        } else if (code === 1) {
          const stage = new TextDecoder().decode(payload) as QueueStatus;
          if (stage in statusLabels) updateItem(item.id, { status: stage, queuePosition: undefined });
        } else if (code === 2) {
          updateItem(item.id, {
            status: "error",
            error: new TextDecoder().decode(payload) || "后端处理失败",
          });
        } else if (code === 3) {
          updateItem(item.id, { status: "pending", queuePosition: new TextDecoder().decode(payload) });
        } else if (code === 4) {
          updateItem(item.id, { status: "processing", queuePosition: undefined });
        }
        buffer = buffer.slice(messageLength);
      }
    }
  };

  const translateOne = async (item: QueueItem) => {
    const controller = new AbortController();
    abortControllers.current.set(item.id, controller);
    updateItem(item.id, { status: "pending", error: undefined, queuePosition: undefined });

    try {
      const form = new FormData();
      form.append("image", item.file);
      form.append("config", buildConfig(inpainter));
      const response = await fetch(`${getApiBase()}/translate/with-form/image/stream`, {
        method: "POST",
        body: form,
        signal: controller.signal,
      });
      if (!response.ok) {
        let detail = "";
        try {
          const payload = (await response.json()) as { detail?: string };
          detail = payload.detail || "";
        } catch {
          // Keep the HTTP status when the server did not return JSON.
        }
        throw new Error(detail || `后端请求失败（${response.status}）`);
      }
      await processStream(item, response);
    } catch (error) {
      const cancelled = error instanceof DOMException && error.name === "AbortError";
      updateItem(item.id, {
        status: cancelled ? "cancelled" : "error",
        error: cancelled ? undefined : error instanceof Error ? error.message : "未知错误",
      });
    } finally {
      abortControllers.current.delete(item.id);
    }
  };

  const startBatch = async () => {
    if (preparing) return;
    const targets = items.filter((item) => ["queued", "error", "cancelled"].includes(item.status));
    if (targets.length === 0) return;
    setRunning(true);
    for (const item of targets) await translateOne(item);
    setRunning(false);
  };

  const continueBatch = () => {
    if (running || preparing || unfinishedCount === 0) return;
    void startBatch();
  };

  const stopBatch = () => {
    abortControllers.current.forEach((controller) => controller.abort());
    abortControllers.current.clear();
    setRunning(false);
  };

  const download = (item: QueueItem) => {
    if (!item.resultUrl) return;
    const link = document.createElement("a");
    link.href = item.resultUrl;
    link.download = `${item.file.name.replace(/\.[^.]+$/, "")}_zh.png`;
    link.click();
  };

  const completedItems = () => items.filter((item) => item.resultUrl);

  const downloadAll = async () => {
    const results = completedItems();
    if (downloadBusy || results.length === 0) return;
    setDownloadBusy(true);
    try {
      // Trigger downloads serially so the browser does not discard links after its multi-download limit.
      for (const item of results) {
        download(item);
        await new Promise((resolve) => window.setTimeout(resolve, 350));
      }
    } finally {
      setDownloadBusy(false);
    }
  };

  const downloadZip = async () => {
    const results = completedItems();
    if (downloadBusy || results.length === 0) return;
    setDownloadBusy(true);
    try {
      const zip = new JSZip();
      const usedNames = new Set<string>();
      for (const item of results) {
        const response = await fetch(item.resultUrl!);
        if (!response.ok) throw new Error(`无法读取 ${item.file.name} 的译图`);
        const name = `${item.file.name.replace(/\.[^.]+$/, "")}_zh.png`;
        let uniqueName = name;
        let suffix = 2;
        while (usedNames.has(uniqueName)) uniqueName = `${name.replace(/\.png$/, "")}_${suffix++}.png`;
        usedNames.add(uniqueName);
        zip.file(uniqueName, await response.blob());
      }
      const archive = await zip.generateAsync({
        type: "blob",
        compression: "DEFLATE",
        compressionOptions: { level: 6 },
      });
      const url = URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = url;
      link.download = `manga-translations-${new Date().toISOString().slice(0, 10)}.zip`;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (error) {
      setUploadNotice(error instanceof Error ? `压缩包生成失败：${error.message}` : "压缩包生成失败");
    } finally {
      setDownloadBusy(false);
    }
  };

  const progressText = useMemo(() => `${finishedCount}/${items.length} 张完成`, [finishedCount, items.length]);

  return (
    <main className="min-h-screen bg-[#f4f1eb] text-stone-950">
      <header className="border-b border-stone-800 bg-stone-950 text-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-6 px-6 py-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-teal-300">MANGA IMAGE TRANSLATOR</p>
            <h1 className="mt-1 text-2xl font-semibold">漫画批量机翻</h1>
          </div>
          <div className="flex items-center gap-5 text-sm text-stone-300">
            <span>队列 {items.length}</span>
            <span>完成 {finishedCount}</span>
            <span className="text-amber-300">失败 {failedCount}</span>
          </div>
        </div>
      </header>

      <section className="mx-auto grid max-w-7xl gap-6 px-6 py-8 lg:grid-cols-[minmax(340px,0.72fr)_minmax(0,1.28fr)]">
        <Panel title="上传图片" icon="carbon:cloud-upload">
          <div className="mb-4 rounded-md border border-stone-200 bg-stone-50 p-3">
            <label className="flex items-center justify-between gap-3 text-sm font-semibold" htmlFor="inpainter-select">
              <span>原文擦除器</span>
              <select
                id="inpainter-select"
                className="input max-w-[220px]"
                value={inpainter}
                onChange={(event) => setInpainter(event.target.value as InpainterKey)}
              >
                {inpainterOptions.map((option) => {
                  const status = inpainterStatus[option.value];
                  const unavailable = Boolean(status && !status.available && status.requires_model);
                  return <option key={option.value} value={option.value} disabled={unavailable}>{option.label}{unavailable ? "（未下载）" : ""}</option>;
                })}
              </select>
            </label>
            <p className="mt-2 text-xs leading-5 text-stone-500">
              {inpainter === "none"
                ? "不需要额外模型，首次运行即可翻译；会用纯色覆盖原文字区域。"
                : inpainter === "original"
                  ? "保留原图背景，不下载擦除模型。"
                  : inpainterStatus[inpainter]?.available
                    ? "模型已就绪。"
                    : "该擦除器需要额外权重；未下载完成前不可开始翻译。"}
            </p>
          </div>
          <label
            className={`flex min-h-64 cursor-pointer flex-col items-center justify-center rounded-md border-2 border-dashed px-6 text-center transition ${dragging ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-stone-50 hover:border-teal-700 hover:bg-teal-50"}`}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(Array.from(event.dataTransfer.files));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
          >
            <Icon icon="carbon:image-copy" className="h-12 w-12 text-teal-800" />
            <strong className="mt-4 text-base">拖入多张漫画图片</strong>
            <span className="mt-2 text-sm text-stone-500">或点击选择文件，支持 PNG / JPG / WEBP / BMP</span>
            <input className="hidden" type="file" multiple accept={imageTypes.join(",")} onChange={(event) => addFiles(Array.from(event.target.files || []))} />
          </label>
          {uploadNotice && <p className="mt-3 rounded-md bg-stone-100 px-3 py-2 text-xs leading-5 text-stone-600">{uploadNotice}</p>}

          <div className="mt-5 flex flex-wrap gap-3">
            <button className="btn-primary" disabled={running || preparing || items.length === 0} onClick={startBatch}><Icon icon={preparing ? "carbon:hourglass" : "carbon:play-filled"} className="h-4 w-4" />{preparing ? "准备图片中" : "开始批量翻译"}</button>
            <button className="btn-secondary" disabled={running || preparing || unfinishedCount === 0} onClick={continueBatch}><Icon icon={preparing ? "carbon:hourglass" : "carbon:restart"} className="h-4 w-4" />继续翻译未完成（{unfinishedCount}）</button>
            <button className="btn-secondary" disabled={!running} onClick={stopBatch}><Icon icon="carbon:stop-filled" className="h-4 w-4" />停止</button>
            <button className="btn-secondary" disabled={finishedCount === 0 || downloadBusy} onClick={downloadAll}><Icon icon={downloadBusy ? "carbon:hourglass" : "carbon:download"} className="h-4 w-4" />下载全部</button>
            <button className="btn-secondary" disabled={finishedCount === 0 || downloadBusy} onClick={downloadZip}><Icon icon="carbon:archive" className="h-4 w-4" />下载压缩包</button>
            <button className="btn-danger" disabled={running || items.length === 0} onClick={clearAll}><Icon icon="carbon:trash-can" className="h-4 w-4" />清空</button>
          </div>

          <div className="mt-6 flex items-center justify-between border-t border-stone-200 pt-4">
            <span className="text-sm font-semibold">待处理列表</span>
            <span className="text-xs text-stone-500">{progressText}</span>
          </div>
          <div className="mt-3 max-h-[470px] space-y-2 overflow-auto pr-1">
            {items.length === 0 ? <p className="rounded-md bg-stone-50 px-4 py-8 text-center text-sm text-stone-500">还没有上传图片</p> : items.map((item, index) => (
              <button key={item.id} className={`flex w-full items-center gap-3 rounded-md border p-2 text-left transition ${selected?.id === item.id ? "border-teal-700 bg-teal-50" : "border-stone-200 bg-white hover:border-stone-400"}`} onClick={() => setSelectedId(item.id)}>
                <img src={item.sourceUrl} alt="" className="h-14 w-11 rounded object-cover" />
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{index + 1}. {item.file.name}</span><span className="mt-1 block text-xs text-stone-500">{statusLabels[item.status]}{item.queuePosition ? ` #${item.queuePosition}` : ""} · {item.width} × {item.height}</span><span className="mt-1 block h-1 overflow-hidden rounded-full bg-stone-200"><span className="block h-full bg-teal-700 transition-all" style={{ width: `${statusPercent[item.status]}%` }} /></span></span>
                <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${item.status === "finished" ? "bg-emerald-500" : item.status === "error" ? "bg-red-500" : ["detection", "ocr", "textline_merge"].includes(item.status) ? "bg-teal-600" : ["processing", "pending", "translating", "inpainting", "rendering", "mask-generation"].includes(item.status) ? "bg-amber-500" : "bg-stone-300"}`} />
              </button>
            ))}
          </div>
        </Panel>

        <Panel title="翻译结果" icon="carbon:document-view">
          {!selected ? <div className="flex min-h-[640px] items-center justify-center rounded-md border border-stone-200 bg-stone-50 text-sm text-stone-500">上传图片后，译图结果会显示在这里</div> : (
            <div>
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="text-sm font-semibold">{selected.file.name}</h2><p className="mt-1 text-xs text-stone-500">{statusLabels[selected.status]}{selected.error ? ` · ${selected.error}` : ""}</p></div>
                <div className="flex gap-2"><button className="btn-mini" disabled={!selected.resultUrl} onClick={() => download(selected)}><Icon icon="carbon:download" className="h-4 w-4" />下载当前</button><button className="btn-mini" disabled={running} onClick={() => removeItem(selected.id)}><Icon icon="carbon:close" className="h-4 w-4" />移除</button></div>
              </div>
              <div className="grid min-h-[600px] gap-px overflow-hidden rounded-md border border-stone-200 bg-stone-200 md:grid-cols-2"><ResultImage label="原图" src={selected.sourceUrl} /><ResultImage label="译图" src={selected.resultUrl} /></div>
            </div>
          )}
        </Panel>
      </section>
    </main>
  );
};

function Panel({ title, icon, children }: { title: string; icon: string; children: React.ReactNode }) {
  return <section className="rounded-md border border-stone-300 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center gap-2 border-b border-stone-200 pb-4"><Icon icon={icon} className="h-5 w-5 text-teal-800" /><h2 className="text-base font-semibold">{title}</h2></div>{children}</section>;
}

function ResultImage({ label, src }: { label: string; src?: string }) {
  return <div className="flex min-h-[600px] flex-col bg-stone-50"><div className="border-b border-stone-200 bg-white px-3 py-2 text-xs font-semibold text-stone-600">{label}</div>{src ? <img src={src} alt={label} className="min-h-0 flex-1 object-contain" /> : <div className="flex flex-1 items-center justify-center px-6 text-center text-sm text-stone-500">等待后端完成翻译</div>}</div>;
}

export default App;
