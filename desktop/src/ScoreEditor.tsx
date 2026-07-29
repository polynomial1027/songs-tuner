import {
  AlignLeft,
  ArrowLeft,
  AudioWaveform,
  CircleStop,
  Clock3,
  Copy,
  Download,
  FileAudio2,
  FileInput,
  Grid2X2,
  Headphones,
  Keyboard,
  Languages,
  ListMusic,
  Minus,
  MousePointer2,
  Music,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat2,
  RotateCcw,
  Save,
  Scissors,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { localize, useI18n } from "./i18n";
import { downloadBlob } from "./lib/download";
import {
  DURATION_OPTIONS,
  KEY_SIGNATURES,
  cloneScore,
  createEmptyScore,
  deleteNote,
  durationName,
  makeNoteId,
  midiForStaffY,
  midiFromStep,
  midiSpelling,
  nextOpenBeat,
  noteTypeForBeats,
  placeNote,
  quantizeBeat,
  scoreEndBeat,
  staffYForMidi,
  updateNote,
} from "./lib/composer";
import type { Accidental, Clef } from "./lib/composer";
import { midiToFrequency, midiToNoteName, numeralForMidi } from "./lib/music";
import { parseNotationFile, scoreToMidi, scoreToMusicXml } from "./lib/musicxml";
import { validateScore } from "./lib/score";
import type { PitchScore, ScoreNote } from "./types";
import "./score-editor.css";

type EditorTool = "select" | "note" | "rest";
type NotationView = "staff" | "numbered" | "split";

interface ScoreEditorProps {
  initialScore: PitchScore;
  onCommit: (score: PitchScore, close: boolean) => void;
  onClose: () => void;
}

interface StaffCanvasProps {
  score: PitchScore;
  selectedId: string | null;
  cursorBeat: number;
  playbackBeat: number;
  zoom: number;
  tool: EditorTool;
  accidental: Accidental;
  onCanvasAction: (beat: number, midi: number) => void;
  onSelect: (id: string) => void;
  onMoveCursor: (beat: number) => void;
}

const AUTOSAVE_KEY = "singright-composer-autosave-v1";
const SVG_WIDTH = 1200;
const SYSTEM_HEIGHT = 172;
const STAFF_LEFT = 155;
const STAFF_RIGHT = 1160;
const PITCH_CLASSES = [
  { step: "C", accidental: 0 as Accidental, label: "C" },
  { step: "C", accidental: 1 as Accidental, label: "C♯" },
  { step: "D", accidental: 0 as Accidental, label: "D" },
  { step: "D", accidental: 1 as Accidental, label: "D♯" },
  { step: "E", accidental: 0 as Accidental, label: "E" },
  { step: "F", accidental: 0 as Accidental, label: "F" },
  { step: "F", accidental: 1 as Accidental, label: "F♯" },
  { step: "G", accidental: 0 as Accidental, label: "G" },
  { step: "G", accidental: 1 as Accidental, label: "G♯" },
  { step: "A", accidental: 0 as Accidental, label: "A" },
  { step: "A", accidental: 1 as Accidental, label: "A♯" },
  { step: "B", accidental: 0 as Accidental, label: "B" },
];

function localizedKeyName(name: string, locale: "zh-CN" | "en"): string {
  if (locale === "zh-CN") return name;
  return name.replace(" 大调 / ", " major / ").replace(" 小调", " minor");
}

function safeFileBase(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "singright-score";
}

function noteAccidental(note: ScoreNote, fifths: number): string {
  const spelling = note.spelling || (note.midi === null ? "" : midiSpelling(note.midi, fifths));
  if (spelling.includes("♯")) return "♯";
  if (spelling.includes("♭")) return "♭";
  return "";
}

function ledgerYs(noteY: number): number[] {
  const values: number[] = [];
  if (noteY <= 46) {
    for (let y = 41; y >= noteY - 1; y -= 10) values.push(y);
  }
  if (noteY >= 96) {
    for (let y = 101; y <= noteY + 1; y += 10) values.push(y);
  }
  return values;
}

function keySignaturePositions(clef: Clef, fifths: number): Array<{ glyph: string; y: number }> {
  const sharpTreble = [56, 71, 51, 66, 81, 61, 76];
  const flatTreble = [76, 61, 81, 66, 86, 71, 91];
  const sharpBass = [76, 61, 81, 66, 51, 71, 56];
  const flatBass = [56, 71, 51, 66, 46, 61, 41];
  const sharp = clef === "treble" ? sharpTreble : sharpBass;
  const flat = clef === "treble" ? flatTreble : flatBass;
  return Array.from({ length: Math.abs(fifths) }, (_, index) => ({
    glyph: fifths > 0 ? "♯" : "♭",
    y: (fifths > 0 ? sharp : flat)[index],
  }));
}

function StaffCanvas({
  score,
  selectedId,
  cursorBeat,
  playbackBeat,
  zoom,
  tool,
  accidental,
  onCanvasAction,
  onSelect,
  onMoveCursor,
}: StaffCanvasProps) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const clef = score.notation?.clef ?? "treble";
  const fifths = score.notation?.keySignature ?? 0;
  const measuresPerSystem = Math.max(2, Math.min(6, Math.round(7 - zoom)));
  const beatsPerSystem = measuresPerSystem * score.timeSignature.beats;
  const minSystems = Math.max(1, Math.ceil(Math.max(scoreEndBeat(score), cursorBeat + 1) / beatsPerSystem));
  const systemCount = Math.min(24, minSystems);
  const height = systemCount * SYSTEM_HEIGHT;

  function xForBeat(beat: number): number {
    const within = ((beat % beatsPerSystem) + beatsPerSystem) % beatsPerSystem;
    return STAFF_LEFT + (within / beatsPerSystem) * (STAFF_RIGHT - STAFF_LEFT);
  }

  function handleStaffClick(event: React.MouseEvent<SVGRectElement>, systemIndex: number) {
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()?.inverse());
    const beatWithin = ((local.x - STAFF_LEFT) / (STAFF_RIGHT - STAFF_LEFT)) * beatsPerSystem;
    const beat = quantizeBeat(systemIndex * beatsPerSystem + beatWithin, 0.25);
    const localY = local.y - systemIndex * SYSTEM_HEIGHT;
    if (tool === "select") {
      onMoveCursor(beat);
      return;
    }
    onCanvasAction(beat, midiForStaffY(localY, clef, accidental));
  }

  return (
    <div className="notation-scroll" aria-label={tr("可编辑五线谱", "Editable staff notation")}>
      <svg
        className={`notation-svg tool-${tool}`}
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        role="application"
        aria-label={tr("点击谱面输入音符；点击已有音符进行编辑", "Click the staff to enter notes; click an existing note to edit it")}
      >
        {Array.from({ length: systemCount }, (_, systemIndex) => {
          const top = systemIndex * SYSTEM_HEIGHT;
          const systemStart = systemIndex * beatsPerSystem;
          return (
            <g key={systemIndex} transform={`translate(0 ${top})`}>
              <rect
                className="staff-hit-area"
                x={STAFF_LEFT}
                y="23"
                width={STAFF_RIGHT - STAFF_LEFT}
                height="91"
                onClick={(event) => handleStaffClick(event, systemIndex)}
              />
              <text className="measure-label" x="20" y="29">
                {`${systemIndex * measuresPerSystem + 1}–${(systemIndex + 1) * measuresPerSystem}`}
              </text>
              <text className="clef-glyph" x="53" y={clef === "treble" ? 93 : 86}>{clef === "treble" ? "𝄞" : "𝄢"}</text>
              {keySignaturePositions(clef, fifths).map((item, index) => (
                <text className="key-signature-glyph" key={`${item.glyph}-${index}`} x={82 + index * 9} y={item.y + 7}>{item.glyph}</text>
              ))}
              {systemIndex === 0 && (
                <g className="time-signature">
                  <text x="137" y="67">{score.timeSignature.beats}</text>
                  <text x="137" y="91">{score.timeSignature.beatUnit}</text>
                </g>
              )}
              {[51, 61, 71, 81, 91].map((y) => <line className="staff-line" key={y} x1={STAFF_LEFT} x2={STAFF_RIGHT} y1={y} y2={y} />)}
              {Array.from({ length: measuresPerSystem + 1 }, (_, measure) => {
                const x = STAFF_LEFT + (measure / measuresPerSystem) * (STAFF_RIGHT - STAFF_LEFT);
                return <line className="bar-line" key={measure} x1={x} x2={x} y1="51" y2="91" />;
              })}
              {Array.from({ length: beatsPerSystem }, (_, beat) => {
                if (beat % score.timeSignature.beats === 0) return null;
                const x = STAFF_LEFT + (beat / beatsPerSystem) * (STAFF_RIGHT - STAFF_LEFT);
                return <line className="beat-guide" key={beat} x1={x} x2={x} y1="45" y2="99" />;
              })}
              {score.notes.filter((note) => note.beat >= systemStart && note.beat < systemStart + beatsPerSystem).map((note) => {
                const x = xForBeat(note.beat);
                const noteY = note.midi === null ? 72 : staffYForMidi(note.midi, clef, fifths);
                const selected = note.id === selectedId;
                const type = noteTypeForBeats(note.durationBeats);
                const openHead = type === "whole" || type === "half";
                const stemUp = noteY >= 71;
                const stemX = stemUp ? x + 8 : x - 8;
                const accidentalGlyph = noteAccidental(note, fifths);
                return (
                  <g
                    className={`notation-note ${selected ? "selected" : ""} ${note.midi === null ? "is-rest" : ""}`}
                    key={note.id}
                    role="button"
                    aria-label={tr(
                      `${note.midi === null ? "休止符" : midiToNoteName(note.midi)}，${durationName(note.durationBeats)}，第 ${note.beat + 1} 拍`,
                      `${note.midi === null ? "Rest" : midiToNoteName(note.midi)}, ${note.durationBeats} beats, starts at beat ${note.beat + 1}`,
                    )}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(note.id);
                    }}
                  >
                    {selected && <circle className="selection-halo" cx={x} cy={noteY} r="18" />}
                    {note.midi === null ? (
                      <text className="rest-glyph" x={x} y={noteY + 7}>𝄽</text>
                    ) : (
                      <>
                        {ledgerYs(noteY).map((y) => <line className="ledger-line" key={y} x1={x - 13} x2={x + 13} y1={y} y2={y} />)}
                        {accidentalGlyph && <text className="accidental-glyph" x={x - 20} y={noteY + 7}>{accidentalGlyph}</text>}
                        <ellipse className={openHead ? "note-head open" : "note-head"} cx={x} cy={noteY} rx="9" ry="6.5" transform={`rotate(-18 ${x} ${noteY})`} />
                        {type !== "whole" && (
                          <line className="note-stem" x1={stemX} x2={stemX} y1={noteY} y2={stemUp ? noteY - 34 : noteY + 34} />
                        )}
                        {(type === "eighth" || type === "16th") && (
                          <path
                            className="note-flag"
                            d={stemUp
                              ? `M ${stemX} ${noteY - 34} q 17 8 4 22`
                              : `M ${stemX} ${noteY + 34} q -17 -8 -4 -22`}
                          />
                        )}
                        {type === "16th" && (
                          <path
                            className="note-flag"
                            d={stemUp
                              ? `M ${stemX} ${noteY - 26} q 16 8 4 21`
                              : `M ${stemX} ${noteY + 26} q -16 -8 -4 -21`}
                          />
                        )}
                        {DURATION_OPTIONS.some((option) => Math.abs(option.beats * 1.5 - note.durationBeats) < 0.001) && (
                          <circle className="duration-dot" cx={x + 15} cy={noteY - 1} r="2.4" />
                        )}
                      </>
                    )}
                    <text className="beat-number" x={x} y="116">{note.beat + 1}</text>
                    <text className="lyric-text" x={x} y="140">{note.lyric || "·"}</text>
                  </g>
                );
              })}
              {cursorBeat >= systemStart && cursorBeat < systemStart + beatsPerSystem && (
                <g className="edit-cursor">
                  <line x1={xForBeat(cursorBeat)} x2={xForBeat(cursorBeat)} y1="35" y2="103" />
                  <path d={`M ${xForBeat(cursorBeat) - 5} 35 h 10 l -5 7 z`} />
                </g>
              )}
              {playbackBeat >= systemStart && playbackBeat < systemStart + beatsPerSystem && (
                <line className="composer-playhead" x1={xForBeat(playbackBeat)} x2={xForBeat(playbackBeat)} y1="32" y2="147" />
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function NumberedScoreCanvas({
  score,
  selectedId,
  cursorBeat,
  playbackBeat,
  onSelect,
  onMoveCursor,
}: {
  score: PitchScore;
  selectedId: string | null;
  cursorBeat: number;
  playbackBeat: number;
  onSelect: (id: string) => void;
  onMoveCursor: (beat: number) => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const beatsPerMeasure = score.timeSignature.beats;
  const measureCount = Math.max(1, Math.ceil(Math.max(scoreEndBeat(score), beatsPerMeasure) / beatsPerMeasure));

  return (
    <div className="numbered-scroll" role="application" aria-label={tr("可编辑简谱", "Editable numbered notation")}>
      <div className="numbered-key-line">
        <span>{tr("调号", "Key")} · 1 = <strong>{midiToNoteName(score.tuning.tonicMidi)}</strong></span>
        <span>{score.timeSignature.beats}/{score.timeSignature.beatUnit}</span>
        <span>♩ = {score.tempo.bpm}</span>
      </div>
      <div className="numbered-measures">
        {Array.from({ length: measureCount }, (_, measureIndex) => {
          const start = measureIndex * beatsPerMeasure;
          const end = start + beatsPerMeasure;
          const notes = score.notes.filter((note) => note.beat >= start && note.beat < end);
          const cursorHere = cursorBeat >= start && cursorBeat < end;
          const playheadHere = playbackBeat >= start && playbackBeat < end;
          return (
            <div
              className={`numbered-measure ${cursorHere ? "cursor-here" : ""}`}
              key={measureIndex}
              onClick={(event) => {
                const rect = event.currentTarget.getBoundingClientRect();
                onMoveCursor(quantizeBeat(start + ((event.clientX - rect.left) / rect.width) * beatsPerMeasure, 0.25));
              }}
            >
              <span className="numbered-measure-label">{measureIndex + 1}</span>
              {Array.from({ length: beatsPerMeasure }, (_, beat) => <i className="numbered-beat-guide" key={beat} style={{ left: `${(beat / beatsPerMeasure) * 100}%` }} />)}
              {notes.map((note) => {
                const left = ((note.beat - start) / beatsPerMeasure) * 100;
                const width = Math.max(12, (note.durationBeats / beatsPerMeasure) * 100);
                const numeral = note.midi === null ? "0" : note.numeral || numeralForMidi(note.midi, score.tuning.tonicMidi);
                const underlineCount = note.durationBeats <= 0.25 ? 2 : note.durationBeats <= 0.5 ? 1 : 0;
                return (
                  <button
                    className={`numbered-note ${selectedId === note.id ? "selected" : ""}`}
                    key={note.id}
                    style={{ left: `${left}%`, width: `${Math.min(100 - left, width)}%` }}
                    onClick={(event) => {
                      event.stopPropagation();
                      onSelect(note.id);
                    }}
                    aria-label={note.midi === null ? tr("休止符", "Rest") : midiToNoteName(note.midi)}
                  >
                    <strong>{numeral}</strong>
                    {underlineCount > 0 && <span className={`duration-underlines lines-${underlineCount}`} />}
                    {note.durationBeats > 1 && <span className="duration-dashes">{"—".repeat(Math.max(1, Math.round(note.durationBeats - 1)))}</span>}
                    <small>{note.lyric || (note.midi === null ? "" : midiToNoteName(note.midi))}</small>
                  </button>
                );
              })}
              {cursorHere && <b className="numbered-cursor" style={{ left: `${((cursorBeat - start) / beatsPerMeasure) * 100}%` }} />}
              {playheadHere && <b className="numbered-playhead" style={{ left: `${((playbackBeat - start) / beatsPerMeasure) * 100}%` }} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Waveform({
  values,
  playProgress,
  trimStart,
  trimEnd,
  duration,
  onSeek,
}: {
  values: number[];
  playProgress: number;
  trimStart: number;
  trimEnd: number;
  duration: number;
  onSeek: (seconds: number) => void;
}) {
  const count = Math.max(1, values.length);
  const startPercent = duration ? (trimStart / duration) * 100 : 0;
  const endPercent = duration ? (trimEnd / duration) * 100 : 100;
  return (
    <div
      className="waveform"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(((event.clientX - rect.left) / rect.width) * duration);
      }}
    >
      <div className="waveform-bars">
        {values.map((value, index) => (
          <i key={index} style={{ height: `${Math.max(5, value * 100)}%`, left: `${(index / count) * 100}%` }} />
        ))}
      </div>
      <div className="trim-shade start" style={{ width: `${startPercent}%` }} />
      <div className="trim-shade end" style={{ left: `${endPercent}%` }} />
      <div className="wave-playhead" style={{ left: `${playProgress * 100}%` }} />
      <span className="trim-handle start" style={{ left: `${startPercent}%` }} />
      <span className="trim-handle end" style={{ left: `${endPercent}%` }} />
    </div>
  );
}

export default function ScoreEditor({ initialScore, onCommit, onClose }: ScoreEditorProps) {
  const { locale, setLocale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const [draft, setDraft] = useState(() => cloneScore(initialScore));
  const [past, setPast] = useState<PitchScore[]>([]);
  const [future, setFuture] = useState<PitchScore[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialScore.notes[0]?.id ?? null);
  const [tool, setTool] = useState<EditorTool>("note");
  const [duration, setDuration] = useState(1);
  const [dotted, setDotted] = useState(false);
  const [accidental, setAccidental] = useState<Accidental>(0);
  const [inputOctave, setInputOctave] = useState(initialScore.notation?.clef === "bass" ? 3 : 4);
  const [cursorBeat, setCursorBeat] = useState(() => nextOpenBeat(initialScore));
  const [zoom, setZoom] = useState(3);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [toast, setToast] = useState("");
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackBeat, setPlaybackBeat] = useState(0);
  const [countIn, setCountIn] = useState(true);
  const [countdown, setCountdown] = useState(0);
  const [metronome, setMetronome] = useState(true);
  const [loop, setLoop] = useState(false);
  const [loopStartMeasure, setLoopStartMeasure] = useState(1);
  const [loopEndMeasure, setLoopEndMeasure] = useState(2);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [audioPanelOpen, setAudioPanelOpen] = useState(true);
  const [notationView, setNotationView] = useState<NotationView>("split");

  const notationInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);
  const audioElementRef = useRef<HTMLAudioElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledNodesRef = useRef<AudioScheduledSourceNode[]>([]);
  const playbackFrameRef = useRef<number | null>(null);
  const playbackTimersRef = useRef<number[]>([]);
  const playbackStartAtRef = useRef(0);
  const playbackStartBeatRef = useRef(0);
  const playbackDelayRef = useRef(0);
  const playingRef = useRef(false);

  const selectedNote = useMemo(
    () => draft.notes.find((note) => note.id === selectedId) ?? null,
    [draft.notes, selectedId],
  );
  const effectiveDuration = dotted ? duration * 1.5 : duration;
  const measureCount = Math.max(1, Math.ceil(Math.max(scoreEndBeat(draft), draft.timeSignature.beats) / draft.timeSignature.beats));
  const audioGuide = draft.audioGuide;
  const trimStart = Math.min(audioDuration, audioGuide?.trimStartSeconds ?? 0);
  const trimEnd = Math.min(audioDuration, audioGuide?.trimEndSeconds ?? audioDuration);
  const audioProgress = audioDuration ? audioCurrentTime / audioDuration : 0;

  const commit = useCallback((next: PitchScore | ((current: PitchScore) => PitchScore)) => {
    setDraft((current) => {
      const value = typeof next === "function" ? next(current) : next;
      if (value === current) return current;
      setPast((items) => [...items, cloneScore(current)].slice(-100));
      setFuture([]);
      return value;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((items) => {
      const previous = items.at(-1);
      if (!previous) return items;
      setDraft((current) => {
        setFuture((nextItems) => [cloneScore(current), ...nextItems].slice(0, 100));
        return previous;
      });
      return items.slice(0, -1);
    });
  }, []);

  const redo = useCallback(() => {
    setFuture((items) => {
      const next = items[0];
      if (!next) return items;
      setDraft((current) => {
        setPast((previousItems) => [...previousItems, cloneScore(current)].slice(-100));
        return next;
      });
      return items.slice(1);
    });
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(draft));
      setSavedAt(Date.now());
    }, 500);
    return () => window.clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(""), 2300);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const stopPlayback = useCallback((reset = false) => {
    playingRef.current = false;
    scheduledNodesRef.current.forEach((node) => {
      try { node.stop(); } catch { /* already stopped */ }
    });
    scheduledNodesRef.current = [];
    playbackTimersRef.current.forEach((timer) => window.clearTimeout(timer));
    playbackTimersRef.current = [];
    if (playbackFrameRef.current) cancelAnimationFrame(playbackFrameRef.current);
    playbackFrameRef.current = null;
    audioElementRef.current?.pause();
    setIsPlaying(false);
    setCountdown(0);
    if (reset) setPlaybackBeat(0);
  }, []);

  const startPlayback = useCallback(async (fromBeat = playbackBeat) => {
    stopPlayback(false);
    const context = audioContextRef.current ?? new AudioContext();
    audioContextRef.current = context;
    await context.resume();
    const secondsPerBeat = 60 / draft.tempo.bpm;
    const countInBeats = countIn ? draft.timeSignature.beats : 0;
    const delay = countInBeats * secondsPerBeat;
    const rangeStart = loop ? (loopStartMeasure - 1) * draft.timeSignature.beats : fromBeat;
    const loopEnd = Math.max(rangeStart + 0.25, loopEndMeasure * draft.timeSignature.beats);
    const audioScoreDuration = audioGuide && audioDuration
      ? audioGuide.offsetSeconds + Math.max(0, trimEnd - trimStart) / audioGuide.playbackRate
      : 0;
    const endBeat = loop
      ? loopEnd
      : Math.max(scoreEndBeat(draft), (audioScoreDuration * draft.tempo.bpm) / 60, draft.timeSignature.beats);
    const now = context.currentTime + 0.05;
    const master = context.createGain();
    master.gain.value = 0.2;
    master.connect(context.destination);

    draft.notes.forEach((note) => {
      if (note.midi === null || note.beat < rangeStart || note.beat >= endBeat) return;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = midiToFrequency(note.midi, draft.tuning.referenceHz);
      gain.gain.setValueAtTime(0, now + delay + (note.beat - rangeStart) * secondsPerBeat);
      gain.gain.linearRampToValueAtTime(0.7, now + delay + (note.beat - rangeStart) * secondsPerBeat + 0.012);
      const noteEnd = now + delay + (Math.min(endBeat, note.beat + note.durationBeats) - rangeStart) * secondsPerBeat;
      gain.gain.setValueAtTime(0.65, Math.max(now, noteEnd - 0.035));
      gain.gain.linearRampToValueAtTime(0, noteEnd);
      oscillator.connect(gain).connect(master);
      oscillator.start(now + delay + (note.beat - rangeStart) * secondsPerBeat);
      oscillator.stop(noteEnd + 0.02);
      scheduledNodesRef.current.push(oscillator);
    });

    if (metronome || countIn) {
      for (let beat = -countInBeats; beat < endBeat - rangeStart; beat += 1) {
        if (beat >= 0 && !metronome) continue;
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        const absoluteBeat = rangeStart + Math.max(0, beat);
        oscillator.frequency.value = absoluteBeat % draft.timeSignature.beats === 0 ? 1320 : 920;
        gain.gain.setValueAtTime(0.55, now + delay + beat * secondsPerBeat);
        gain.gain.exponentialRampToValueAtTime(0.001, now + delay + beat * secondsPerBeat + 0.045);
        oscillator.connect(gain).connect(context.destination);
        oscillator.start(now + delay + beat * secondsPerBeat);
        oscillator.stop(now + delay + beat * secondsPerBeat + 0.05);
        scheduledNodesRef.current.push(oscillator);
      }
    }

    if (audioUrl && audioElementRef.current && audioGuide) {
      const audio = audioElementRef.current;
      audio.volume = audioGuide.gain;
      audio.playbackRate = audioGuide.playbackRate;
      const scoreSecond = rangeStart * secondsPerBeat;
      const waitSeconds = Math.max(0, audioGuide.offsetSeconds - scoreSecond);
      const sourceSecond = trimStart + Math.max(0, scoreSecond - audioGuide.offsetSeconds) * audioGuide.playbackRate;
      audio.currentTime = Math.min(trimEnd, sourceSecond);
      if (sourceSecond < trimEnd) {
        const timer = window.setTimeout(() => void audio.play(), (delay + waitSeconds) * 1000);
        playbackTimersRef.current.push(timer);
      }
    }

    playbackStartAtRef.current = performance.now();
    playbackStartBeatRef.current = rangeStart;
    playbackDelayRef.current = delay;
    playingRef.current = true;
    setIsPlaying(true);
    setPlaybackBeat(rangeStart);

    const tick = () => {
      if (!playingRef.current) return;
      const elapsed = (performance.now() - playbackStartAtRef.current) / 1000;
      if (elapsed < delay) {
        setCountdown(Math.ceil((delay - elapsed) / secondsPerBeat));
      } else {
        setCountdown(0);
        const beat = rangeStart + (elapsed - delay) / secondsPerBeat;
        setPlaybackBeat(Math.min(endBeat, beat));
        if (audioElementRef.current && audioElementRef.current.currentTime >= trimEnd) audioElementRef.current.pause();
        if (beat >= endBeat) {
          stopPlayback(false);
          if (loop) {
            const timer = window.setTimeout(() => void startPlayback(rangeStart), 30);
            playbackTimersRef.current.push(timer);
          }
          return;
        }
      }
      playbackFrameRef.current = requestAnimationFrame(tick);
    };
    playbackFrameRef.current = requestAnimationFrame(tick);
  }, [audioDuration, audioGuide, audioUrl, countIn, draft, loop, loopEndMeasure, loopStartMeasure, metronome, playbackBeat, stopPlayback, trimEnd, trimStart]);

  useEffect(() => () => {
    stopPlayback(false);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    void audioContextRef.current?.close();
  }, [audioUrl, stopPlayback]);

  const addNote = useCallback((midi: number | null, beat = cursorBeat) => {
    const note: ScoreNote = {
      id: makeNoteId(),
      midi,
      beat: quantizeBeat(beat, 0.25),
      durationBeats: effectiveDuration,
      spelling: midi === null ? undefined : midiSpelling(midi, draft.notation?.keySignature),
      numeral: midi === null ? undefined : numeralForMidi(midi, draft.tuning.tonicMidi),
      lyric: "",
    };
    commit((current) => placeNote(current, note));
    setSelectedId(note.id);
    setCursorBeat(note.beat + note.durationBeats);
  }, [commit, cursorBeat, draft.notation?.keySignature, draft.tuning.tonicMidi, effectiveDuration]);

  const addNumeral = useCallback((degree: number) => {
    if (degree === 0) {
      addNote(null);
      return;
    }
    const intervals = [0, 2, 4, 5, 7, 9, 11];
    const tonicPitchClass = ((draft.tuning.tonicMidi % 12) + 12) % 12;
    const midi = Math.max(0, Math.min(127, (inputOctave + 1) * 12 + tonicPitchClass + intervals[degree - 1] + accidental));
    addNote(midi);
  }, [accidental, addNote, draft.tuning.tonicMidi, inputOctave]);

  function duplicateSelected() {
    if (!selectedNote) return;
    const copy = { ...selectedNote, id: makeNoteId(), beat: selectedNote.beat + selectedNote.durationBeats };
    commit((current) => placeNote(current, copy));
    setSelectedId(copy.id);
    setCursorBeat(copy.beat + copy.durationBeats);
  }

  function removeSelected() {
    if (!selectedId) return;
    commit((current) => deleteNote(current, selectedId));
    const previousIndex = draft.notes.findIndex((note) => note.id === selectedId);
    setSelectedId(draft.notes[previousIndex - 1]?.id ?? draft.notes[previousIndex + 1]?.id ?? null);
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement;
      if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) return;
      const command = event.metaKey || event.ctrlKey;
      if (command && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (command && event.key.toLowerCase() === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (event.code === "Space") {
        event.preventDefault();
        if (isPlaying) stopPlayback(false);
        else void startPlayback();
        return;
      }
      if (notationView !== "staff" && /^[0-7]$/.test(event.key)) {
        event.preventDefault();
        addNumeral(Number(event.key));
        return;
      }
      const durationIndex = Number(event.key) - 1;
      if (notationView === "staff" && durationIndex >= 0 && durationIndex < DURATION_OPTIONS.length) {
        setDuration(DURATION_OPTIONS[durationIndex].beats);
        return;
      }
      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        setTool("rest");
        addNote(null);
        return;
      }
      if ("abcdefg".includes(event.key.toLowerCase())) {
        event.preventDefault();
        const step = event.key.toUpperCase();
        addNote(midiFromStep(step, inputOctave, accidental));
        return;
      }
      if (event.key === "Backspace" || event.key === "Delete") {
        event.preventDefault();
        removeSelected();
        return;
      }
      if (selectedNote?.midi !== null && selectedNote && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
        event.preventDefault();
        const amount = (event.shiftKey ? 12 : 1) * (event.key === "ArrowUp" ? 1 : -1);
        const midi = Math.max(0, Math.min(127, selectedNote.midi + amount));
        commit((current) => updateNote(current, selectedNote.id, {
          midi,
          spelling: midiSpelling(midi, current.notation?.keySignature),
          numeral: numeralForMidi(midi, current.tuning.tonicMidi),
        }));
      }
      if (selectedNote && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        const index = draft.notes.findIndex((note) => note.id === selectedNote.id);
        const next = draft.notes[index + (event.key === "ArrowRight" ? 1 : -1)];
        if (next) {
          setSelectedId(next.id);
          setCursorBeat(next.beat);
        }
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [accidental, addNote, addNumeral, commit, draft.notes, inputOctave, isPlaying, notationView, redo, selectedNote, startPlayback, stopPlayback, undo]);

  async function attachAudio(file: File | undefined) {
    if (!file) return;
    try {
      const context = new AudioContext();
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const channel = decoded.getChannelData(0);
      const bars = 240;
      const chunk = Math.max(1, Math.floor(channel.length / bars));
      const values = Array.from({ length: bars }, (_, index) => {
        let peak = 0;
        for (let sample = index * chunk; sample < Math.min(channel.length, (index + 1) * chunk); sample += 8) {
          peak = Math.max(peak, Math.abs(channel[sample]));
        }
        return peak;
      });
      await context.close();
      if (audioUrl) URL.revokeObjectURL(audioUrl);
      setAudioUrl(URL.createObjectURL(file));
      setAudioDuration(decoded.duration);
      setAudioCurrentTime(0);
      setWaveform(values);
      commit((current) => ({
        ...current,
        audioGuide: {
          name: file.name,
          trimStartSeconds: 0,
          trimEndSeconds: decoded.duration,
          offsetSeconds: 0,
          gain: 0.75,
          playbackRate: 1,
        },
      }));
      setToast(tr("参考音频已加载，可在波形上定位", "Reference audio loaded. Click the waveform to seek."));
    } catch {
      setToast(tr("无法读取这份音频，请尝试 WAV、MP3、M4A 或 WebM", "Could not read this audio. Try WAV, MP3, M4A, or WebM."));
    } finally {
      if (audioInputRef.current) audioInputRef.current.value = "";
    }
  }

  async function importNotation(file: File | undefined) {
    if (!file) return;
    try {
      const imported = await parseNotationFile(file);
      commit(cloneScore(imported));
      setSelectedId(imported.notes[0]?.id ?? null);
      setCursorBeat(nextOpenBeat(imported));
      setToast(tr(`已导入《${imported.metadata.title}》`, `Imported “${imported.metadata.title}”.`));
    } catch (error) {
      setToast(error instanceof Error && locale === "zh-CN" ? error.message : tr("曲谱导入失败", "Score import failed."));
    } finally {
      if (notationInputRef.current) notationInputRef.current.value = "";
    }
  }

  function exportScore(kind: "json" | "musicxml" | "midi") {
    const base = safeFileBase(draft.metadata.title);
    if (kind === "json") {
      downloadBlob(new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }), `${base}.singright.json`);
    } else if (kind === "musicxml") {
      downloadBlob(new Blob([scoreToMusicXml(draft)], { type: "application/vnd.recordare.musicxml+xml" }), `${base}.musicxml`);
    } else {
      const midi = scoreToMidi(draft);
      downloadBlob(new Blob([midi.buffer as ArrayBuffer], { type: "audio/midi" }), `${base}.mid`);
    }
  }

  function save(close: boolean) {
    try {
      const valid = validateScore(draft);
      onCommit(valid, close);
      setSavedAt(Date.now());
      setToast(close ? tr("曲谱已保存，正在返回练习室", "Score saved. Returning to practice.") : tr("曲谱已保存到曲目列表", "Score saved to your library."));
    } catch (error) {
      setToast(error instanceof Error && locale === "zh-CN" ? error.message : tr("曲谱校验失败", "Score validation failed."));
    }
  }

  function recoverAutosave() {
    try {
      const stored = localStorage.getItem(AUTOSAVE_KEY);
      if (!stored) {
        setToast(tr("没有找到可恢复的草稿", "No recoverable draft was found."));
        return;
      }
      const recovered = validateScore(JSON.parse(stored) as unknown);
      commit(cloneScore(recovered));
      setSelectedId(recovered.notes[0]?.id ?? null);
      setCursorBeat(nextOpenBeat(recovered));
      setToast(tr("已恢复自动保存的草稿", "Autosaved draft restored."));
    } catch {
      setToast(tr("自动保存的草稿已经损坏", "The autosaved draft is damaged."));
    }
  }

  function patchSelected(patch: Partial<ScoreNote>) {
    if (!selectedNote) return;
    commit((current) => updateNote(current, selectedNote.id, patch));
  }

  return (
    <div className="composer-shell">
      <header className="composer-topbar">
        <div className="composer-document">
          <button className="icon-button back" onClick={onClose} aria-label={tr("返回练习室", "Back to practice")}><ArrowLeft /></button>
          <div className="composer-brand"><span><ListMusic /></span><div><small>SINGRIGHT COMPOSER</small><strong>{tr("曲谱工作台", "Score workspace")}</strong></div></div>
          <i />
          <div className="document-status">
            <strong>{draft.metadata.title || tr("未命名曲谱", "Untitled score")}</strong>
            <span>{savedAt
              ? tr(
                `草稿已自动保存 · ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}`,
                `Autosaved · ${new Date(savedAt).toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit" })}`,
              )
              : tr("正在准备自动保存", "Preparing autosave")}</span>
          </div>
        </div>
        <div className="composer-actions">
          <button className="icon-button" disabled={!past.length} onClick={undo} title={tr("撤销（⌘Z）", "Undo (⌘Z)")}><Undo2 /></button>
          <button className="icon-button" disabled={!future.length} onClick={redo} title={tr("重做（⇧⌘Z）", "Redo (⇧⌘Z)")}><Redo2 /></button>
          <div className="composer-language">
            <Languages />
            <select value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en")} aria-label={tr("界面语言", "Interface language")}>
              <option value="zh-CN">中文</option>
              <option value="en">EN</option>
            </select>
          </div>
          <button className="text-button" onClick={recoverAutosave}><RotateCcw /> {tr("恢复草稿", "Restore draft")}</button>
          <button className="text-button" onClick={() => notationInputRef.current?.click()}><FileInput /> {tr("导入", "Import")}</button>
          <input ref={notationInputRef} type="file" accept=".json,.singright.json,.musicxml,.xml,application/json,application/xml,text/xml" hidden onChange={(event) => void importNotation(event.target.files?.[0])} />
          <div className="export-menu">
            <button className="text-button"><Download /> {tr("导出", "Export")}</button>
            <div><button onClick={() => exportScore("json")}>SingRight JSON<small>{tr("继续编辑与练唱", "Keep editing and practicing")}</small></button><button onClick={() => exportScore("musicxml")}>MusicXML<small>MuseScore / Sibelius</small></button><button onClick={() => exportScore("midi")}>{tr("标准 MIDI", "Standard MIDI")}<small>{tr("用于编曲软件", "For music production tools")}</small></button></div>
          </div>
          <button className="save-button" onClick={() => save(false)}><Save /> {tr("保存", "Save")}</button>
          <button className="practice-button" onClick={() => save(true)}><Headphones /> {tr("保存并练习", "Save & practice")}</button>
        </div>
      </header>

      <div className="composer-body">
        <aside className="composer-toolbox">
          <div className="tool-section">
            <span className="tool-section-title">{tr("输入工具", "Input tools")}</span>
            <div className="tool-mode-grid">
              <button className={tool === "select" ? "active" : ""} onClick={() => setTool("select")}><MousePointer2 /><span>{tr("选择", "Select")}</span><small>{tr("移动光标", "Move cursor")}</small></button>
              <button className={tool === "note" ? "active" : ""} onClick={() => setTool("note")}><Music /><span>{tr("音符", "Note")}</span><small>{tr("点击谱面", "Click score")}</small></button>
              <button className={tool === "rest" ? "active" : ""} onClick={() => setTool("rest")}><span className="rest-tool">0</span><span>{tr("休止", "Rest")}</span><small>{tr("填充空拍", "Fill silence")}</small></button>
            </div>
          </div>

          <div className="tool-section numeral-input-section">
            <div className="tool-section-title"><span>{tr("简谱录入", "Numbered input")}</span><small>{tr("快捷键 0–7", "Keys 0–7")}</small></div>
            <div className="numeral-input-grid">
              {[1, 2, 3, 4, 5, 6, 7].map((degree) => <button key={degree} onClick={() => addNumeral(degree)}><strong>{degree}</strong><small>{midiToNoteName(((inputOctave + 1) * 12) + (((draft.tuning.tonicMidi % 12) + 12) % 12) + [0, 2, 4, 5, 7, 9, 11][degree - 1] + accidental)}</small></button>)}
              <button className="numeral-rest" onClick={() => addNumeral(0)}><strong>0</strong><small>{tr("休止", "Rest")}</small></button>
            </div>
          </div>

          <div className="tool-section">
            <div className="tool-section-title"><span>{tr("音符时值", "Duration")}</span><small>{notationView === "staff" ? tr("快捷键 1–5", "Keys 1–5") : tr("点击选择", "Click to select")}</small></div>
            <div className="duration-grid">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.beats}
                  className={duration === option.beats ? "active" : ""}
                  onClick={() => setDuration(option.beats)}
                  title={tr(`${option.label}（${option.shortcut}）`, `${option.beats} beats`)}
                ><strong>{option.glyph}</strong><span>{locale === "zh-CN" ? option.label.replace("音符", "") : `${option.beats}`}</span>{notationView === "staff" && <kbd>{option.shortcut}</kbd>}</button>
              ))}
            </div>
            <button className={`dot-toggle ${dotted ? "active" : ""}`} onClick={() => setDotted((value) => !value)}>
              <i /> {tr("附点", "Dotted")} <span>{dotted ? tr(`${effectiveDuration} 拍`, `${effectiveDuration} beats`) : tr("延长一半", "Add half")}</span>
            </button>
          </div>

          <div className="tool-section">
            <span className="tool-section-title">{tr("升降记号", "Accidental")}</span>
            <div className="accidental-grid">
              {([
                { value: -1, glyph: "♭", label: tr("降", "Flat") },
                { value: 0, glyph: "♮", label: tr("还原", "Natural") },
                { value: 1, glyph: "♯", label: tr("升", "Sharp") },
              ] as const).map((item) => (
                <button className={accidental === item.value ? "active" : ""} key={item.value} onClick={() => setAccidental(item.value)}>
                  <strong>{item.glyph}</strong><span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="tool-section piano-section">
            <div className="tool-section-title"><span>{tr("字母键盘输入", "Letter input")}</span><small>A–G</small></div>
            <div className="octave-stepper">
              <button onClick={() => setInputOctave((value) => Math.max(1, value - 1))}><Minus /></button>
              <span>{tr("八度", "Octave")} <strong>{inputOctave}</strong></span>
              <button onClick={() => setInputOctave((value) => Math.min(7, value + 1))}><Plus /></button>
            </div>
            <div className="mini-piano">
              {PITCH_CLASSES.map((key) => {
                const black = key.accidental !== 0;
                return (
                  <button
                    className={black ? "black" : "white"}
                    key={key.label}
                    onClick={() => addNote(midiFromStep(key.step, inputOctave, key.accidental))}
                    aria-label={tr(`输入 ${key.label}${inputOctave}`, `Enter ${key.label}${inputOctave}`)}
                  >{key.label}</button>
                );
              })}
            </div>
          </div>

          <div className="shortcut-note">
            <Keyboard />
            <div><strong>{tr("高效录入", "Keyboard workflow")}</strong><span>{tr("A–G 输入音符 · 0–7 输入简谱<br />方向键选音/移调 · 空格试听", "A–G enter notes · 0–7 numbered input<br />Arrows select/transpose · Space plays")}</span></div>
          </div>
        </aside>

        <main className="composer-workspace">
          <section className="score-setup-bar">
            <label><span>{tr("速度", "Tempo")}</span><div><input type="number" min="20" max="300" value={draft.tempo.bpm} onChange={(event) => commit((current) => ({ ...current, tempo: { bpm: Math.max(20, Math.min(300, Number(event.target.value))) } }))} /><small>BPM</small></div></label>
            <label><span>{tr("拍号", "Time")}</span><div><select value={draft.timeSignature.beats} onChange={(event) => commit((current) => ({ ...current, timeSignature: { ...current.timeSignature, beats: Number(event.target.value) } }))}>{[2, 3, 4, 5, 6, 7, 9, 12].map((value) => <option key={value}>{value}</option>)}</select><b>/</b><select value={draft.timeSignature.beatUnit} onChange={(event) => commit((current) => ({ ...current, timeSignature: { ...current.timeSignature, beatUnit: Number(event.target.value) as 1 | 2 | 4 | 8 | 16 } }))}>{[2, 4, 8, 16].map((value) => <option key={value}>{value}</option>)}</select></div></label>
            <label className="key-field"><span>{tr("调号", "Key")}</span><select value={draft.notation?.keySignature ?? 0} onChange={(event) => commit((current) => ({ ...current, notation: { clef: current.notation?.clef ?? "treble", keySignature: Number(event.target.value) } }))}>{KEY_SIGNATURES.map((key) => <option key={key.fifths} value={key.fifths}>{localizedKeyName(key.name, locale)}</option>)}</select></label>
            <label><span>{tr("谱号", "Clef")}</span><select value={draft.notation?.clef ?? "treble"} onChange={(event) => commit((current) => ({ ...current, notation: { keySignature: current.notation?.keySignature ?? 0, clef: event.target.value as Clef } }))}><option value="treble">𝄞 {tr("高音谱号", "Treble")}</option><option value="bass">𝄢 {tr("低音谱号", "Bass")}</option></select></label>
            <div className="setup-summary"><Grid2X2 /><span><strong>{measureCount}</strong> {tr("小节", "measures")}</span><span><strong>{draft.notes.length}</strong> {tr("音符", "notes")}</span></div>
          </section>

          <section className="score-paper">
            <div className="paper-toolbar">
              <div className="editor-transport">
                <button className="jump-start" onClick={() => { stopPlayback(false); setPlaybackBeat(0); }} title={tr("回到开头", "Go to start")}>|‹</button>
                <button className={`editor-play ${isPlaying ? "playing" : ""}`} onClick={() => isPlaying ? stopPlayback(false) : void startPlayback()}>
                  {isPlaying ? <Pause fill="currentColor" /> : <Play fill="currentColor" />}
                  {countdown ? `${countdown}…` : isPlaying ? tr("暂停试听", "Pause") : tr("试听谱面", "Play score")}
                </button>
                <button className="stop-playback" onClick={() => stopPlayback(true)}><CircleStop /> {tr("停止", "Stop")}</button>
              </div>
              <div className="play-options">
                <label><input type="checkbox" checked={countIn} onChange={(event) => setCountIn(event.target.checked)} /> {tr("预备拍", "Count-in")}</label>
                <label><input type="checkbox" checked={metronome} onChange={(event) => setMetronome(event.target.checked)} /> {tr("节拍器", "Metronome")}</label>
                <label><input type="checkbox" checked={loop} onChange={(event) => setLoop(event.target.checked)} /> {tr("循环", "Loop")}</label>
                {loop && <span className="loop-range">{tr("第", "Bar")} <input type="number" min="1" max={measureCount} value={loopStartMeasure} onChange={(event) => setLoopStartMeasure(Math.max(1, Number(event.target.value)))} /> {tr("至", "to")} <input type="number" min={loopStartMeasure} max={measureCount + 1} value={loopEndMeasure} onChange={(event) => setLoopEndMeasure(Math.max(loopStartMeasure, Number(event.target.value)))} /> {tr("小节", "")}</span>}
              </div>
              <div className="notation-view-tabs" aria-label={tr("谱面显示", "Notation view")}>
                {([
                  ["staff", tr("五线谱", "Staff")],
                  ["numbered", tr("简谱", "Numbered")],
                  ["split", tr("对照", "Split")],
                ] as Array<[NotationView, string]>).map(([value, label]) => <button className={notationView === value ? "active" : ""} key={value} onClick={() => setNotationView(value)}>{label}</button>)}
              </div>
              <div className="zoom-control"><span>{tr("谱面", "Zoom")}</span><button onClick={() => setZoom((value) => Math.max(1, value - 1))}><Minus /></button><strong>{Math.round((zoom / 3) * 100)}%</strong><button onClick={() => setZoom((value) => Math.min(5, value + 1))}><Plus /></button></div>
            </div>
            <div className="paper-title">
              <div><h1>{draft.metadata.title || tr("未命名曲谱", "Untitled score")}</h1><p>{draft.metadata.artist || tr("词曲作者", "Writer / composer")}</p></div>
              <span>♩ = {draft.tempo.bpm}</span>
            </div>
            {(notationView === "staff" || notationView === "split") && <StaffCanvas
                score={draft}
                selectedId={selectedId}
                cursorBeat={cursorBeat}
                playbackBeat={playbackBeat}
                zoom={zoom}
                tool={tool}
                accidental={accidental}
                onCanvasAction={(beat, midi) => addNote(tool === "rest" ? null : midi, beat)}
                onSelect={(id) => {
                  setSelectedId(id);
                  const note = draft.notes.find((candidate) => candidate.id === id);
                  if (note) setCursorBeat(note.beat);
                }}
                onMoveCursor={setCursorBeat}
              />}
            {(notationView === "numbered" || notationView === "split") && <NumberedScoreCanvas
              score={draft}
              selectedId={selectedId}
              cursorBeat={cursorBeat}
              playbackBeat={playbackBeat}
              onSelect={(id) => {
                setSelectedId(id);
                const note = draft.notes.find((candidate) => candidate.id === id);
                if (note) setCursorBeat(note.beat);
              }}
              onMoveCursor={setCursorBeat}
            />}
            <div className="paper-footer"><span>{tr("单声部旋律谱 · 五线谱点谱，或用 0–7 快速录入简谱", "Monophonic melody · Click the staff or use 0–7 for numbered entry")}</span><strong>{tr(`第 ${Math.floor(cursorBeat / draft.timeSignature.beats) + 1} 小节 · 第 ${(cursorBeat % draft.timeSignature.beats) + 1} 拍`, `Bar ${Math.floor(cursorBeat / draft.timeSignature.beats) + 1} · Beat ${(cursorBeat % draft.timeSignature.beats) + 1}`)}</strong></div>
          </section>

          <section className={`audio-guide-panel ${audioPanelOpen ? "open" : ""}`}>
            <button className="audio-panel-heading" onClick={() => setAudioPanelOpen((value) => !value)}>
              <div><span className="audio-track-icon"><AudioWaveform /></span><span><strong>{tr("参考音频轨", "Reference audio track")}</strong><small>{tr("听原曲、看波形、对齐拍点后打谱", "Listen, inspect the waveform, align beats, and notate")}</small></span></div>
              <i>{audioPanelOpen ? tr("收起", "Collapse") : tr("展开", "Expand")}</i>
            </button>
            {audioPanelOpen && (
              <div className="audio-panel-body">
                {!audioUrl ? (
                  <div className="audio-drop">
                    <FileAudio2 />
                    <div><strong>{audioGuide ? tr(`请重新选择：${audioGuide.name}`, `Relink: ${audioGuide.name}`) : tr("添加参考音频", "Add reference audio")}</strong><span>{tr("音频只在本机打开，不会写入曲谱或上传", "Audio opens locally and is never embedded or uploaded")}</span></div>
                    <button onClick={() => audioInputRef.current?.click()}>{audioGuide ? tr("重新关联文件", "Relink file") : tr("选择音频", "Choose audio")}</button>
                  </div>
                ) : (
                  <>
                    <div className="wave-track-info">
                      <button onClick={() => {
                        if (!audioElementRef.current) return;
                        if (audioElementRef.current.paused) void audioElementRef.current.play();
                        else audioElementRef.current.pause();
                      }}><Play /></button>
                      <span><strong>{audioGuide?.name}</strong><small>{Math.floor(audioDuration / 60)}:{String(Math.floor(audioDuration % 60)).padStart(2, "0")} · {tr("本机音频", "Local audio")}</small></span>
                      <Volume2 />
                    </div>
                    <Waveform
                      values={waveform}
                      playProgress={audioProgress}
                      trimStart={trimStart}
                      trimEnd={trimEnd}
                      duration={audioDuration}
                      onSeek={(seconds) => {
                        if (audioElementRef.current) audioElementRef.current.currentTime = seconds;
                        setAudioCurrentTime(seconds);
                      }}
                    />
                    <div className="audio-edit-controls">
                      <label><Scissors /><span>{tr("裁剪开始", "Trim start")}</span><input type="number" min="0" max={trimEnd} step="0.1" value={trimStart.toFixed(1)} onChange={(event) => commit((current) => ({ ...current, audioGuide: current.audioGuide ? { ...current.audioGuide, trimStartSeconds: Math.min(trimEnd, Number(event.target.value)) } : undefined }))} /><small>s</small></label>
                      <label><Scissors /><span>{tr("裁剪结束", "Trim end")}</span><input type="number" min={trimStart} max={audioDuration} step="0.1" value={trimEnd.toFixed(1)} onChange={(event) => commit((current) => ({ ...current, audioGuide: current.audioGuide ? { ...current.audioGuide, trimEndSeconds: Math.max(trimStart, Number(event.target.value)) } : undefined }))} /><small>s</small></label>
                      <label><Clock3 /><span>{tr("谱前偏移", "Offset")}</span><input type="number" min="-30" max="30" step="0.1" value={audioGuide?.offsetSeconds ?? 0} onChange={(event) => commit((current) => ({ ...current, audioGuide: current.audioGuide ? { ...current.audioGuide, offsetSeconds: Number(event.target.value) } : undefined }))} /><small>s</small></label>
                      <label><Volume2 /><span>{tr("音量", "Gain")}</span><input type="range" min="0" max="1" step="0.05" value={audioGuide?.gain ?? 0.75} onChange={(event) => commit((current) => ({ ...current, audioGuide: current.audioGuide ? { ...current.audioGuide, gain: Number(event.target.value) } : undefined }))} /></label>
                      <label><Repeat2 /><span>{tr("速度", "Speed")}</span><select value={audioGuide?.playbackRate ?? 1} onChange={(event) => commit((current) => ({ ...current, audioGuide: current.audioGuide ? { ...current.audioGuide, playbackRate: Number(event.target.value) } : undefined }))}><option value="0.5">0.5×</option><option value="0.75">0.75×</option><option value="1">1×</option><option value="1.25">1.25×</option><option value="1.5">1.5×</option></select></label>
                    </div>
                  </>
                )}
                <input ref={audioInputRef} type="file" accept="audio/*" hidden onChange={(event) => void attachAudio(event.target.files?.[0])} />
                <audio ref={audioElementRef} src={audioUrl || undefined} onTimeUpdate={(event) => setAudioCurrentTime(event.currentTarget.currentTime)} />
              </div>
            )}
          </section>
        </main>

        <aside className="composer-inspector">
          <div className="inspector-head"><span>{tr("属性检查器", "INSPECTOR")}</span><strong>{selectedNote ? tr("当前音符", "Current note") : tr("曲谱信息", "Score info")}</strong></div>
          <section className="document-fields">
            <label><span>{tr("曲名", "Title")}</span><input value={draft.metadata.title} onChange={(event) => commit((current) => ({ ...current, metadata: { ...current.metadata, title: event.target.value } }))} /></label>
            <label><span>{tr("词曲作者", "Writer / composer")}</span><input value={draft.metadata.artist ?? ""} placeholder={tr("选填", "Optional")} onChange={(event) => commit((current) => ({ ...current, metadata: { ...current.metadata, artist: event.target.value } }))} /></label>
            <label><span>{tr("说明", "Description")}</span><textarea rows={2} value={draft.metadata.description ?? ""} placeholder={tr("练习提示、歌曲段落等", "Practice notes, sections, etc.")} onChange={(event) => commit((current) => ({ ...current, metadata: { ...current.metadata, description: event.target.value } }))} /></label>
          </section>

          {selectedNote ? (
            <section className="note-inspector">
              <div className="selected-note-card">
                <div className={selectedNote.midi === null ? "rest" : ""}>{selectedNote.midi === null ? "0" : "♩"}</div>
                <span><strong>{selectedNote.midi === null ? tr("休止符", "Rest") : midiToNoteName(selectedNote.midi)}</strong><small>{locale === "zh-CN" ? durationName(selectedNote.durationBeats) : `${selectedNote.durationBeats} beats`} · {tr(`第 ${selectedNote.beat + 1} 拍`, `Beat ${selectedNote.beat + 1}`)}</small></span>
              </div>
              {selectedNote.midi !== null && (
                <label><span>{tr("音高", "Pitch")}</span><div className="stepper wide"><button onClick={() => {
                  const midi = Math.max(0, selectedNote.midi! - 1);
                  patchSelected({ midi, spelling: midiSpelling(midi, draft.notation?.keySignature), numeral: numeralForMidi(midi, draft.tuning.tonicMidi) });
                }}><Minus /></button><strong>{midiToNoteName(selectedNote.midi)}</strong><button onClick={() => {
                  const midi = Math.min(127, selectedNote.midi! + 1);
                  patchSelected({ midi, spelling: midiSpelling(midi, draft.notation?.keySignature), numeral: numeralForMidi(midi, draft.tuning.tonicMidi) });
                }}><Plus /></button></div></label>
              )}
              <label><span>{tr("起始拍", "Start beat")}</span><input type="number" min="0" step="0.25" value={selectedNote.beat} onChange={(event) => patchSelected({ beat: Math.max(0, Number(event.target.value)) })} /></label>
              <label><span>{tr("时值", "Duration")}</span><select value={selectedNote.durationBeats} onChange={(event) => patchSelected({ durationBeats: Number(event.target.value) })}>{DURATION_OPTIONS.flatMap((option) => [<option key={option.beats} value={option.beats}>{locale === "zh-CN" ? option.label : `${option.beats} beats`}</option>, <option key={`${option.beats}-dot`} value={option.beats * 1.5}>{locale === "zh-CN" ? `附点${option.label} · ${option.beats * 1.5} 拍` : `Dotted · ${option.beats * 1.5} beats`}</option>])}</select></label>
              {selectedNote.midi !== null && <label><span>{tr("简谱音级", "Numbered degree")}</span><input value={selectedNote.numeral ?? ""} placeholder={numeralForMidi(selectedNote.midi, draft.tuning.tonicMidi)} onChange={(event) => patchSelected({ numeral: event.target.value })} /></label>}
              <label><span>{tr("歌词", "Lyric")}</span><input value={selectedNote.lyric ?? ""} placeholder={tr("当前音对应的字", "Syllable for this note")} onChange={(event) => patchSelected({ lyric: event.target.value })} /></label>
              <div className="note-actions"><button onClick={duplicateSelected}><Copy /> {tr("复制到下一拍", "Duplicate next")}</button><button className="danger" onClick={removeSelected}><Trash2 /> {tr("删除", "Delete")}</button></div>
            </section>
          ) : (
            <div className="inspector-empty"><MousePointer2 /><strong>{tr("选择一个音符", "Select a note")}</strong><span>{tr("点击五线谱或简谱中的音符，在这里精确编辑音高、拍点、时值、简谱音级和歌词。", "Click a note in either notation view to edit pitch, timing, duration, numbered degree, and lyrics.")}</span></div>
          )}

          <section className="tuning-fields">
            <div className="inspector-section-title"><AlignLeft /><span><strong>{tr("练唱基准", "Practice tuning")}</strong><small>{tr("保存后直接用于音准判定", "Used for pitch scoring after save")}</small></span></div>
            <label><span>{tr("简谱 1 =", "Numbered 1 =")}</span><select value={draft.tuning.tonicMidi} onChange={(event) => commit((current) => ({ ...current, tuning: { ...current.tuning, tonicMidi: Number(event.target.value) } }))}>{Array.from({ length: 36 }, (_, index) => 48 + index).map((midi) => <option key={midi} value={midi}>{midiToNoteName(midi)}</option>)}</select></label>
            <label><span>{tr("A4 基准", "A4 reference")}</span><div><input type="number" min="430" max="450" value={draft.tuning.referenceHz} onChange={(event) => commit((current) => ({ ...current, tuning: { ...current.tuning, referenceHz: Number(event.target.value) } }))} /><small>Hz</small></div></label>
          </section>

          <div className="editor-help">
            <strong>{tr("不会写五线谱？", "New to staff notation?")}</strong>
            <p>{tr("切换到“简谱”，用 1–7 输入音级、0 输入休止；也可在五线谱上点谱。橙色光标会自动前进。", "Switch to Numbered and use 1–7 for scale degrees or 0 for rests; you can also click the staff. The orange cursor advances automatically.")}</p>
          </div>
        </aside>
      </div>
      {toast && <div className="composer-toast"><span>✓</span>{toast}<button onClick={() => setToast("")}><X /></button></div>}
    </div>
  );
}
