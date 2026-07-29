import {
  Activity,
  ArrowDownToLine,
  AudioLines,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleStop,
  FileAudio,
  FileUp,
  Gauge,
  Headphones,
  Info,
  Mic,
  MicOff,
  Music2,
  Pause,
  Play,
  RefreshCcw,
  Settings2,
  SlidersHorizontal,
  Sparkles,
  SquarePen,
  Target,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ascendingScale from "./data/ascending-scale.json";
import emptySong from "./data/empty-song.json";
import { localize, useI18n } from "./i18n";
import { createEmptyScore } from "./lib/composer";
import { saveBlob } from "./lib/download";
import { centsBetweenFrequency, clampCents, frequencyToMidi, midiToFrequency, midiToNoteName, numeralForMidi, referenceHzForAnchor, signed } from "./lib/music";
import { analyzeAudioFile, detectPitchYin } from "./lib/pitch";
import { buildSessionResult, noteAtSeconds, parseScoreFile, scoreDurationSeconds, validateScore } from "./lib/score";
import ScoreEditor from "./ScoreEditor";
import type { AnalysisFrame, PitchReading, PitchScore, PracticeMode, SessionResult } from "./types";

const BUILT_IN_SCORES = [validateScore(ascendingScale), validateScore(emptySong)];
type TolerancePreset = "relaxed" | "standard" | "strict" | "custom";
const TOLERANCE_VALUES: Record<Exclude<TolerancePreset, "custom">, number> = {
  relaxed: 60,
  standard: 35,
  strict: 20,
};

type CaptureStatus = "idle" | "requesting" | "listening" | "error";
interface TonicCalibration {
  firstScoreMidi: number;
  targetMidi: number;
  frequency: number;
}

function findPitchedIndex(score: PitchScore, from: number, direction: 1 | -1): number {
  for (let index = from; index >= 0 && index < score.notes.length; index += direction) {
    if (score.notes[index].midi !== null) return index;
  }
  return -1;
}

function scoreDisplayText(score: PitchScore, locale: "zh-CN" | "en"): { title: string; description: string } {
  if (score.metadata.id === "ascending-c-major-scale") {
    return locale === "zh-CN"
      ? { title: "从低到高 · C 大调音阶", description: "从中央 C 唱到高音 C，适合热身和熟悉实时音准反馈。" }
      : { title: "Ascending · C major scale", description: "Sing from middle C to high C to warm up and learn the live pitch display." };
  }
  if (score.metadata.id === "empty-song-template") {
    return locale === "zh-CN"
      ? { title: "我的第二首曲目", description: "空白曲目模板：导入曲谱或在编辑器里开始打谱。" }
      : { title: "My Second Song", description: "Blank template: import a score or start composing in the editor." };
  }
  return { title: score.metadata.title, description: score.metadata.description ?? "" };
}

function App() {
  const { locale, setLocale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const [scores, setScores] = useState<PitchScore[]>(BUILT_IN_SCORES);
  const [selectedId, setSelectedId] = useState(BUILT_IN_SCORES[0].metadata.id);
  const [mode, setMode] = useState<PracticeMode>("step");
  const [transpose, setTranspose] = useState(0);
  const [referenceHz, setReferenceHz] = useState(440);
  const [practiceBpm, setPracticeBpm] = useState(BUILT_IN_SCORES[0].tempo.bpm);
  const [tonicCalibration, setTonicCalibration] = useState<TonicCalibration | null>(null);
  const [toleranceCents, setToleranceCents] = useState(35);
  const [tolerancePreset, setTolerancePreset] = useState<TolerancePreset>("standard");
  const [holdGoalMs, setHoldGoalMs] = useState(650);
  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("idle");
  const [captureError, setCaptureError] = useState("");
  const [reading, setReading] = useState<PitchReading | null>(null);
  const [active, setActive] = useState(false);
  const [playhead, setPlayhead] = useState(0);
  const [stepIndex, setStepIndex] = useState(0);
  const [stableMs, setStableMs] = useState(0);
  const [sessionResult, setSessionResult] = useState<SessionResult | null>(null);
  const [recordingUrl, setRecordingUrl] = useState("");
  const [recordingName, setRecordingName] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [showSettings, setShowSettings] = useState(false);
  const [editorSeed, setEditorSeed] = useState<PitchScore | null>(null);

  const scoreInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const detectorFrameRef = useRef<number | null>(null);
  const practiceFrameRef = useRef<number | null>(null);
  const sessionStartRef = useRef(0);
  const sessionFramesRef = useRef<AnalysisFrame[]>([]);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);
  const lastReadingAtRef = useRef(0);
  const stableMsRef = useRef(0);
  const activeRef = useRef(active);
  const modeRef = useRef(mode);
  const referenceHzRef = useRef(referenceHz);

  const selectedScore = useMemo(
    () => scores.find((candidate) => candidate.metadata.id === selectedId) ?? scores[0],
    [scores, selectedId],
  );
  const effectiveReferenceHz = tonicCalibration
    ? referenceHzForAnchor(tonicCalibration.frequency, tonicCalibration.targetMidi)
    : referenceHz;
  const practiceScore = useMemo(
    () => ({ ...selectedScore, tempo: { bpm: practiceBpm } }),
    [practiceBpm, selectedScore],
  );
  const selectedDisplay = scoreDisplayText(selectedScore, locale);
  const modeCopy: Record<PracticeMode, { label: string; short: string; detail: string }> = {
    step: {
      label: tr("逐音校准", "Note by note"),
      short: tr("不计时值，唱准后自动前进", "No timing; advance after holding pitch"),
      detail: tr("只练音高，不追拍点。适合慢速拆解难句。", "Pitch only, without rhythm scoring. Best for isolating difficult phrases."),
    },
    continuous: {
      label: tr("连续跟唱", "Live follow"),
      short: tr("跟时间线唱，实时看偏差", "Follow the timeline with live feedback"),
      detail: tr("音高与时值同时判断，过程中始终显示实时 cents，像 KTV 一样边唱边改。", "Scores pitch and timing while always showing live cents, so you can correct yourself as you sing."),
    },
    review: {
      label: tr("整曲复盘", "Full-take review"),
      short: tr("专注唱完，再看逐音报告", "Sing first, inspect the report afterward"),
      detail: tr("录制完整一遍，演唱时隐藏 cents，结束后给出逐音报告并保留本机录音。", "Records a full take and hides cents while singing, then shows a note-by-note report and local recording."),
    },
  };
  const totalDuration = scoreDurationSeconds(practiceScore);
  const activeIndex = mode === "step"
    ? Math.min(stepIndex, Math.max(0, selectedScore.notes.length - 1))
    : noteAtSeconds(practiceScore, playhead)?.index ?? -1;
  const activeNote = activeIndex >= 0 ? selectedScore.notes[activeIndex] : null;
  const targetMidi = activeNote?.midi === null || activeNote?.midi === undefined
    ? null
    : activeNote.midi + transpose;
  const targetFrequency = targetMidi === null ? null : midiToFrequency(targetMidi, effectiveReferenceHz);
  const liveCents = reading && targetMidi !== null
    ? centsBetweenFrequency(reading.frequency, targetMidi, effectiveReferenceHz)
    : null;
  const isInTune = liveCents !== null && Math.abs(liveCents) <= toleranceCents;
  const progress = mode === "step"
    ? (selectedScore.notes.length ? (stepIndex + Math.min(1, stableMs / holdGoalMs)) / selectedScore.notes.length : 0)
    : (totalDuration ? playhead / totalDuration : 0);

  useEffect(() => {
    activeRef.current = active;
  }, [active]);
  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);
  useEffect(() => {
    referenceHzRef.current = effectiveReferenceHz;
  }, [effectiveReferenceHz]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!active || !reading || modeRef.current !== "step" || targetMidi === null) return;
    const delta = lastReadingAtRef.current ? Math.min(80, reading.capturedAt - lastReadingAtRef.current) : 0;
    lastReadingAtRef.current = reading.capturedAt;
    const cents = centsBetweenFrequency(reading.frequency, targetMidi, effectiveReferenceHz);
    const nextStable = Math.abs(cents) <= toleranceCents && reading.confidence >= 0.6
      ? stableMsRef.current + delta
      : Math.max(0, stableMsRef.current - delta * 1.5);
    stableMsRef.current = nextStable;
    setStableMs(nextStable);
    if (nextStable >= holdGoalMs) {
      stableMsRef.current = 0;
      setStableMs(0);
      const nextIndex = findPitchedIndex(selectedScore, stepIndex + 1, 1);
      if (nextIndex < 0) {
        setActive(false);
        setToast(tr("逐音练习完成，很稳！", "Note-by-note practice complete. Nicely controlled."));
      } else {
        setStepIndex(nextIndex);
      }
    }
  }, [active, effectiveReferenceHz, holdGoalMs, locale, reading, selectedScore.notes.length, stepIndex, targetMidi, toleranceCents]);

  useEffect(() => {
    return () => {
      if (detectorFrameRef.current) cancelAnimationFrame(detectorFrameRef.current);
      if (practiceFrameRef.current) cancelAnimationFrame(practiceFrameRef.current);
      streamRef.current?.getTracks().forEach((track) => track.stop());
      void audioContextRef.current?.close();
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
    };
  }, [recordingUrl]);

  async function ensureMicrophone(): Promise<MediaStream> {
    if (streamRef.current?.active) return streamRef.current;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCaptureStatus("error");
      setCaptureError(tr("当前系统不支持麦克风访问", "Microphone access is unavailable on this system."));
      throw new Error("Microphone API unavailable");
    }
    setCaptureStatus("requesting");
    setCaptureError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          channelCount: 1,
        },
      });
      const context = new AudioContext();
      await context.resume();
      const analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      analyser.smoothingTimeConstant = 0;
      context.createMediaStreamSource(stream).connect(analyser);
      streamRef.current = stream;
      audioContextRef.current = context;
      analyserRef.current = analyser;
      setCaptureStatus("listening");

      const buffer = new Float32Array(analyser.fftSize);
      const detect = () => {
        if (!analyserRef.current || !audioContextRef.current) return;
        analyserRef.current.getFloatTimeDomainData(buffer);
        const detected = detectPitchYin(buffer, audioContextRef.current.sampleRate);
        const now = performance.now();
        if (detected) {
          const midi = frequencyToMidi(detected.frequency, referenceHzRef.current);
          const nextReading: PitchReading = {
            frequency: detected.frequency,
            midi,
            noteName: midiToNoteName(midi),
            confidence: detected.confidence,
            levelDb: 20 * Math.log10(Math.max(detected.rms, 0.00001)),
            capturedAt: now,
          };
          setReading(nextReading);
          if (activeRef.current && modeRef.current !== "step") {
            sessionFramesRef.current.push({
              time: Math.max(0, (now - sessionStartRef.current) / 1000),
              frequency: detected.frequency,
              midi,
              confidence: detected.confidence,
            });
          }
        } else {
          setReading(null);
        }
        detectorFrameRef.current = requestAnimationFrame(detect);
      };
      detectorFrameRef.current = requestAnimationFrame(detect);
      return stream;
    } catch (error) {
      setCaptureStatus("error");
      setCaptureError(error instanceof DOMException && error.name === "NotAllowedError"
        ? tr("麦克风权限被拒绝，请在系统设置中允许 SingRight 使用麦克风", "Microphone permission was denied. Allow SingRight in system settings.")
        : tr("无法打开麦克风，请检查输入设备", "Could not open the microphone. Check your input device."));
      throw error;
    }
  }

  async function stopMicrophone() {
    if (active) stopPractice(false);
    if (detectorFrameRef.current) cancelAnimationFrame(detectorFrameRef.current);
    detectorFrameRef.current = null;
    analyserRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    await audioContextRef.current?.close();
    audioContextRef.current = null;
    analyserRef.current = null;
    setReading(null);
    setCaptureStatus("idle");
  }

  function beginRecorder(stream: MediaStream) {
    if (!("MediaRecorder" in window)) return;
    recorderChunksRef.current = [];
    const preferredMime = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((mime) => MediaRecorder.isTypeSupported(mime));
    const recorder = new MediaRecorder(stream, preferredMime ? { mimeType: preferredMime } : undefined);
    recorder.ondataavailable = (event) => {
      if (event.data.size) recorderChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      const blob = new Blob(recorderChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      setRecordingUrl(URL.createObjectURL(blob));
      const extension = recorder.mimeType.includes("mp4") ? "m4a" : "webm";
      setRecordingName(`SingRight-${new Date().toISOString().slice(0, 19).replaceAll(":", "-")}.${extension}`);
    };
    recorder.start(500);
    recorderRef.current = recorder;
  }

  async function startPractice() {
    if (selectedScore.notes.length === 0) {
      setToast(tr("这是空白曲目，请先导入曲谱", "This score is blank. Import or create a score first."));
      scoreInputRef.current?.click();
      return;
    }
    const stream = await ensureMicrophone();
    setSessionResult(null);
    setPlayhead(0);
    setStepIndex(Math.max(0, findPitchedIndex(selectedScore, 0, 1)));
    setStableMs(0);
    stableMsRef.current = 0;
    lastReadingAtRef.current = 0;
    sessionFramesRef.current = [];
    setActive(true);
    activeRef.current = true;

    if (mode !== "step") {
      sessionStartRef.current = performance.now();
      if (mode === "review") beginRecorder(stream);
      const tick = () => {
        if (!activeRef.current || modeRef.current === "step") return;
        const elapsed = (performance.now() - sessionStartRef.current) / 1000;
        setPlayhead(Math.min(elapsed, totalDuration));
        if (elapsed >= totalDuration) {
          stopPractice(true);
          return;
        }
        practiceFrameRef.current = requestAnimationFrame(tick);
      };
      practiceFrameRef.current = requestAnimationFrame(tick);
    }
  }

  function stopPractice(completed: boolean) {
    activeRef.current = false;
    setActive(false);
    if (practiceFrameRef.current) cancelAnimationFrame(practiceFrameRef.current);
    practiceFrameRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    if (modeRef.current !== "step" && sessionFramesRef.current.length) {
      const result = buildSessionResult(
        practiceScore,
        sessionFramesRef.current,
        transpose,
        toleranceCents,
        completed
          ? `${selectedScore.metadata.title} · ${tr("完整演唱", "Full take")}`
          : `${selectedScore.metadata.title} · ${tr("提前结束", "Stopped early")}`,
      );
      setSessionResult(result);
      setToast(completed
        ? tr(`本次音准得分 ${result.score}`, `Pitch score: ${result.score}`)
        : tr("已生成本次练习复盘", "Your practice review is ready."));
    }
  }

  function switchMode(nextMode: PracticeMode) {
    if (active) stopPractice(false);
    setMode(nextMode);
    modeRef.current = nextMode;
    setPlayhead(0);
    setStepIndex(0);
    setStableMs(0);
  }

  async function handleScoreImport(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await parseScoreFile(file);
      setScores((current) => {
        const withoutOld = current.filter((score) => score.metadata.id !== imported.metadata.id);
        return [...withoutOld, imported];
      });
      setSelectedId(imported.metadata.id);
      setTranspose(0);
      setTonicCalibration(null);
      setPracticeBpm(imported.tempo.bpm);
      setSessionResult(null);
      setToast(tr(`已导入《${imported.metadata.title}》`, `Imported “${imported.metadata.title}”.`));
    } catch (error) {
      setToast(error instanceof Error && locale === "zh-CN" ? error.message : tr("曲谱导入失败", "Score import failed."));
    } finally {
      if (scoreInputRef.current) scoreInputRef.current.value = "";
    }
  }

  async function handleAudioImport(file: File | undefined) {
    if (!file) return;
    if (selectedScore.notes.length === 0) {
      setToast(tr("请先选择或导入一个有音符的曲谱", "Choose or import a score containing notes first."));
      return;
    }
    try {
      setAnalysisProgress(0);
      const rawFrames = await analyzeAudioFile(file, setAnalysisProgress);
      const frames = rawFrames.map((frame) => ({
        ...frame,
        midi: frame.frequency ? frequencyToMidi(frame.frequency, effectiveReferenceHz) : null,
      }));
      const result = buildSessionResult(practiceScore, frames, transpose, toleranceCents, file.name);
      setSessionResult(result);
      setToast(tr(`录音分析完成，音准得分 ${result.score}`, `Recording analyzed. Pitch score: ${result.score}.`));
    } catch {
      setToast(tr("无法解码这份录音，请尝试 WAV、MP3、M4A 或 WebM", "Could not decode this recording. Try WAV, MP3, M4A, or WebM."));
    } finally {
      setAnalysisProgress(null);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  function changeTranspose(value: number | ((current: number) => number)) {
    setTonicCalibration(null);
    setTranspose((current) => {
      const next = typeof value === "function" ? value(current) : value;
      return Math.max(-12, Math.min(12, next));
    });
  }

  function changeReferenceHz(value: number) {
    setTonicCalibration(null);
    setReferenceHz(Math.max(400, Math.min(480, value)));
  }

  function captureTonic() {
    const firstNote = selectedScore.notes.find((note) => note.midi !== null);
    if (!reading || !firstNote || firstNote.midi === null) {
      setToast(tr("请先打开麦克风并唱出你想要的第一个音", "Connect the microphone and sing the first note you want to use."));
      return;
    }
    const sungMidi = frequencyToMidi(reading.frequency, referenceHz);
    const shift = Math.max(-12, Math.min(12, Math.round(sungMidi - firstNote.midi)));
    const calibrated: TonicCalibration = {
      firstScoreMidi: firstNote.midi,
      targetMidi: firstNote.midi + shift,
      frequency: reading.frequency,
    };
    setTranspose(shift);
    setTonicCalibration(calibrated);
    setToast(tr(
      `首音已锁定为 ${midiToNoteName(calibrated.targetMidi)} = ${calibrated.frequency.toFixed(1)} Hz，后续按音程推导`,
      `First note locked to ${midiToNoteName(calibrated.targetMidi)} = ${calibrated.frequency.toFixed(1)} Hz; later notes follow its intervals.`,
    ));
  }

  async function downloadTemplate() {
    try {
      const blob = new Blob([JSON.stringify(emptySong, null, 2)], { type: "application/json" });
      const result = await saveBlob(blob, "my-song.singright.json", {
        title: tr("保存 SingRight 曲谱模板", "Save SingRight score template"),
        filterName: "SingRight JSON",
        extensions: ["json"],
      });
      setToast(result.saved
        ? tr("曲谱模板已保存", "Score template saved.")
        : tr("已取消保存", "Save canceled."));
    } catch {
      setToast(tr("无法保存曲谱模板，请检查目标文件夹权限", "Could not save the score template. Check the destination folder permissions."));
    }
  }

  async function saveRecording() {
    if (!recordingUrl) return;
    try {
      const blob = await fetch(recordingUrl).then((response) => response.blob());
      const extension = recordingName.split(".").pop() || "webm";
      const result = await saveBlob(blob, recordingName || `SingRight-recording.${extension}`, {
        title: tr("保存本次录音", "Save this recording"),
        filterName: tr("音频录音", "Audio recording"),
        extensions: [extension],
      });
      setToast(result.saved ? tr("录音已保存", "Recording saved.") : tr("已取消保存", "Save canceled."));
    } catch {
      setToast(tr("无法保存录音，请检查目标文件夹权限", "Could not save the recording. Check the destination folder permissions."));
    }
  }

  const gaugePosition = liveCents === null ? 50 : (clampCents(liveCents) + 100) / 2 * 100;
  const statusLabel = captureStatus === "listening"
    ? tr("麦克风已连接", "Microphone connected")
    : captureStatus === "requesting"
      ? tr("正在请求权限", "Requesting access")
      : tr("麦克风未连接", "Microphone disconnected");

  if (editorSeed) {
    return (
      <ScoreEditor
        initialScore={editorSeed}
        onClose={() => setEditorSeed(null)}
        onCommit={(score, close) => {
          setScores((current) => [...current.filter((candidate) => candidate.metadata.id !== score.metadata.id), score]);
          setSelectedId(score.metadata.id);
          setTranspose(0);
          setTonicCalibration(null);
          setPracticeBpm(score.tempo.bpm);
          setStepIndex(0);
          setPlayhead(0);
          setSessionResult(null);
          if (close) setEditorSeed(null);
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={22} /></div>
          <div><strong>SingRight</strong><span>{tr("准唱", "Pitch Trainer")}</span></div>
        </div>

        <div className="sidebar-section">
          <div className="section-kicker"><span>{tr("练习曲目", "Practice scores")}</span><span>{scores.length}</span></div>
          <div className="song-list">
            {scores.map((score, index) => {
              const selected = score.metadata.id === selectedId;
              return (
                <button
                  className={`song-item ${selected ? "selected" : ""}`}
                  key={score.metadata.id}
                  onClick={() => {
                    if (active) stopPractice(false);
                    setSelectedId(score.metadata.id);
                    setTranspose(0);
                    setTonicCalibration(null);
                    setPracticeBpm(score.tempo.bpm);
                    setStepIndex(0);
                    setPlayhead(0);
                    setSessionResult(null);
                  }}
                >
                  <span className="song-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="song-copy">
                    <strong>{scoreDisplayText(score, locale).title}</strong>
                    <small>{score.notes.length
                      ? tr(`${score.notes.length} 个音 · ${score.tempo.bpm} BPM`, `${score.notes.length} notes · ${score.tempo.bpm} BPM`)
                      : tr("等待导入曲谱", "Waiting for a score")}</small>
                  </span>
                  {selected && <Volume2 size={16} />}
                </button>
              );
            })}
          </div>
          <button className="import-button" onClick={() => scoreInputRef.current?.click()}>
            <FileUp size={17} /> {tr("导入曲谱", "Import score")}
          </button>
          <button className="composer-launch" onClick={() => setEditorSeed(createEmptyScore(locale))}>
            <SquarePen size={17} />
            <span><strong>{tr("新建曲谱", "New score")}</strong><small>{tr("五线谱 / 简谱 · 试听 · 音频对齐", "Staff / numbered · playback · audio alignment")}</small></span>
          </button>
          <input
            ref={scoreInputRef}
            type="file"
            accept=".json,.singright.json,application/json"
            hidden
            onChange={(event) => void handleScoreImport(event.target.files?.[0])}
          />
        </div>

        <div className="sidebar-spacer" />
        <div className="privacy-note">
          <Headphones size={18} />
          <div><strong>{tr("音频只在本机处理", "Audio stays on this device")}</strong><span>{tr("麦克风与录音不会上传", "Microphone audio is never uploaded")}</span></div>
        </div>
        <button className="settings-button" onClick={() => setShowSettings(true)}>
          <Settings2 size={18} /> {tr("偏好设置", "Preferences")}
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow"><span className="live-dot" /> {tr("PITCH LAB / 音准练习室", "PITCH LAB / SINGING PRACTICE")}</div>
            <h1>{selectedDisplay.title}</h1>
            <p>{selectedDisplay.description || tr("导入你的曲谱，开始更精确的歌唱练习。", "Import a score and start more precise singing practice.")}</p>
          </div>
          <button
            className={`mic-status ${captureStatus === "listening" ? "connected" : ""}`}
            onClick={() => captureStatus === "listening" ? void stopMicrophone() : void ensureMicrophone()}
          >
            {captureStatus === "listening" ? <Mic size={18} /> : <MicOff size={18} />}
            <span><strong>{statusLabel}</strong><small>{captureStatus === "listening" ? tr("点击断开", "Click to disconnect") : tr("点击连接输入设备", "Click to connect input")}</small></span>
          </button>
        </header>

        {captureError && (
          <div className="error-banner"><Info size={17} /> {captureError}<button onClick={() => setCaptureError("")}><X size={16} /></button></div>
        )}

        <section className="mode-row">
          <div className="mode-tabs">
            {(Object.keys(modeCopy) as PracticeMode[]).map((item) => (
              <button className={mode === item ? "active" : ""} key={item} onClick={() => switchMode(item)}>
                {item === "step" ? <Target size={18} /> : item === "continuous" ? <Activity size={18} /> : <RefreshCcw size={18} />}
                <span><strong>{modeCopy[item].label}</strong><small>{modeCopy[item].short}</small></span>
              </button>
            ))}
          </div>
          <div className="transpose-control" aria-label={tr("移调控制", "Transpose control")}>
            <span>{tr("移调", "Key")}</span>
            <button onClick={() => changeTranspose((value) => value - 1)} aria-label={tr("降半音", "Down one semitone")}>−</button>
            <strong>{transpose > 0 ? `+${transpose}` : transpose}</strong>
            <button onClick={() => changeTranspose((value) => value + 1)} aria-label={tr("升半音", "Up one semitone")}>＋</button>
            <button className="tonic-button" onClick={captureTonic}><Sparkles size={15} /> {tr("首音定调", "Set key from first note")}</button>
          </div>
        </section>
        <div className={`mode-explainer mode-${mode}`}>
          <span>{mode === "continuous" ? <Activity size={16} /> : mode === "review" ? <RefreshCcw size={16} /> : <Target size={16} />}</span>
          <div><strong>{modeCopy[mode].label}</strong><small>{modeCopy[mode].detail}</small></div>
          {mode !== "step" && <i>{mode === "continuous" ? tr("实时显示偏差", "Live cents shown") : tr("演唱时隐藏偏差", "Cents hidden during take")}</i>}
        </div>

        <section className="practice-card">
          <div className="score-head">
            <div>
              <span className="card-kicker">{tr("CURRENT PHRASE / 当前片段", "CURRENT PHRASE")}</span>
              <strong>{mode === "step"
                ? tr(`第 ${Math.min(stepIndex + 1, selectedScore.notes.length || 1)} / ${selectedScore.notes.length || 0} 音`, `Note ${Math.min(stepIndex + 1, selectedScore.notes.length || 1)} of ${selectedScore.notes.length || 0}`)
                : tr(`${Math.round(playhead)} / ${Math.round(totalDuration)} 秒`, `${Math.round(playhead)} / ${Math.round(totalDuration)} sec`)}</strong>
            </div>
            <div className="meter-legend"><span><i className="perfect" /> {tr("准确", "Accurate")}</span><span><i className="close" /> {tr("接近", "Close")}</span><span><i className="off" /> {tr("偏离", "Off")}</span></div>
          </div>

          <ScoreRail
            score={selectedScore}
            activeIndex={activeIndex}
            transpose={transpose}
            progress={progress}
          />

          {mode === "review" && active ? (
            <div className="review-focus-panel">
              <div className="focus-pulse"><Mic size={25} /></div>
              <div><span>{tr("专注演唱中", "FOCUS TAKE IN PROGRESS")}</span><strong>{tr("先唱完整首，再集中看结果", "Finish the take first; review every note afterward")}</strong><small>{tr("当前录音与音高轨迹只保存在本机。实时 cents 已隐藏，避免边唱边追指针。", "Recording and pitch tracking stay on this device. Live cents are hidden so you can stay musical.")}</small></div>
            </div>
          ) : <div className="pitch-panel">
            <div className="pitch-readout target-readout">
              <span>{tr("目标音", "Target note")}</span>
              <strong>{targetMidi === null ? "—" : midiToNoteName(targetMidi)}</strong>
              <small>{targetFrequency ? `${targetFrequency.toFixed(1)} Hz` : tr("休止 / 暂无音符", "Rest / no note")}</small>
            </div>
            <div className="tuner">
              <div className="tuner-value">
                {liveCents === null ? <span className="waiting">{tr("等待声音", "Waiting for voice")}</span> : (
                  <>
                    <strong className={isInTune ? "in-tune" : ""}>{signed(liveCents)}</strong>
                    <span>cents</span>
                  </>
                )}
              </div>
              <div className="gauge-labels"><span>{tr("偏低", "Flat")}</span><span>{tr("准", "In tune")}</span><span>{tr("偏高", "Sharp")}</span></div>
              <div className="gauge-track">
                <div className="gauge-zone" />
                <div className={`gauge-needle ${isInTune ? "in-tune" : ""}`} style={{ left: `${gaugePosition}%` }} />
              </div>
              <div className="gauge-ticks"><span>−100</span><span>−50</span><span>0</span><span>+50</span><span>+100</span></div>
            </div>
            <div className="pitch-readout live-readout">
              <span>{tr("实时音高", "Live pitch")}</span>
              <strong>{reading?.noteName ?? "—"}</strong>
              <small>{reading ? `${reading.frequency.toFixed(1)} Hz · ${Math.round(reading.confidence * 100)}%` : tr("请唱出一个稳定的音", "Sing a steady note")}</small>
            </div>
          </div>}

          {mode === "step" && active && (
            <div className="hold-progress">
              <span>{tr("稳定保持", "Steady hold")}</span>
              <div><i style={{ width: `${Math.min(100, stableMs / holdGoalMs * 100)}%` }} /></div>
              <strong>{Math.round(Math.max(0, holdGoalMs - stableMs) / 100) / 10}s</strong>
            </div>
          )}

          <div className="transport">
            <button
              className="skip-button"
              disabled={mode !== "step" || findPitchedIndex(selectedScore, stepIndex - 1, -1) < 0}
              onClick={() => {
                const previous = findPitchedIndex(selectedScore, stepIndex - 1, -1);
                if (previous >= 0) setStepIndex(previous);
              }}
            ><ChevronLeft /></button>
            <button className={`primary-transport ${active ? "stop" : ""}`} onClick={() => active ? stopPractice(false) : void startPractice()}>
              {active
                ? <><Pause fill="currentColor" /> {tr("结束并复盘", "Stop and review")}</>
                : <><Play fill="currentColor" /> {mode === "review" ? tr("开始录制整曲", "Record full take") : tr("开始练习", "Start practice")}</>}
            </button>
            <button
              className="skip-button"
              disabled={mode !== "step" || findPitchedIndex(selectedScore, stepIndex + 1, 1) < 0}
              onClick={() => {
                const next = findPitchedIndex(selectedScore, stepIndex + 1, 1);
                if (next >= 0) setStepIndex(next);
              }}
            ><ChevronRight /></button>
          </div>
        </section>

        <section className="lower-grid">
          <div className="upload-card">
            <div className="mini-icon"><FileAudio size={20} /></div>
            <div className="upload-copy">
              <strong>{tr("上传录音，离线纠错", "Analyze a recording offline")}</strong>
              <span>{tr("支持 WAV、MP3、M4A、WebM 等系统可解码格式", "Supports WAV, MP3, M4A, WebM, and other decodable audio")}</span>
            </div>
            <button onClick={() => audioInputRef.current?.click()} disabled={analysisProgress !== null}>
              {analysisProgress !== null
                ? tr(`分析中 ${Math.round(analysisProgress * 100)}%`, `Analyzing ${Math.round(analysisProgress * 100)}%`)
                : <><Upload size={16} /> {tr("选择录音", "Choose recording")}</>}
            </button>
            <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={(event) => void handleAudioImport(event.target.files?.[0])} />
            {analysisProgress !== null && <div className="analysis-bar"><i style={{ width: `${analysisProgress * 100}%` }} /></div>}
          </div>
          <div className="quick-card">
            <SlidersHorizontal size={20} />
            <div><span>{tr("当前标准", "Current standard")}</span><strong>{practiceBpm} BPM · ±{toleranceCents} cents</strong></div>
            <button onClick={() => setShowSettings(true)}>{tr("调整", "Adjust")}</button>
          </div>
          <div className="quick-card">
            <ArrowDownToLine size={20} />
            <div><span>{tr("曲谱模板", "Score template")}</span><strong>.singright.json v1</strong></div>
            <button onClick={() => void downloadTemplate()}>{tr("下载", "Download")}</button>
          </div>
          <div className="quick-card composer-quick-card">
            <SquarePen size={20} />
            <div><span>{tr("曲谱工作台", "Score workspace")}</span><strong>{tr("五线谱 / 简谱编辑与试听", "Staff / numbered editing and playback")}</strong></div>
            <button onClick={() => setEditorSeed({
              ...selectedScore,
              metadata: {
                ...selectedScore.metadata,
                title: selectedDisplay.title,
                description: selectedDisplay.description,
              },
            })}>{tr("打开", "Open")}</button>
          </div>
        </section>

        {(sessionResult || recordingUrl) && (
          <ReviewPanel
            result={sessionResult}
            score={selectedScore}
            recordingUrl={recordingUrl}
            recordingName={recordingName}
            transpose={transpose}
            onSaveRecording={() => void saveRecording()}
          />
        )}
      </main>

      {showSettings && (
        <div className="settings-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setShowSettings(false)}>
          <aside className="settings-drawer">
            <div className="drawer-head"><div><span>{tr("练习偏好", "PRACTICE PREFERENCES")}</span><strong>{tr("校准你的标准", "Tune your standard")}</strong></div><button onClick={() => setShowSettings(false)} aria-label={tr("关闭", "Close")}><X /></button></div>
            <label>
              <div><span>{tr("界面语言", "Interface language")}</span><strong>{locale === "zh-CN" ? "简体中文" : "English"}</strong></div>
              <select className="language-select" value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en")}>
                <option value="zh-CN">简体中文</option>
                <option value="en">English</option>
              </select>
              <small>{tr("首次启动会采用安装包语言或系统语言，你可以随时在这里切换。", "The first launch uses the installer or system language. You can change it here anytime.")}</small>
            </label>
            <label>
              <div><span>{tr("本次练习速度", "Practice tempo")}</span><strong>{practiceBpm} BPM</strong></div>
              <input type="range" min="20" max="300" step="1" value={practiceBpm} onChange={(event) => setPracticeBpm(Number(event.target.value))} />
              <small>{tr(`曲谱默认 ${selectedScore.tempo.bpm} BPM。这里只改变练习、跟唱和复盘速度，不会修改五线谱里的原始速度。`, `Score default: ${selectedScore.tempo.bpm} BPM. This changes practice, follow, and review timing without editing the score tempo.`)}</small>
              <button className="setting-reset" onClick={() => setPracticeBpm(selectedScore.tempo.bpm)}>{tr("恢复曲谱默认速度", "Restore score tempo")}</button>
            </label>
            <label>
              <div><span>{tr("练习移调", "Practice transpose")}</span><strong>{transpose > 0 ? `+${transpose}` : transpose} {tr("半音", "semitones")}</strong></div>
              <input type="range" min="-12" max="12" step="1" value={transpose} onChange={(event) => changeTranspose(Number(event.target.value))} />
              <small>{tr("手动修改移调会解除首音锁定；曲谱本身保持不变。", "Changing transpose manually clears the first-note lock; the score itself stays unchanged.")}</small>
            </label>
            <label>
              <div><span>{tr("A4 参考频率", "A4 reference")}</span><strong>{referenceHz} Hz</strong></div>
              <input type="range" min="400" max="480" step="1" value={referenceHz} onChange={(event) => changeReferenceHz(Number(event.target.value))} />
              <small>{tr("现代音乐通常使用 440 Hz。手动修改参考频率会解除首音锁定。", "Modern music usually uses 440 Hz. Changing the reference manually clears the first-note lock.")}</small>
            </label>
            <div className={`tonic-calibration-summary ${tonicCalibration ? "active" : ""}`}>
              <Sparkles />
              <span>
                <strong>{tonicCalibration ? tr("首音已精确锁定", "First note is precisely locked") : tr("首音尚未锁定", "First note is not locked")}</strong>
                <small>{tonicCalibration
                  ? `${midiToNoteName(tonicCalibration.targetMidi)} = ${tonicCalibration.frequency.toFixed(1)} Hz · A4 ${effectiveReferenceHz.toFixed(2)} Hz`
                  : tr("在练习室唱出第一个音，再点“首音定调”。", "Sing the first note in the practice room, then choose “Set key from first note”.")}</small>
              </span>
              {tonicCalibration && <button onClick={() => setTonicCalibration(null)}>{tr("解除", "Clear")}</button>}
            </div>
            <label>
              <div><span>{tr("音准容差", "Pitch tolerance")}</span><strong>±{toleranceCents} cents</strong></div>
              <div className="tolerance-presets">
                {([
                  ["relaxed", tr("宽松", "Relaxed")],
                  ["standard", tr("标准", "Standard")],
                  ["strict", tr("严格", "Strict")],
                  ["custom", tr("自定义", "Custom")],
                ] as Array<[TolerancePreset, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    className={tolerancePreset === value ? "active" : ""}
                    onClick={() => {
                      setTolerancePreset(value);
                      if (value !== "custom") setToleranceCents(TOLERANCE_VALUES[value]);
                    }}
                  >{label}{value !== "custom" && <small>±{TOLERANCE_VALUES[value]}</small>}</button>
                ))}
              </div>
              <input
                type="range"
                min="10"
                max="100"
                step="1"
                value={toleranceCents}
                onChange={(event) => {
                  setTolerancePreset("custom");
                  setToleranceCents(Number(event.target.value));
                }}
              />
              <small>{tr("100 cents 等于一个半音。宽松模式适合初学，自定义可在 ±10–100 cents 间精确调整。", "100 cents equals one semitone. Relaxed suits beginners; Custom allows any value from ±10–100 cents.")}</small>
            </label>
            <label>
              <div><span>{tr("逐音稳定时长", "Steady-hold duration")}</span><strong>{(holdGoalMs / 1000).toFixed(2)} {tr("秒", "sec")}</strong></div>
              <input type="range" min="350" max="1200" step="50" value={holdGoalMs} onChange={(event) => setHoldGoalMs(Number(event.target.value))} />
              <small>{tr("在容差范围内持续达到此时长，才算通过当前音。", "A note passes only after staying within tolerance for this duration.")}</small>
            </label>
            <div className="settings-summary">
              <Gauge size={20} />
              <span>{tr("速度、移调、首音、参考频率、容差与稳定时长都集中在这里；它们同时作用于实时练习和录音分析。", "Tempo, transpose, first-note lock, reference, tolerance, and hold time are all managed here and apply to live practice and recording analysis.")}</span>
            </div>
          </aside>
        </div>
      )}

      {toast && <div className="toast"><Check size={17} /> {toast}</div>}
    </div>
  );
}

function ScoreRail({
  score,
  activeIndex,
  transpose,
  progress,
}: {
  score: PitchScore;
  activeIndex: number;
  transpose: number;
  progress: number;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  if (score.notes.length === 0) {
    return (
      <div className="empty-score">
        <Music2 size={28} />
        <div><strong>{tr("这首曲目还没有音符", "This score has no notes yet")}</strong><span>{tr("下载空白模板填写，或在曲谱工作台直接打谱。", "Download the blank template or create it in the score workspace.")}</span></div>
      </div>
    );
  }
  const totalBeats = Math.max(...score.notes.map((note) => note.beat + note.durationBeats));
  const pitched = score.notes.filter((note) => note.midi !== null).map((note) => note.midi as number);
  const minMidi = Math.min(...pitched);
  const maxMidi = Math.max(...pitched);
  const pitchSpan = Math.max(7, maxMidi - minMidi);

  return (
    <div className="score-viewport">
      <div className="staff-lines">{Array.from({ length: 5 }, (_, index) => <i key={index} />)}</div>
      <div className="note-rail">
        {score.notes.map((note, index) => {
          const left = (note.beat / totalBeats) * 100;
          const width = Math.max(5.5, (note.durationBeats / totalBeats) * 100 - 0.8);
          const bottom = note.midi === null ? 10 : 17 + (((note.midi as number) - minMidi) / pitchSpan) * 43;
          return (
            <div
              className={`score-note ${index < activeIndex ? "passed" : ""} ${index === activeIndex ? "current" : ""} ${note.midi === null ? "rest" : ""}`}
              key={note.id}
              style={{ left: `${left}%`, width: `${width}%`, bottom: `${bottom}%` }}
            >
              <span>{note.midi === null ? "0" : note.numeral || numeralForMidi(note.midi + transpose, score.tuning.tonicMidi + transpose)}</span>
              <small>{note.lyric || (note.midi === null ? "" : midiToNoteName(note.midi + transpose))}</small>
            </div>
          );
        })}
        <div className="playhead" style={{ left: `${Math.max(0, Math.min(100, progress * 100))}%` }}><i /></div>
      </div>
    </div>
  );
}

function ReviewPanel({
  result,
  score,
  recordingUrl,
  recordingName,
  transpose,
  onSaveRecording,
}: {
  result: SessionResult | null;
  score: PitchScore;
  recordingUrl: string;
  recordingName: string;
  transpose: number;
  onSaveRecording: () => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const retryNotes = result?.noteResults.filter((item) => item.verdict === "retry") ?? [];
  return (
    <section className="review-card">
      <div className="review-head">
        <div><span className="card-kicker">TAKE REVIEW</span><h2>{tr("本次演唱复盘", "Take review")}</h2><p>{result?.sourceName || tr("刚刚录制的演唱", "Your latest recording")}</p></div>
        {result && (
          <div className="score-ring" style={{ "--score": `${result.score * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{result.score}</strong><span>{tr("音准分", "Pitch score")}</span></div>
          </div>
        )}
      </div>
      {result && (
        <>
          <div className="review-stats">
            <div><span>{tr("有效覆盖", "Coverage")}</span><strong>{result.coverage}%</strong></div>
            <div><span>{tr("需要重练", "Retry")}</span><strong>{tr(`${retryNotes.length} 个音`, `${retryNotes.length} notes`)}</strong></div>
            <div><span>{tr("平均结果", "Overall")}</span><strong>{result.score >= 85 ? tr("稳定", "Steady") : result.score >= 60 ? tr("接近", "Close") : tr("继续练习", "Keep practicing")}</strong></div>
          </div>
          <div className="result-notes">
            {result.noteResults.map((item) => (
              <div className={`result-note ${item.verdict}`} key={item.note.id}>
                <span>{item.note.numeral || (item.targetMidi === null ? "0" : numeralForMidi(item.targetMidi, score.tuning.tonicMidi + transpose))}</span>
                <strong>{item.targetMidi === null ? tr("休止", "Rest") : midiToNoteName(item.targetMidi)}</strong>
                <small>{item.meanCents === null ? tr("未检测", "Not detected") : `${signed(item.meanCents)} cents`}</small>
                <i>{item.verdict === "excellent" ? "✓" : item.verdict === "good" ? "≈" : item.verdict === "rest" ? "0" : "↻"}</i>
              </div>
            ))}
          </div>
        </>
      )}
      {recordingUrl && (
        <div className="recording-row">
          <div><CircleStop size={18} /><span><strong>{tr("本次录音", "This recording")}</strong><small>{tr("保存在当前设备，可播放或下载", "Stored on this device; play or download it")}</small></span></div>
          <audio controls src={recordingUrl} />
          <button onClick={onSaveRecording}><ArrowDownToLine size={16} /> {tr("保存录音", "Save recording")}</button>
        </div>
      )}
    </section>
  );
}

export default App;
