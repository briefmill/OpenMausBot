export function playDictationCue(kind: "start" | "finish" | "cancel"): Promise<void> | undefined {
  if (typeof AudioContext === "undefined") return;
  try {
    const context = new AudioContext();
    void context.resume().catch(() => {});
    const tone = context.createOscillator();
    const gain = context.createGain();
    tone.type = "sine";
    tone.frequency.setValueAtTime(kind === "start" ? 660 : kind === "finish" ? 440 : 330, context.currentTime);
    gain.gain.setValueAtTime(0.035, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.08);
    tone.connect(gain); gain.connect(context.destination);
    tone.start(); tone.stop(context.currentTime + 0.08);
    return new Promise(resolve => setTimeout(() => { void context.close().catch(() => {}); resolve(); }, 100));
  } catch { return; }
}
