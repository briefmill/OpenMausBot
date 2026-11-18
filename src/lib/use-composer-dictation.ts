import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useDesktopCapabilities } from "@/components/DesktopCapabilities";
import { withOpenSettings } from "@/components/OpenSystemSettings";
import { useStoreSelector } from "@/state/store-select";
import { t } from "./i18n";
import { playDictationCue } from "./dictation-cue";
import { composerDictationReady, composerSpeechBridge, recordsClips } from "./speech";

export function useComposerDictation({ draftId, text, onText }: {
  draftId: string;
  text: string;
  onText: (text: string) => void;
}) {
  const { capabilities } = useDesktopCapabilities();
  const config = useStoreSelector((state) => state.config);
  const ready = composerDictationReady(capabilities, config);
  const configNow = useRef(config);
  configNow.current = config;
  const [recording, setRecording] = useState(false);
  const [speechError, setSpeechError] = useState<ReactNode>(null);
  const draft = useRef({ id: draftId, text });
  draft.current = { id: draftId, text };
  const session = useRef({ draftId: "", base: "" });
  const cancel = useRef<((discard?: boolean) => void) | null>(null);
  // Fish Audio hears the clip only at its end, so stopping the mic must finish it.
  const finish = useRef<(() => void) | null>(null);
  const stop = useCallback(() => {
    cancel.current?.();
    setRecording(false);
  }, []);

  useEffect(() => {
    if (!recording) return;
    const bridge = composerSpeechBridge(configNow.current);
    if (!bridge || session.current.draftId !== draftId) {
      setRecording(false);
      return;
    }
    setSpeechError(null);
    const base = session.current.base;
    let lastText = base;
    let active = true;
    const cancelSession = (discard = false) => {
      if (!active) return;
      active = false;
      void bridge.speechStop();
      if (discard && draft.current.id === draftId && draft.current.text === lastText) {
        draft.current.text = base;
        onText(base);
      }
      void playDictationCue(discard ? "cancel" : "finish");
      setRecording(false);
    };
    cancel.current = cancelSession;
    finish.current = recordsClips(bridge) ? () => { void bridge.speechFinish?.(); void playDictationCue("finish"); } : null;
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !active) return;
      event.preventDefault(); event.stopImmediatePropagation(); cancelSession(true);
    };
    window.addEventListener("keydown", escape, true);
    const offTranscript = bridge.onSpeechTranscript((line) => {
      if (!active || draft.current.id !== draftId) return;
      if (draft.current.text !== lastText) {
        cancelSession();
        return;
      }
      if (typeof line.text !== "string" || !line.text.trim()) return;
      lastText = base ? `${base}${/\s$/.test(base) ? "" : " "}${line.text}` : line.text;
      draft.current.text = lastText;
      onText(lastText);
    });
    const offEnd = bridge.onSpeechEnd(({ code, reason, message }) => {
      if (!active || draft.current.id !== draftId) return;
      active = false;
      setRecording(false);
      if (code === 2) {
        setSpeechError(t("composer.dictation.macOnly"));
      } else if (code === 1) {
        // A refused permission comes with a way to the pane that grants it.
        setSpeechError(message ?? (reason === "speech-not-authorized" ? withOpenSettings(t("composer.dictation.permission"), "speech")
          : t(reason === "dictation-disabled" ? "composer.dictation.disabled" : "composer.dictation.failed")));
      }
    });
    const start = () => bridge.speechStart().catch(() => {
      if (!active) return;
      cancelSession();
      setSpeechError(t("composer.dictation.failed"));
    });
    const cue = playDictationCue("start");
    if (cue) void cue.then(() => { if (active) void start(); });
    else void start();
    return () => {
      window.removeEventListener("keydown", escape, true);
      if (cancel.current === cancelSession) cancel.current = null;
      finish.current = null;
      offTranscript();
      offEnd();
      if (active) {
        active = false;
        void bridge.speechStop();
      }
    };
  }, [recording, draftId, onText]);

  const toggle = () => {
    if (!ready || !composerSpeechBridge(config)) {
      setSpeechError(t("composer.dictation.unavailable"));
    } else if (recording) {
      if (finish.current) finish.current();
      else stop();
    } else {
      session.current = { draftId, base: text };
      setRecording(true);
    }
  };
  return { recording, ready, speechError, toggle, stop };
}
