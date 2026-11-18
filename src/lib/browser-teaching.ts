const requests = new Map<string, string>();
const listeners = new Set<() => void>();
export const teachingKey = (botId: string, threadId?: string) => `${botId}:${threadId ?? ""}`;
export function requestBrowserTeaching(key: string, request: string): void {
  requests.set(key, request); for (const listener of listeners) listener();
}
export function pendingBrowserTeaching(key: string): string | undefined { return requests.get(key); }
export function clearBrowserTeaching(key: string): void { requests.delete(key); }
export function watchBrowserTeaching(listener: () => void): () => void { listeners.add(listener); return () => { listeners.delete(listener); }; }

export function recordBrowserVideo(canvas: HTMLCanvasElement, onLimit: () => void) {
  if (!canvas.captureStream || typeof MediaRecorder === "undefined") throw new Error("This app cannot record browser video. Update the desktop app or use a current browser.");
  const mimeType = ["video/webm;codecs=vp8", "video/webm"].find((type) => MediaRecorder.isTypeSupported(type));
  if (!mimeType) throw new Error("WebM recording is unavailable on this device.");
  const stream = canvas.captureStream(10);
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 500_000 });
  const chunks: Blob[] = [];
  let bytes = 0;
  const finished = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = ({ data }) => {
      if (data.size) { chunks.push(data); bytes += data.size; if (bytes >= 80 * 1024 * 1024) onLimit(); }
    };
    recorder.onerror = () => reject(new Error("Browser video recording failed."));
    recorder.onstop = () => resolve(new Blob(chunks, { type: mimeType }));
  });
  void finished.catch(() => {});
  recorder.start(1000);
  const timeout = setTimeout(onLimit, 20 * 60_000);
  return { stop: async () => {
    clearTimeout(timeout);
    if (recorder.state !== "inactive") recorder.stop();
    try { return await finished; } finally { for (const track of stream.getTracks()) track.stop(); }
  } };
}
