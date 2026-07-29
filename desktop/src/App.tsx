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
  Target,
  Upload,
  Volume2,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import ascendingScale from "./data/ascending-scale.json";
import emptySong from "./data/empty-song.json";
import { centsBetweenFrequency, clampCents, frequencyToMidi, midiToFrequency, midiToNoteName, numeralForMidi, signed } from "./lib/music";
import { analyzeAudioFile, detectPitchYin } from "./lib/pitch";
import { buildSessionResult, noteAtSeconds, parseScoreFile, scoreDurationSeconds, validateScore } from "./lib/score";
import type { AnalysisFrame, PitchReading, PitchScore, PracticeMode, SessionResult } from "./types";

const BUILT_IN_SCORES = [validateScore(ascendingScale), validateScore(emptySong)];
const MODE_COPY: Record<PracticeMode, { label: string; short: string }> = {
  step: { label: "逐音校准", short: "唱准并保持，自动进入下一个音" },
  continuous: { label: "连续跟唱", short: "按节奏和时值实时判断" },
  review: { label: "整曲复盘", short: "录完一遍，集中纠错" },
};

type CaptureStatus = "idle" | "requesting" | "listening" | "error";

function findPitchedIndex(score: PitchScore, from: number, direction: 1 | -1): number {
  for (let index = from; index >= 0 && index < score.notes.length; index += direction) {
    if (score.notes[index].midi !== null) return index;
  }
  return -1;
}

function App() {
  const [scores, setScores] = useState<PitchScore[]>(BUILT_IN_SCORES);
  const [selectedId, setSelectedId] = useState(BUILT_IN_SCORES[0].metadata.id);
  const [mode, setMode] = useState<PracticeMode>("step");
  const [transpose, setTranspose] = useState(0);
  const [referenceHz, setReferenceHz] = useState(440);
  const [toleranceCents, setToleranceCents] = useState(30);
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
  const totalDuration = scoreDurationSeconds(selectedScore);
  const activeIndex = mode === "step"
    ? Math.min(stepIndex, Math.max(0, selectedScore.notes.length - 1))
    : noteAtSeconds(selectedScore, playhead)?.index ?? -1;
  const activeNote = activeIndex >= 0 ? selectedScore.notes[activeIndex] : null;
  const targetMidi = activeNote?.midi === null || activeNote?.midi === undefined
    ? null
    : activeNote.midi + transpose;
  const targetFrequency = targetMidi === null ? null : midiToFrequency(targetMidi, referenceHz);
  const liveCents = reading && targetMidi !== null
    ? centsBetweenFrequency(reading.frequency, targetMidi, referenceHz)
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
    referenceHzRef.current = referenceHz;
  }, [referenceHz]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!active || !reading || modeRef.current !== "step" || targetMidi === null) return;
    const delta = lastReadingAtRef.current ? Math.min(80, reading.capturedAt - lastReadingAtRef.current) : 0;
    lastReadingAtRef.current = reading.capturedAt;
    const cents = centsBetweenFrequency(reading.frequency, targetMidi, referenceHz);
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
        setToast("逐音练习完成，很稳！");
      } else {
        setStepIndex(nextIndex);
      }
    }
  }, [active, holdGoalMs, reading, referenceHz, selectedScore.notes.length, stepIndex, targetMidi, toleranceCents]);

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
      setCaptureError("当前系统不支持麦克风访问");
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
        ? "麦克风权限被拒绝，请在系统设置中允许 SingRight 使用麦克风"
        : "无法打开麦克风，请检查输入设备");
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
      setToast("这是空白曲目，请先导入曲谱");
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
        selectedScore,
        sessionFramesRef.current,
        transpose,
        toleranceCents,
        completed ? `${selectedScore.metadata.title} · 完整演唱` : `${selectedScore.metadata.title} · 提前结束`,
      );
      setSessionResult(result);
      setToast(completed ? `本次音准得分 ${result.score}` : "已生成本次练习复盘");
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
      setSessionResult(null);
      setToast(`已导入《${imported.metadata.title}》`);
    } catch (error) {
      setToast(error instanceof Error ? error.message : "曲谱导入失败");
    } finally {
      if (scoreInputRef.current) scoreInputRef.current.value = "";
    }
  }

  async function handleAudioImport(file: File | undefined) {
    if (!file) return;
    if (selectedScore.notes.length === 0) {
      setToast("请先选择或导入一个有音符的曲谱");
      return;
    }
    try {
      setAnalysisProgress(0);
      const rawFrames = await analyzeAudioFile(file, setAnalysisProgress);
      const frames = rawFrames.map((frame) => ({
        ...frame,
        midi: frame.frequency ? frequencyToMidi(frame.frequency, referenceHz) : null,
      }));
      const result = buildSessionResult(selectedScore, frames, transpose, toleranceCents, file.name);
      setSessionResult(result);
      setToast(`录音分析完成，音准得分 ${result.score}`);
    } catch {
      setToast("无法解码这份录音，请尝试 WAV、MP3、M4A 或 WebM");
    } finally {
      setAnalysisProgress(null);
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  function captureTonic() {
    const firstNote = selectedScore.notes.find((note) => note.midi !== null);
    if (!reading || !firstNote || firstNote.midi === null) {
      setToast("请先打开麦克风并唱出你想要的第一个音");
      return;
    }
    const shift = Math.max(-12, Math.min(12, Math.round(reading.midi - firstNote.midi)));
    setTranspose(shift);
    setToast(`已将当前音设为首音：${shift >= 0 ? "+" : ""}${shift} 半音`);
  }

  function downloadTemplate() {
    const blob = new Blob([JSON.stringify(emptySong, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "my-song.singright.json";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  const gaugePosition = liveCents === null ? 50 : (clampCents(liveCents) + 100) / 2 * 100;
  const statusLabel = captureStatus === "listening" ? "麦克风已连接" : captureStatus === "requesting" ? "正在请求权限" : "麦克风未连接";

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><AudioLines size={22} /></div>
          <div><strong>SingRight</strong><span>准唱</span></div>
        </div>

        <div className="sidebar-section">
          <div className="section-kicker"><span>练习曲目</span><span>{scores.length}</span></div>
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
                    setStepIndex(0);
                    setPlayhead(0);
                    setSessionResult(null);
                  }}
                >
                  <span className="song-number">{String(index + 1).padStart(2, "0")}</span>
                  <span className="song-copy">
                    <strong>{score.metadata.title}</strong>
                    <small>{score.notes.length ? `${score.notes.length} 个音 · ${score.tempo.bpm} BPM` : "等待导入曲谱"}</small>
                  </span>
                  {selected && <Volume2 size={16} />}
                </button>
              );
            })}
          </div>
          <button className="import-button" onClick={() => scoreInputRef.current?.click()}>
            <FileUp size={17} /> 导入曲谱
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
          <div><strong>音频只在本机处理</strong><span>麦克风与录音不会上传</span></div>
        </div>
        <button className="settings-button" onClick={() => setShowSettings(true)}>
          <Settings2 size={18} /> 偏好设置
        </button>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div>
            <div className="eyebrow"><span className="live-dot" /> PITCH LAB / 音准练习室</div>
            <h1>{selectedScore.metadata.title}</h1>
            <p>{selectedScore.metadata.description || "导入你的曲谱，开始更精确的歌唱练习。"}</p>
          </div>
          <button
            className={`mic-status ${captureStatus === "listening" ? "connected" : ""}`}
            onClick={() => captureStatus === "listening" ? void stopMicrophone() : void ensureMicrophone()}
          >
            {captureStatus === "listening" ? <Mic size={18} /> : <MicOff size={18} />}
            <span><strong>{statusLabel}</strong><small>{captureStatus === "listening" ? "点击断开" : "点击连接输入设备"}</small></span>
          </button>
        </header>

        {captureError && (
          <div className="error-banner"><Info size={17} /> {captureError}<button onClick={() => setCaptureError("")}><X size={16} /></button></div>
        )}

        <section className="mode-row">
          <div className="mode-tabs">
            {(Object.keys(MODE_COPY) as PracticeMode[]).map((item) => (
              <button className={mode === item ? "active" : ""} key={item} onClick={() => switchMode(item)}>
                {item === "step" ? <Target size={18} /> : item === "continuous" ? <Activity size={18} /> : <RefreshCcw size={18} />}
                <span><strong>{MODE_COPY[item].label}</strong><small>{MODE_COPY[item].short}</small></span>
              </button>
            ))}
          </div>
          <div className="transpose-control" aria-label="移调控制">
            <span>移调</span>
            <button onClick={() => setTranspose((value) => Math.max(-12, value - 1))} aria-label="降半音">−</button>
            <strong>{transpose > 0 ? `+${transpose}` : transpose}</strong>
            <button onClick={() => setTranspose((value) => Math.min(12, value + 1))} aria-label="升半音">＋</button>
            <button className="tonic-button" onClick={captureTonic}><Sparkles size={15} /> 首音定调</button>
          </div>
        </section>

        <section className="practice-card">
          <div className="score-head">
            <div>
              <span className="card-kicker">CURRENT PHRASE</span>
              <strong>{mode === "step" ? `第 ${Math.min(stepIndex + 1, selectedScore.notes.length || 1)} / ${selectedScore.notes.length || 0} 音` : `${Math.round(playhead)} / ${Math.round(totalDuration)} 秒`}</strong>
            </div>
            <div className="meter-legend"><span><i className="perfect" /> 准确</span><span><i className="close" /> 接近</span><span><i className="off" /> 偏离</span></div>
          </div>

          <ScoreRail
            score={selectedScore}
            activeIndex={activeIndex}
            transpose={transpose}
            progress={progress}
          />

          <div className="pitch-panel">
            <div className="pitch-readout target-readout">
              <span>目标音</span>
              <strong>{targetMidi === null ? "—" : midiToNoteName(targetMidi)}</strong>
              <small>{targetFrequency ? `${targetFrequency.toFixed(1)} Hz` : "休止 / 暂无音符"}</small>
            </div>
            <div className="tuner">
              <div className="tuner-value">
                {liveCents === null ? <span className="waiting">等待声音</span> : (
                  <>
                    <strong className={isInTune ? "in-tune" : ""}>{signed(liveCents)}</strong>
                    <span>cents</span>
                  </>
                )}
              </div>
              <div className="gauge-labels"><span>偏低</span><span>准</span><span>偏高</span></div>
              <div className="gauge-track">
                <div className="gauge-zone" />
                <div className={`gauge-needle ${isInTune ? "in-tune" : ""}`} style={{ left: `${gaugePosition}%` }} />
              </div>
              <div className="gauge-ticks"><span>−100</span><span>−50</span><span>0</span><span>+50</span><span>+100</span></div>
            </div>
            <div className="pitch-readout live-readout">
              <span>实时音高</span>
              <strong>{reading?.noteName ?? "—"}</strong>
              <small>{reading ? `${reading.frequency.toFixed(1)} Hz · ${Math.round(reading.confidence * 100)}%` : "请唱出一个稳定的音"}</small>
            </div>
          </div>

          {mode === "step" && active && (
            <div className="hold-progress">
              <span>稳定保持</span>
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
              {active ? <><Pause fill="currentColor" /> 结束并复盘</> : <><Play fill="currentColor" /> {mode === "review" ? "开始录制整曲" : "开始练习"}</>}
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
              <strong>上传录音，离线纠错</strong>
              <span>支持 WAV、MP3、M4A、WebM 等系统可解码格式</span>
            </div>
            <button onClick={() => audioInputRef.current?.click()} disabled={analysisProgress !== null}>
              {analysisProgress !== null ? `分析中 ${Math.round(analysisProgress * 100)}%` : <><Upload size={16} /> 选择录音</>}
            </button>
            <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={(event) => void handleAudioImport(event.target.files?.[0])} />
            {analysisProgress !== null && <div className="analysis-bar"><i style={{ width: `${analysisProgress * 100}%` }} /></div>}
          </div>
          <div className="quick-card">
            <SlidersHorizontal size={20} />
            <div><span>当前标准</span><strong>A4 = {referenceHz} Hz · ±{toleranceCents} cents</strong></div>
            <button onClick={() => setShowSettings(true)}>调整</button>
          </div>
          <div className="quick-card">
            <ArrowDownToLine size={20} />
            <div><span>曲谱模板</span><strong>.singright.json v1</strong></div>
            <button onClick={downloadTemplate}>下载</button>
          </div>
        </section>

        {(sessionResult || recordingUrl) && (
          <ReviewPanel
            result={sessionResult}
            score={selectedScore}
            recordingUrl={recordingUrl}
            recordingName={recordingName}
            transpose={transpose}
          />
        )}
      </main>

      {showSettings && (
        <div className="settings-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setShowSettings(false)}>
          <aside className="settings-drawer">
            <div className="drawer-head"><div><span>练习偏好</span><strong>校准你的标准</strong></div><button onClick={() => setShowSettings(false)}><X /></button></div>
            <label>
              <div><span>A4 参考频率</span><strong>{referenceHz} Hz</strong></div>
              <input type="range" min="430" max="450" value={referenceHz} onChange={(event) => setReferenceHz(Number(event.target.value))} />
              <small>现代音乐通常使用 440 Hz；部分乐团或老录音会略有不同。</small>
            </label>
            <label>
              <div><span>准确容差</span><strong>±{toleranceCents} cents</strong></div>
              <input type="range" min="15" max="50" step="5" value={toleranceCents} onChange={(event) => setToleranceCents(Number(event.target.value))} />
              <small>100 cents 等于一个半音。初学建议 35，严格训练建议 20。</small>
            </label>
            <label>
              <div><span>逐音稳定时长</span><strong>{(holdGoalMs / 1000).toFixed(2)} 秒</strong></div>
              <input type="range" min="350" max="1200" step="50" value={holdGoalMs} onChange={(event) => setHoldGoalMs(Number(event.target.value))} />
              <small>在容差范围内持续达到此时长，才算通过当前音。</small>
            </label>
            <div className="settings-summary">
              <Gauge size={20} />
              <span>这些设置同时作用于实时练习和录音分析。</span>
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
  if (score.notes.length === 0) {
    return (
      <div className="empty-score">
        <Music2 size={28} />
        <div><strong>这首曲目还没有音符</strong><span>下载空白模板填写，或直接导入你的 `.singright.json` 曲谱。</span></div>
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
              <span>{note.midi === null ? "休" : note.numeral || numeralForMidi(note.midi + transpose, score.tuning.tonicMidi + transpose)}</span>
              <small>{note.lyric || "啊"}</small>
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
}: {
  result: SessionResult | null;
  score: PitchScore;
  recordingUrl: string;
  recordingName: string;
  transpose: number;
}) {
  const retryNotes = result?.noteResults.filter((item) => item.verdict === "retry") ?? [];
  return (
    <section className="review-card">
      <div className="review-head">
        <div><span className="card-kicker">TAKE REVIEW</span><h2>本次演唱复盘</h2><p>{result?.sourceName || "刚刚录制的演唱"}</p></div>
        {result && (
          <div className="score-ring" style={{ "--score": `${result.score * 3.6}deg` } as React.CSSProperties}>
            <div><strong>{result.score}</strong><span>音准分</span></div>
          </div>
        )}
      </div>
      {result && (
        <>
          <div className="review-stats">
            <div><span>有效覆盖</span><strong>{result.coverage}%</strong></div>
            <div><span>需要重练</span><strong>{retryNotes.length} 个音</strong></div>
            <div><span>平均结果</span><strong>{result.score >= 85 ? "稳定" : result.score >= 60 ? "接近" : "继续练习"}</strong></div>
          </div>
          <div className="result-notes">
            {result.noteResults.map((item) => (
              <div className={`result-note ${item.verdict}`} key={item.note.id}>
                <span>{item.note.numeral || (item.targetMidi === null ? "休" : numeralForMidi(item.targetMidi, score.tuning.tonicMidi + transpose))}</span>
                <strong>{item.targetMidi === null ? "休止" : midiToNoteName(item.targetMidi)}</strong>
                <small>{item.meanCents === null ? "未检测" : `${signed(item.meanCents)} cents`}</small>
                <i>{item.verdict === "excellent" ? "准" : item.verdict === "good" ? "近" : item.verdict === "rest" ? "休" : "练"}</i>
              </div>
            ))}
          </div>
        </>
      )}
      {recordingUrl && (
        <div className="recording-row">
          <div><CircleStop size={18} /><span><strong>本次录音</strong><small>保存在当前设备，可播放或下载</small></span></div>
          <audio controls src={recordingUrl} />
          <a href={recordingUrl} download={recordingName}><ArrowDownToLine size={16} /> 保存录音</a>
        </div>
      )}
    </section>
  );
}

export default App;
