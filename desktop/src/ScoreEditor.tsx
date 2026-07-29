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
  Link2,
  ListMusic,
  Minus,
  MousePointer2,
  Pause,
  Play,
  Plus,
  Redo2,
  Repeat2,
  RotateCcw,
  Save,
  Scissors,
  Settings2,
  Trash2,
  Undo2,
  Volume2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";
import { localize, useI18n } from "./i18n";
import { saveBlob } from "./lib/download";
import {
  DURATION_OPTIONS,
  EDIT_GRID_BEATS,
  KEY_SIGNATURES,
  activeClefAt,
  activeKeySignatureAt,
  canTieToNext,
  cloneScore,
  deleteNote,
  durationName,
  makeNoteId,
  measureLengthBeats,
  mergeTiedNotes,
  midiSpelling,
  nextMeasureBeat,
  nextOpenBeat,
  notePlacementIssue,
  noteTypeForBeats,
  parseSpelling,
  placeNote,
  quantizeBeat,
  restGlyphForBeats,
  scoreEndBeat,
  staffYForMidi,
  toggleRepeatMarker,
  upsertClefChange,
  upsertKeySignatureChange,
  updateNote,
} from "./lib/composer";
import type { Accidental, Clef } from "./lib/composer";
import {
  DEFAULT_SHORTCUTS,
  loadEditorPreferences,
  matchesShortcut,
  saveEditorPreferences,
  shortcutFromEvent,
  shortcutLabel,
} from "./lib/editorPreferences";
import type { EditorPreferences, EditorShortcutId } from "./lib/editorPreferences";
import { midiToFrequency, midiToNoteName, numeralForMidi } from "./lib/music";
import { parseNotationFile, scoreToMidi, scoreToMusicXml } from "./lib/musicxml";
import { validateScore } from "./lib/score";
import type { PitchScore, ScoreNote } from "./types";
import "./score-editor.css";

type NotationView = "staff" | "numbered" | "split";

interface ScoreEditorProps {
  initialScore: PitchScore;
  onCommit: (score: PitchScore, close: boolean) => void;
  onClose: () => void;
  uiScale: number;
  onUiScaleChange: (scale: number) => void;
}

interface StaffCanvasProps {
  score: PitchScore;
  selectedId: string | null;
  cursorBeat: number;
  playbackBeat: number;
  zoom: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}

const AUTOSAVE_KEY = "singright-composer-autosave-v1";
const SVG_WIDTH = 1200;
const SYSTEM_HEIGHT = 172;
const STAFF_LEFT = 155;
const STAFF_RIGHT = 1160;
const CHROMATIC_KEYBOARD = [
  { shortcut: "pitch0", semitone: 0 },
  { shortcut: "pitch1", semitone: 1 },
  { shortcut: "pitch2", semitone: 2 },
  { shortcut: "pitch3", semitone: 3 },
  { shortcut: "pitch4", semitone: 4 },
  { shortcut: "pitch5", semitone: 5 },
  { shortcut: "pitch6", semitone: 6 },
  { shortcut: "pitch7", semitone: 7 },
  { shortcut: "pitch8", semitone: 8 },
  { shortcut: "pitch9", semitone: 9 },
  { shortcut: "pitch10", semitone: 10 },
  { shortcut: "pitch11", semitone: 11 },
] as const;

function localizedKeyName(name: string, locale: "zh-CN" | "en"): string {
  if (locale === "zh-CN") return name;
  return name.replace(" 大调 / ", " major / ").replace(" 小调", " minor");
}

function safeFileBase(title: string): string {
  return title.trim().replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, "-") || "singright-score";
}

function noteAccidental(note: ScoreNote, fifths: number): string {
  if (note.explicitAccidental === "natural") return "♮";
  if (note.explicitAccidental === "sharp") return "♯";
  if (note.explicitAccidental === "flat") return "♭";
  const spelling = note.spelling || (note.midi === null ? "" : midiSpelling(note.midi, fifths));
  const parsed = parseSpelling(spelling);
  const changedSteps = fifths > 0
    ? "FCGDAEB".slice(0, fifths)
    : "BEADGCF".slice(0, Math.abs(fifths));
  const keyAlter = changedSteps.includes(parsed.step) ? Math.sign(fifths) : 0;
  if (parsed.alter === keyAlter) return "";
  if (parsed.alter > 0) return "♯";
  if (parsed.alter < 0) return "♭";
  if (keyAlter !== 0) return "♮";
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
  scrollRef,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: StaffCanvasProps) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const beatsPerMeasure = measureLengthBeats(score);
  const measuresPerSystem = Math.max(2, Math.min(6, Math.round(7 - zoom)));
  const beatsPerSystem = measuresPerSystem * beatsPerMeasure;
  const minSystems = Math.max(1, Math.ceil(Math.max(scoreEndBeat(score), cursorBeat + 1) / beatsPerSystem));
  const systemCount = Math.min(24, minSystems);
  const height = systemCount * SYSTEM_HEIGHT;

  const measureWidth = (STAFF_RIGHT - STAFF_LEFT) / measuresPerSystem;

  function xForBeat(beat: number, durationBeats = 0): number {
    const within = ((beat % beatsPerSystem) + beatsPerSystem) % beatsPerSystem;
    const measureIndex = Math.floor((within + 0.0001) / beatsPerMeasure);
    const beatInMeasure = within - measureIndex * beatsPerMeasure;
    const centeredBeat = beatInMeasure + (durationBeats > 0 ? durationBeats / 2 : EDIT_GRID_BEATS / 2);
    return STAFF_LEFT + measureIndex * measureWidth
      + (Math.min(beatsPerMeasure - EDIT_GRID_BEATS / 2, centeredBeat) / beatsPerMeasure) * measureWidth;
  }

  return (
    <div
      className={`notation-scroll draggable-notation ${dragging ? "dragging" : ""}`}
      ref={scrollRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label={tr("键盘控制的五线谱", "Keyboard-controlled staff notation")}
    >
      <svg
        className="notation-svg keyboard-only"
        viewBox={`0 0 ${SVG_WIDTH} ${height}`}
        role="img"
        aria-label={tr("谱面只用于显示；按 Enter 开始键盘录入", "Display-only score; press Enter to start keyboard entry")}
      >
        {Array.from({ length: systemCount }, (_, systemIndex) => {
          const top = systemIndex * SYSTEM_HEIGHT;
          const systemStart = systemIndex * beatsPerSystem;
          const clef = activeClefAt(score, systemStart);
          const fifths = activeKeySignatureAt(score, systemStart);
          const systemNotes = score.notes.filter((note) => note.beat >= systemStart && note.beat < systemStart + beatsPerSystem);
          const keyChanges = (score.notation?.keyChanges ?? []).filter((change) => change.beat > systemStart + 0.0001 && change.beat < systemStart + beatsPerSystem);
          const clefChanges = (score.notation?.clefChanges ?? []).filter((change) => change.beat > systemStart + 0.0001 && change.beat < systemStart + beatsPerSystem);
          const repeats = (score.notation?.repeats ?? []).filter((marker) => marker.beat >= systemStart && marker.beat <= systemStart + beatsPerSystem);
          return (
            <g key={systemIndex} transform={`translate(0 ${top})`}>
              <rect
                className="staff-hit-area"
                x={STAFF_LEFT}
                y="23"
                width={STAFF_RIGHT - STAFF_LEFT}
                height="91"
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
              {Array.from({ length: Math.round(beatsPerSystem / EDIT_GRID_BEATS) }, (_, slot) => {
                const beat = slot * EDIT_GRID_BEATS;
                if (slot === 0) return null;
                if (Math.abs(beat % beatsPerMeasure) < 0.0001) return null;
                const x = STAFF_LEFT + (beat / beatsPerSystem) * (STAFF_RIGHT - STAFF_LEFT);
                const quarterBeat = Math.abs(beat % 1) < 0.0001;
                return <line className={quarterBeat ? "beat-guide" : "slot-guide"} key={slot} x1={x} x2={x} y1={quarterBeat ? 45 : 49} y2={quarterBeat ? 99 : 95} />;
              })}
              {keyChanges.map((change) => (
                <g className="inline-key-change" key={`key-${change.beat}`} transform={`translate(${xForBeat(change.beat)} 0)`}>
                  <text x="0" y="35">{change.fifths === 0 ? "♮" : change.fifths > 0 ? `${"♯".repeat(change.fifths)}` : `${"♭".repeat(Math.abs(change.fifths))}`}</text>
                </g>
              ))}
              {clefChanges.map((change) => (
                <text className="inline-clef-change" key={`clef-${change.beat}`} x={xForBeat(change.beat)} y={change.clef === "treble" ? 92 : 86}>{change.clef === "treble" ? "𝄞" : "𝄢"}</text>
              ))}
              {repeats.map((marker) => {
                const boundaryX = STAFF_LEFT + ((marker.beat - systemStart) / beatsPerSystem) * (STAFF_RIGHT - STAFF_LEFT);
                return (
                  <g className={`repeat-marker ${marker.type}`} key={`${marker.type}-${marker.beat}`}>
                    <line x1={boundaryX + (marker.type === "start" ? 4 : -4)} x2={boundaryX + (marker.type === "start" ? 4 : -4)} y1="51" y2="91" />
                    <circle cx={boundaryX + (marker.type === "start" ? 10 : -10)} cy="66" r="2.2" />
                    <circle cx={boundaryX + (marker.type === "start" ? 10 : -10)} cy="76" r="2.2" />
                  </g>
                );
              })}
              {systemNotes.map((note) => {
                const x = xForBeat(note.beat, note.durationBeats);
                const noteClef = activeClefAt(score, note.beat);
                const noteFifths = activeKeySignatureAt(score, note.beat);
                const noteY = note.midi === null ? 72 : staffYForMidi(note.midi, noteClef, noteFifths);
                const selected = note.id === selectedId;
                const type = noteTypeForBeats(note.durationBeats);
                const openHead = type === "whole" || type === "half";
                const stemUp = noteY >= 71;
                const stemX = stemUp ? x + 8 : x - 8;
                const accidentalGlyph = noteAccidental(note, noteFifths);
                const noteIndex = score.notes.findIndex((item) => item.id === note.id);
                const previous = score.notes[noteIndex - 1];
                const next = score.notes[noteIndex + 1];
                return (
                  <g
                    className={`notation-note ${selected ? "selected" : ""} ${note.midi === null ? "is-rest" : ""}`}
                    key={note.id}
                    aria-label={tr(
                      `${note.midi === null ? "休止符" : midiToNoteName(note.midi)}，${durationName(note.durationBeats)}，第 ${note.beat + 1} 拍`,
                      `${note.midi === null ? "Rest" : midiToNoteName(note.midi)}, ${note.durationBeats} beats, starts at beat ${note.beat + 1}`,
                    )}
                  >
                    {selected && <circle className="selection-halo" cx={x} cy={noteY} r="18" />}
                    {note.midi === null ? (
                      <text className="rest-glyph" x={x} y={noteY + 7}>{restGlyphForBeats(note.durationBeats)}</text>
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
                    {note.tieToNext && next?.midi === note.midi && (
                      <path
                        className="tie-line"
                        d={next.beat < systemStart + beatsPerSystem
                          ? `M ${x + 8} ${noteY + 10} Q ${(x + xForBeat(next.beat, next.durationBeats)) / 2} ${noteY + 28} ${xForBeat(next.beat, next.durationBeats) - 8} ${noteY + 10}`
                          : `M ${x + 8} ${noteY + 10} Q ${(x + STAFF_RIGHT - 8) / 2} ${noteY + 27} ${STAFF_RIGHT - 8} ${noteY + 10}`}
                      />
                    )}
                    {previous?.tieToNext && previous.midi === note.midi && previous.beat < systemStart && (
                      <path className="tie-line" d={`M ${STAFF_LEFT + 8} ${noteY + 10} Q ${(STAFF_LEFT + 8 + x - 8) / 2} ${noteY + 27} ${x - 8} ${noteY + 10}`} />
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
  scrollRef,
  dragging,
  onPointerDown,
  onPointerMove,
  onPointerUp,
}: {
  score: PitchScore;
  selectedId: string | null;
  cursorBeat: number;
  playbackBeat: number;
  scrollRef: RefObject<HTMLDivElement | null>;
  dragging: boolean;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const { locale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const beatsPerMeasure = measureLengthBeats(score);
  const measureCount = Math.max(1, Math.ceil(Math.max(scoreEndBeat(score), beatsPerMeasure) / beatsPerMeasure));

  return (
    <div
      className={`numbered-scroll draggable-notation ${dragging ? "dragging" : ""}`}
      ref={scrollRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      aria-label={tr("键盘控制的简谱", "Keyboard-controlled numbered notation")}
    >
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
            <div className={`numbered-measure ${cursorHere ? "cursor-here" : ""}`} data-measure={measureIndex} key={measureIndex}>
              <span className="numbered-measure-label">{measureIndex + 1}</span>
              {Array.from({ length: Math.round(beatsPerMeasure / EDIT_GRID_BEATS) }, (_, slot) => (
                <i
                  className={slot % 4 === 0 ? "numbered-beat-guide strong" : "numbered-beat-guide"}
                  key={slot}
                  style={{ left: `${(slot * EDIT_GRID_BEATS / beatsPerMeasure) * 100}%` }}
                />
              ))}
              {notes.map((note) => {
                const left = ((note.beat - start + note.durationBeats / 2) / beatsPerMeasure) * 100;
                const width = Math.max((EDIT_GRID_BEATS / beatsPerMeasure) * 100, (note.durationBeats / beatsPerMeasure) * 100);
                const numeral = note.midi === null ? "0" : note.numeral || numeralForMidi(note.midi, score.tuning.tonicMidi);
                const underlineCount = note.durationBeats <= 0.25 ? 2 : note.durationBeats <= 0.5 ? 1 : 0;
                return (
                  <span
                    className={`numbered-note ${selectedId === note.id ? "selected" : ""}`}
                    key={note.id}
                    style={{ left: `${left}%`, width: `${Math.min(100, width)}%` }}
                    aria-label={note.midi === null ? tr("休止符", "Rest") : midiToNoteName(note.midi)}
                  >
                    <strong>{numeral}</strong>
                    {underlineCount > 0 && <span className={`duration-underlines lines-${underlineCount}`} />}
                    {note.durationBeats > 1 && <span className="duration-dashes">{"—".repeat(Math.max(1, Math.round(note.durationBeats - 1)))}</span>}
                    <small>{note.lyric || (note.midi === null ? "" : midiToNoteName(note.midi))}</small>
                  </span>
                );
              })}
              {cursorHere && <b className="numbered-cursor" style={{ left: `${((cursorBeat - start + EDIT_GRID_BEATS / 2) / beatsPerMeasure) * 100}%` }} />}
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

export default function ScoreEditor({ initialScore, onCommit, onClose, uiScale, onUiScaleChange }: ScoreEditorProps) {
  const { locale, setLocale } = useI18n();
  const tr = (zh: string, en: string) => localize(locale, zh, en);
  const [draft, setDraft] = useState(() => cloneScore(initialScore));
  const [past, setPast] = useState<PitchScore[]>([]);
  const [future, setFuture] = useState<PitchScore[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(initialScore.notes[0]?.id ?? null);
  const [entryMode, setEntryMode] = useState(false);
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
  const [showEditorSettings, setShowEditorSettings] = useState(false);
  const [preferences, setPreferences] = useState<EditorPreferences>(() => {
    const stored = loadEditorPreferences();
    return { ...stored, uiScale };
  });
  const [rebinding, setRebinding] = useState<EditorShortcutId | null>(null);

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
  const staffScrollRef = useRef<HTMLDivElement>(null);
  const numberedScrollRef = useRef<HTMLDivElement>(null);
  const scoreDragRef = useRef<{ element: HTMLDivElement; x: number; y: number; left: number; top: number } | null>(null);
  const scoreReturnTimerRef = useRef<number | null>(null);
  const scoreManualUntilRef = useRef(0);
  const [draggingSurface, setDraggingSurface] = useState<"staff" | "numbered" | null>(null);

  const selectedNote = useMemo(
    () => draft.notes.find((note) => note.id === selectedId) ?? null,
    [draft.notes, selectedId],
  );
  const effectiveDuration = dotted ? duration * 1.5 : duration;
  const measureBeats = measureLengthBeats(draft);
  const measureCount = Math.max(1, Math.ceil(Math.max(scoreEndBeat(draft), measureBeats) / measureBeats));
  const audioGuide = draft.audioGuide;
  const trimStart = Math.min(audioDuration, audioGuide?.trimStartSeconds ?? 0);
  const trimEnd = Math.min(audioDuration, audioGuide?.trimEndSeconds ?? audioDuration);
  const audioProgress = audioDuration ? audioCurrentTime / audioDuration : 0;

  const syncScoreViews = useCallback((behavior: ScrollBehavior = "smooth") => {
    const beat = isPlaying ? playbackBeat : cursorBeat;
    const measuresPerSystem = Math.max(2, Math.min(6, Math.round(7 - zoom)));
    const beatsPerSystem = measuresPerSystem * measureLengthBeats(draft);
    const systemIndex = Math.max(0, Math.floor((beat + 0.0001) / beatsPerSystem));
    const staff = staffScrollRef.current;
    const svg = staff?.querySelector("svg");
    if (staff && svg) {
      const scale = svg.clientWidth / SVG_WIDTH;
      staff.scrollTo({
        top: Math.max(0, systemIndex * SYSTEM_HEIGHT * scale - staff.clientHeight * 0.2),
        behavior,
      });
    }
    const numbered = numberedScrollRef.current;
    const measureIndex = Math.max(0, Math.floor((beat + 0.0001) / measureLengthBeats(draft)));
    const measure = numbered?.querySelector<HTMLElement>(`[data-measure="${measureIndex}"]`);
    if (numbered && measure) {
      numbered.scrollTo({
        left: Math.max(0, measure.offsetLeft - numbered.clientWidth * 0.12),
        top: Math.max(0, measure.offsetTop - numbered.clientHeight * 0.22),
        behavior,
      });
    }
  }, [cursorBeat, draft, isPlaying, playbackBeat, zoom]);

  useEffect(() => {
    if (draggingSurface || Date.now() < scoreManualUntilRef.current) return;
    const timer = window.setTimeout(() => syncScoreViews(isPlaying ? "auto" : "smooth"), 35);
    return () => window.clearTimeout(timer);
  }, [draft, draggingSurface, isPlaying, playbackBeat, cursorBeat, syncScoreViews]);

  useEffect(() => () => {
    if (scoreReturnTimerRef.current !== null) window.clearTimeout(scoreReturnTimerRef.current);
  }, []);

  function beginScoreDrag(surface: "staff" | "numbered", event: ReactPointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    scoreDragRef.current = {
      element: event.currentTarget,
      x: event.clientX,
      y: event.clientY,
      left: event.currentTarget.scrollLeft,
      top: event.currentTarget.scrollTop,
    };
    if (scoreReturnTimerRef.current !== null) window.clearTimeout(scoreReturnTimerRef.current);
    setDraggingSurface(surface);
  }

  function moveScoreDrag(event: ReactPointerEvent<HTMLDivElement>) {
    const drag = scoreDragRef.current;
    if (!drag) return;
    drag.element.scrollLeft = drag.left - (event.clientX - drag.x);
    drag.element.scrollTop = drag.top - (event.clientY - drag.y);
  }

  function endScoreDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!scoreDragRef.current) return;
    scoreDragRef.current = null;
    scoreManualUntilRef.current = Date.now() + 1200;
    setDraggingSurface(null);
    event.currentTarget.releasePointerCapture(event.pointerId);
    scoreReturnTimerRef.current = window.setTimeout(() => {
      scoreManualUntilRef.current = 0;
      syncScoreViews("smooth");
    }, 1200);
  }

  useEffect(() => {
    setPreferences((current) => ({ ...current, uiScale }));
  }, [uiScale]);

  useEffect(() => {
    saveEditorPreferences(preferences);
  }, [preferences]);

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
    const scoreMeasureBeats = measureLengthBeats(draft);
    const countInBeats = countIn ? scoreMeasureBeats : 0;
    const delay = countInBeats * secondsPerBeat;
    const rangeStart = loop ? (loopStartMeasure - 1) * scoreMeasureBeats : fromBeat;
    const loopEnd = Math.max(rangeStart + 0.25, loopEndMeasure * scoreMeasureBeats);
    const audioScoreDuration = audioGuide && audioDuration
      ? audioGuide.offsetSeconds + Math.max(0, trimEnd - trimStart) / audioGuide.playbackRate
      : 0;
    const endBeat = loop
      ? loopEnd
      : Math.max(scoreEndBeat(draft), (audioScoreDuration * draft.tempo.bpm) / 60, scoreMeasureBeats);
    const now = context.currentTime + 0.05;
    const master = context.createGain();
    master.gain.value = 0.2;
    master.connect(context.destination);

    mergeTiedNotes(draft).notes.forEach((note) => {
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
        oscillator.frequency.value = Math.abs(absoluteBeat % scoreMeasureBeats) < 0.0001 ? 1320 : 920;
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

  const addNote = useCallback((
    midi: number | null,
    beat = cursorBeat,
    explicitAccidental?: ScoreNote["explicitAccidental"],
  ) => {
    let start = quantizeBeat(beat, EDIT_GRID_BEATS);
    let existing = draft.notes.find((note) => Math.abs(note.beat - start) < 0.0001);
    let note: ScoreNote = {
      ...(existing ?? {}),
      id: existing?.id ?? makeNoteId(),
      midi,
      beat: start,
      durationBeats: effectiveDuration,
      spelling: midi === null ? undefined : midiSpelling(midi, activeKeySignatureAt(draft, start), accidental),
      explicitAccidental: midi === null ? undefined : explicitAccidental,
      numeral: midi === null ? undefined : numeralForMidi(midi, draft.tuning.tonicMidi),
      lyric: existing?.lyric ?? "",
    };
    let issue = notePlacementIssue(draft, note, existing?.id);
    // When a chosen value no longer fits at the tail of a bar, continue at the
    // first sixteenth-note cell of the next bar. This keeps sequential entry
    // moving without requiring a separate navigation command.
    if (issue === "crosses-measure") {
      start = nextMeasureBeat(draft, start);
      existing = draft.notes.find((candidate) => Math.abs(candidate.beat - start) < 0.0001);
      note = {
        ...(existing ?? {}),
        ...note,
        id: existing?.id ?? note.id,
        beat: start,
        spelling: midi === null ? undefined : midiSpelling(midi, activeKeySignatureAt(draft, start), accidental),
      };
      issue = notePlacementIssue(draft, note, existing?.id);
    }
    if (issue) {
      setToast(issue === "crosses-measure"
        ? tr("这个时值无法放入下一小节，请缩短时值", "This duration does not fit in the next bar. Choose a shorter value.")
        : issue === "overlap"
          ? tr("这些固定槽位已经被其他音符占用", "Those fixed slots are already occupied by another note.")
          : tr("音符必须落在十六分音符网格上", "Notes must align to the sixteenth-note grid."));
      return;
    }
    commit((current) => placeNote(current, note));
    setSelectedId(note.id);
    setCursorBeat(quantizeBeat(note.beat + note.durationBeats, EDIT_GRID_BEATS));
  }, [accidental, commit, cursorBeat, draft, effectiveDuration, tr]);

  function duplicateSelected() {
    if (!selectedNote) return;
    addNote(selectedNote.midi, selectedNote.beat + selectedNote.durationBeats);
  }

  function removeSelected() {
    if (!selectedId) return;
    commit((current) => deleteNote(current, selectedId));
    const previousIndex = draft.notes.findIndex((note) => note.id === selectedId);
    setSelectedId(draft.notes[previousIndex - 1]?.id ?? draft.notes[previousIndex + 1]?.id ?? null);
  }

  const moveEditCursor = useCallback((beat: number) => {
    const nextBeat = quantizeBeat(Math.max(0, beat), EDIT_GRID_BEATS);
    setCursorBeat(nextBeat);
    setSelectedId(draft.notes.find((note) => Math.abs(note.beat - nextBeat) < 0.0001)?.id ?? null);
  }, [draft.notes]);

  const removePrevious = useCallback(() => {
    const previous = [...draft.notes]
      .filter((note) => note.beat < cursorBeat - 0.0001)
      .sort((a, b) => b.beat - a.beat)[0];
    if (!previous) {
      setToast(tr("光标前没有可以删除的音符", "There is no note before the cursor."));
      return;
    }
    commit((current) => deleteNote(current, previous.id));
    setCursorBeat(previous.beat);
    setSelectedId(draft.notes
      .filter((note) => note.id !== previous.id && note.beat < previous.beat)
      .sort((a, b) => b.beat - a.beat)[0]?.id ?? null);
  }, [commit, cursorBeat, draft.notes, tr]);

  const removeAtCursor = useCallback(() => {
    const current = draft.notes.find((note) => Math.abs(note.beat - cursorBeat) < 0.0001);
    if (!current) {
      setToast(tr("当前固定槽位没有音符", "There is no note in the current slot."));
      return;
    }
    commit((score) => deleteNote(score, current.id));
    setSelectedId(null);
  }, [commit, cursorBeat, draft.notes, tr]);

  const toggleSelectedTie = useCallback(() => {
    const target = selectedNote ?? [...draft.notes]
      .filter((note) => note.beat < cursorBeat + 0.0001)
      .sort((a, b) => b.beat - a.beat)[0];
    if (!target || target.midi === null) {
      setToast(tr("请先把光标移到一个有音高的音符", "Move the cursor to a pitched note first."));
      return;
    }
    if (target.tieToNext) {
      commit((current) => updateNote(current, target.id, { tieToNext: false }));
      setToast(tr("已移除延音线", "Tie removed."));
      return;
    }
    if (!canTieToNext(draft, target.id)) {
      setToast(tr("延音线只能连接紧邻且音高相同的两个音符", "A tie can only join adjacent notes of the same pitch."));
      return;
    }
    commit((current) => updateNote(current, target.id, { tieToNext: true }));
    setToast(tr("已连接相同音高，练唱与试听时按合并时值处理", "Equal pitches are tied and use their combined duration in practice and playback."));
  }, [commit, cursorBeat, draft, selectedNote, tr]);

  const insertKeyChange = useCallback((fifths: number) => {
    const nextFifths = Math.max(-7, Math.min(7, Math.round(fifths)));
    commit((current) => upsertKeySignatureChange(current, cursorBeat, nextFifths));
    setToast(nextFifths === 0
      ? tr("已在光标处加入还原调号", "A natural key change was inserted at the cursor.")
      : tr(`已在光标处切换为 ${nextFifths > 0 ? `${nextFifths} 个升号` : `${Math.abs(nextFifths)} 个降号`}`, `Key changed at the cursor to ${Math.abs(nextFifths)} ${nextFifths > 0 ? "sharp(s)" : "flat(s)"}.`));
  }, [commit, cursorBeat, tr]);

  const toggleClefAtCursor = useCallback(() => {
    const nextClef: Clef = activeClefAt(draft, cursorBeat) === "treble" ? "bass" : "treble";
    commit((current) => upsertClefChange(current, cursorBeat, nextClef));
    setInputOctave(nextClef === "bass" ? 3 : 4);
    setToast(nextClef === "treble" ? tr("已切换为高音谱号", "Changed to treble clef.") : tr("已切换为低音谱号", "Changed to bass clef."));
  }, [commit, cursorBeat, draft, tr]);

  const toggleRepeatAtCursor = useCallback((type: "start" | "end") => {
    commit((current) => toggleRepeatMarker(current, cursorBeat, type));
    setToast(type === "start" ? tr("已切换反复开始线", "Repeat start toggled.") : tr("已切换反复结束线", "Repeat end toggled."));
  }, [commit, cursorBeat, tr]);

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
      if (matchesShortcut(event, preferences.shortcuts.exitEntry)) {
        event.preventDefault();
        setEntryMode(false);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.toggleEntry)) {
        event.preventDefault();
        setEntryMode((value) => !value);
        return;
      }
      if (!entryMode) {
        if (event.code === "Space") {
          event.preventDefault();
          if (isPlaying) stopPlayback(false);
          else void startPlayback();
        }
        return;
      }

      const durationShortcutIds: EditorShortcutId[] = [
        "durationWhole",
        "durationHalf",
        "durationQuarter",
        "durationEighth",
        "durationSixteenth",
      ];
      const durationIndex = durationShortcutIds.findIndex((id) => matchesShortcut(event, preferences.shortcuts[id]));
      if (durationIndex >= 0) {
        event.preventDefault();
        setDuration(DURATION_OPTIONS[durationIndex].beats);
        if (DURATION_OPTIONS[durationIndex].beats === EDIT_GRID_BEATS) setDotted(false);
        return;
      }

      const chromaticKey = CHROMATIC_KEYBOARD.find((item) => (
        matchesShortcut(event, preferences.shortcuts[item.shortcut], true)
      ));
      if (chromaticKey) {
        event.preventDefault();
        const modifier = event.shiftKey && !event.ctrlKey ? 1 : event.ctrlKey && !event.shiftKey ? -1 : 0;
        const midi = Math.max(0, Math.min(127, (inputOctave + 1) * 12 + chromaticKey.semitone + modifier));
        addNote(midi, cursorBeat, modifier > 0 ? "sharp" : modifier < 0 ? "flat" : undefined);
        return;
      }
      if (event.code === "Space" && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        addNote(null);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.tie)) {
        event.preventDefault();
        toggleSelectedTie();
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.natural)) {
        event.preventDefault();
        setAccidental(0);
        if (selectedNote?.midi !== null && selectedNote) {
          patchSelected({
            spelling: midiSpelling(selectedNote.midi, activeKeySignatureAt(draft, selectedNote.beat), 0),
            explicitAccidental: "natural",
          });
        }
        setToast(tr("已使用还原记号", "Natural accidental selected."));
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.keyFlatter)) {
        event.preventDefault();
        insertKeyChange(activeKeySignatureAt(draft, cursorBeat) - 1);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.keyNatural)) {
        event.preventDefault();
        insertKeyChange(0);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.keySharper)) {
        event.preventDefault();
        insertKeyChange(activeKeySignatureAt(draft, cursorBeat) + 1);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.toggleClef)) {
        event.preventDefault();
        toggleClefAtCursor();
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.repeatStart)) {
        event.preventDefault();
        toggleRepeatAtCursor("start");
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.repeatEnd)) {
        event.preventDefault();
        toggleRepeatAtCursor("end");
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.toggleLoop)) {
        event.preventDefault();
        const measure = Math.floor(cursorBeat / measureBeats) + 1;
        setLoopStartMeasure(measure);
        setLoopEndMeasure(measure);
        setLoop((value) => !value);
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.deletePrevious)) {
        event.preventDefault();
        removePrevious();
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.deleteCurrent)) {
        event.preventDefault();
        removeAtCursor();
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.octaveUp)
        || matchesShortcut(event, preferences.shortcuts.octaveDown)) {
        event.preventDefault();
        const upward = matchesShortcut(event, preferences.shortcuts.octaveUp);
        setInputOctave((value) => Math.max(1, Math.min(7, value + (upward ? 1 : -1))));
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.previousMeasure)
        || matchesShortcut(event, preferences.shortcuts.nextMeasure)) {
        event.preventDefault();
        const forward = matchesShortcut(event, preferences.shortcuts.nextMeasure);
        moveEditCursor(cursorBeat + measureBeats * (forward ? 1 : -1));
        return;
      }
      if (matchesShortcut(event, preferences.shortcuts.cursorLeft)
        || matchesShortcut(event, preferences.shortcuts.cursorRight)) {
        event.preventDefault();
        const forward = matchesShortcut(event, preferences.shortcuts.cursorRight);
        moveEditCursor(cursorBeat + EDIT_GRID_BEATS * (forward ? 1 : -1));
        return;
      }
      if (event.key === "Home" || event.key === "End") {
        event.preventDefault();
        const measureStart = Math.floor(cursorBeat / measureBeats) * measureBeats;
        moveEditCursor(event.key === "Home" ? measureStart : measureStart + measureBeats);
      }
      if (command) return;
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    addNote,
    cursorBeat,
    draft,
    entryMode,
    inputOctave,
    insertKeyChange,
    isPlaying,
    measureBeats,
    moveEditCursor,
    preferences.shortcuts,
    redo,
    removeAtCursor,
    removePrevious,
    selectedNote,
    startPlayback,
    stopPlayback,
    toggleClefAtCursor,
    toggleRepeatAtCursor,
    toggleSelectedTie,
    tr,
    undo,
  ]);

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

  async function exportScore(kind: "json" | "musicxml" | "midi") {
    const base = safeFileBase(draft.metadata.title);
    try {
      const file = kind === "json"
        ? {
          blob: new Blob([JSON.stringify(draft, null, 2)], { type: "application/json" }),
          name: `${base}.singright.json`,
          filter: "SingRight JSON",
          extensions: ["json"],
        }
        : kind === "musicxml"
          ? {
            blob: new Blob([scoreToMusicXml(draft)], { type: "application/vnd.recordare.musicxml+xml" }),
            name: `${base}.musicxml`,
            filter: "MusicXML",
            extensions: ["musicxml", "xml"],
          }
          : {
            blob: new Blob([scoreToMidi(draft).buffer as ArrayBuffer], { type: "audio/midi" }),
            name: `${base}.mid`,
            filter: "MIDI",
            extensions: ["mid", "midi"],
          };
      const result = await saveBlob(file.blob, file.name, {
        title: tr("导出曲谱", "Export score"),
        filterName: file.filter,
        extensions: file.extensions,
      });
      setToast(result.saved ? tr(`已保存 ${file.name}`, `Saved ${file.name}`) : tr("已取消导出", "Export canceled."));
    } catch {
      setToast(tr("无法保存曲谱，请检查目标文件夹权限", "Could not save the score. Check the destination folder permissions."));
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
    const candidate = { ...selectedNote, ...patch, id: selectedNote.id };
    const issue = notePlacementIssue(draft, candidate, selectedNote.id);
    if (issue) {
      setToast(issue === "crosses-measure"
        ? tr("修改后会越过小节线，已保留原值", "That change would cross the barline, so the original value was kept.")
        : issue === "overlap"
          ? tr("修改后会占用已有音符的槽位，已保留原值", "That change would occupy another note's slots, so the original value was kept.")
          : tr("起始拍必须落在固定网格上", "The start beat must align to the fixed grid."));
      return;
    }
    commit((current) => updateNote(current, selectedNote.id, patch));
  }

  function chooseAccidental(value: Accidental) {
    setAccidental(value);
    if (selectedNote?.midi === null || !selectedNote) return;
    patchSelected({
      spelling: midiSpelling(selectedNote.midi, activeKeySignatureAt(draft, selectedNote.beat), value),
      explicitAccidental: value < 0 ? "flat" : value > 0 ? "sharp" : "natural",
    });
  }

  function changeTimeSignature(patch: Partial<PitchScore["timeSignature"]>) {
    const next = { ...draft, timeSignature: { ...draft.timeSignature, ...patch } };
    const crossesBarline = next.notes.some((note) => notePlacementIssue(next, note, note.id) === "crosses-measure");
    if (crossesBarline) {
      setToast(tr("这个拍号会让已有音符越过小节线，请先调整这些音符", "That time signature would make existing notes cross a barline. Adjust those notes first."));
      return;
    }
    commit(next);
  }

  function changeShortcut(id: EditorShortcutId, event: ReactKeyboardEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    if (event.code === "Escape") {
      setRebinding(null);
      return;
    }
    const pitchShortcut = id.startsWith("pitch");
    if (pitchShortcut && (event.metaKey || event.altKey)) {
      setToast(tr("十二音按键不能使用 Meta 或 Alt，以便保留 Shift/Ctrl 临时升降", "Pitch keys cannot use Meta or Alt because Shift/Ctrl are reserved for accidentals."));
      return;
    }
    const shortcut = pitchShortcut ? event.code : shortcutFromEvent(event.nativeEvent);
    const conflict = (Object.entries(preferences.shortcuts) as Array<[EditorShortcutId, string]>)
      .find(([candidateId, value]) => candidateId !== id && value === shortcut);
    if (conflict) {
      setToast(tr(`按键 ${shortcutLabel(shortcut)} 已被其他功能使用`, `${shortcutLabel(shortcut)} is already assigned.`));
      return;
    }
    setPreferences((current) => ({ ...current, shortcuts: { ...current.shortcuts, [id]: shortcut } }));
    setRebinding(null);
  }

  function shortcutName(id: EditorShortcutId): string {
    const names: Record<EditorShortcutId, [string, string]> = {
      toggleEntry: ["开始/结束录入", "Start/end entry"],
      exitEntry: ["退出录入", "Exit entry"],
      durationWhole: ["全音符", "Whole note"],
      durationHalf: ["二分音符", "Half note"],
      durationQuarter: ["四分音符", "Quarter note"],
      durationEighth: ["八分音符", "Eighth note"],
      durationSixteenth: ["十六分音符", "Sixteenth note"],
      pitch0: ["十二音 1", "Chromatic pitch 1"],
      pitch1: ["十二音 2", "Chromatic pitch 2"],
      pitch2: ["十二音 3", "Chromatic pitch 3"],
      pitch3: ["十二音 4", "Chromatic pitch 4"],
      pitch4: ["十二音 5", "Chromatic pitch 5"],
      pitch5: ["十二音 6", "Chromatic pitch 6"],
      pitch6: ["十二音 7", "Chromatic pitch 7"],
      pitch7: ["十二音 8", "Chromatic pitch 8"],
      pitch8: ["十二音 9", "Chromatic pitch 9"],
      pitch9: ["十二音 10", "Chromatic pitch 10"],
      pitch10: ["十二音 11", "Chromatic pitch 11"],
      pitch11: ["十二音 12", "Chromatic pitch 12"],
      rest: ["当前时值休止符", "Rest at current duration"],
      tie: ["延音线", "Tie"],
      natural: ["临时还原记号", "Natural accidental"],
      keyFlatter: ["调号增加一个降号", "Add one flat to key"],
      keyNatural: ["调号还原", "Natural key"],
      keySharper: ["调号增加一个升号", "Add one sharp to key"],
      toggleClef: ["切换高/低音谱号", "Toggle treble/bass clef"],
      repeatStart: ["反复开始线", "Repeat start"],
      repeatEnd: ["反复结束线", "Repeat end"],
      toggleLoop: ["循环当前小节", "Loop current bar"],
      octaveUp: ["升高八度组", "Octave up"],
      octaveDown: ["降低八度组", "Octave down"],
      cursorLeft: ["左移一格", "Previous cell"],
      cursorRight: ["右移一格", "Next cell"],
      previousMeasure: ["上一小节", "Previous bar"],
      nextMeasure: ["下一小节", "Next bar"],
      deletePrevious: ["删除前一个音符", "Delete previous note"],
      deleteCurrent: ["删除当前位置", "Delete current cell"],
    };
    return tr(...names[id]);
  }

  const shortcutGroups: Array<{ title: string; ids: EditorShortcutId[] }> = [
    {
      title: tr("录入与定位", "Entry & navigation"),
      ids: ["toggleEntry", "exitEntry", "octaveUp", "octaveDown", "cursorLeft", "cursorRight", "previousMeasure", "nextMeasure", "deletePrevious", "deleteCurrent"],
    },
    {
      title: tr("时值与音高", "Duration & pitch"),
      ids: ["durationWhole", "durationHalf", "durationQuarter", "durationEighth", "durationSixteenth", ...CHROMATIC_KEYBOARD.map((item) => item.shortcut)],
    },
    {
      title: tr("谱面记号", "Notation marks"),
      ids: ["tie", "natural", "keyFlatter", "keyNatural", "keySharper", "toggleClef", "repeatStart", "repeatEnd", "toggleLoop"],
    },
  ];

  return (
    <div
      className="composer-shell"
      style={{ zoom: uiScale / 100 }}
      onFocusCapture={(event) => {
        const target = event.target as HTMLElement;
        if (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable) setEntryMode(false);
      }}
    >
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
          <button className={`text-button entry-mode-toggle ${entryMode ? "active" : ""}`} onClick={() => setEntryMode((value) => !value)}>
            <Keyboard /> {entryMode ? tr(`结束录入（${shortcutLabel(preferences.shortcuts.toggleEntry)}）`, `End entry (${shortcutLabel(preferences.shortcuts.toggleEntry)})`) : tr(`开始录入（${shortcutLabel(preferences.shortcuts.toggleEntry)}）`, `Start entry (${shortcutLabel(preferences.shortcuts.toggleEntry)})`)}
          </button>
          <div className="composer-language">
            <Languages />
            <select value={locale} onChange={(event) => setLocale(event.target.value as "zh-CN" | "en")} aria-label={tr("界面语言", "Interface language")}>
              <option value="zh-CN">中文</option>
              <option value="en">EN</option>
            </select>
          </div>
          <button className="text-button" onClick={recoverAutosave}><RotateCcw /> {tr("恢复草稿", "Restore draft")}</button>
          <button className="icon-button" onClick={() => { setEntryMode(false); setShowEditorSettings(true); }} title={tr("显示与快捷键设置", "Display and shortcut settings")}><Settings2 /></button>
          <button className="text-button" onClick={() => notationInputRef.current?.click()}><FileInput /> {tr("导入", "Import")}</button>
          <input ref={notationInputRef} type="file" accept=".json,.singright.json,.musicxml,.xml,application/json,application/xml,text/xml" hidden onChange={(event) => void importNotation(event.target.files?.[0])} />
          <div className="export-menu">
            <button className="text-button"><Download /> {tr("导出", "Export")}</button>
            <div><button onClick={() => void exportScore("json")}>SingRight JSON<small>{tr("继续编辑与练唱", "Keep editing and practicing")}</small></button><button onClick={() => void exportScore("musicxml")}>MusicXML<small>MuseScore / Sibelius</small></button><button onClick={() => void exportScore("midi")}>{tr("标准 MIDI", "Standard MIDI")}<small>{tr("用于编曲软件", "For music production tools")}</small></button></div>
          </div>
          <button className="save-button" onClick={() => save(false)}><Save /> {tr("保存", "Save")}</button>
          <button className="practice-button" onClick={() => save(true)}><Headphones /> {tr("保存并练习", "Save & practice")}</button>
        </div>
      </header>

      <div className="composer-body">
        <aside className="composer-toolbox">
          <div className="tool-section">
            <div className="tool-section-title"><span>{tr("键盘录入", "Keyboard entry")}</span><small>{shortcutLabel(preferences.shortcuts.toggleEntry)} / {shortcutLabel(preferences.shortcuts.exitEntry)}</small></div>
            <button className={`keyboard-entry-card ${entryMode ? "active" : ""}`} onClick={() => setEntryMode((value) => !value)}>
              <Keyboard />
              <span>
                <strong>{entryMode ? tr("录入已开启", "Entry is active") : tr("录入已关闭", "Entry is inactive")}</strong>
                <small>{entryMode ? tr("现在按键会写入曲谱", "Notation keys now write to the score") : tr(`按 ${shortcutLabel(preferences.shortcuts.toggleEntry)} 开始，${shortcutLabel(preferences.shortcuts.exitEntry)} 结束`, `Press ${shortcutLabel(preferences.shortcuts.toggleEntry)} to start, ${shortcutLabel(preferences.shortcuts.exitEntry)} to stop`)}</small>
              </span>
            </button>
          </div>

          <div className="tool-section">
            <div className="tool-section-title"><span>{tr("音符时值", "Duration")}</span><small>{tr("快捷键 1–5", "Keys 1–5")}</small></div>
            <div className="duration-grid">
              {DURATION_OPTIONS.map((option) => (
                <button
                  key={option.beats}
                  className={duration === option.beats ? "active" : ""}
                  onClick={() => {
                    setDuration(option.beats);
                    if (option.beats === EDIT_GRID_BEATS) setDotted(false);
                  }}
                  title={tr(`${option.label}（${option.shortcut}）`, `${option.beats} beats`)}
                ><strong>{option.glyph}</strong><span>{locale === "zh-CN" ? option.label.replace("音符", "") : `${option.beats}`}</span><kbd>{shortcutLabel(preferences.shortcuts[([
                  "durationWhole",
                  "durationHalf",
                  "durationQuarter",
                  "durationEighth",
                  "durationSixteenth",
                ] as EditorShortcutId[])[DURATION_OPTIONS.indexOf(option)]])}</kbd></button>
              ))}
            </div>
            <button disabled={duration === EDIT_GRID_BEATS} className={`dot-toggle ${dotted ? "active" : ""}`} onClick={() => setDotted((value) => !value)}>
              <i /> {tr("附点", "Dotted")} <span>{dotted ? tr(`${effectiveDuration} 拍`, `${effectiveDuration} beats`) : tr("延长一半", "Add half")}</span>
            </button>
          </div>

          <div className="tool-section">
            <div className="tool-section-title"><span>{tr("黑键记谱方式", "Black-key spelling")}</span><small>{tr("不改变实际音高", "Pitch stays unchanged")}</small></div>
            <div className="accidental-grid">
              {([
                { value: -1, glyph: "♭", label: tr("降号拼写", "Use flats") },
                { value: 0, glyph: "♮", label: tr("跟随调号", "Follow key") },
                { value: 1, glyph: "♯", label: tr("升号拼写", "Use sharps") },
              ] as const).map((item) => (
                <button className={accidental === item.value ? "active" : ""} key={item.value} onClick={() => chooseAccidental(item.value)}>
                  <strong>{item.glyph}</strong><span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="tool-section piano-section">
            <div className="tool-section-title"><span>{tr("十二音键盘", "Chromatic keyboard")}</span><small>{tr("Shift 升 · Ctrl 降", "Shift sharp · Ctrl flat")}</small></div>
            <div className="octave-stepper">
              <button onClick={() => setInputOctave((value) => Math.max(1, value - 1))}><Minus /></button>
              <span>{tr("当前八度组", "Current octave")} <strong>{inputOctave}</strong><small> ↑ / ↓</small></span>
              <button onClick={() => setInputOctave((value) => Math.min(7, value + 1))}><Plus /></button>
            </div>
            <div className="chromatic-key-map">
              {CHROMATIC_KEYBOARD.map((item) => {
                const midi = (inputOctave + 1) * 12 + item.semitone;
                return <span className={item.semitone % 12 === 1 || item.semitone % 12 === 3 || item.semitone % 12 === 6 || item.semitone % 12 === 8 || item.semitone % 12 === 10 ? "black" : ""} key={item.shortcut}><kbd>{shortcutLabel(preferences.shortcuts[item.shortcut])}</kbd><strong>{midiSpelling(midi, activeKeySignatureAt(draft, cursorBeat), accidental)}</strong></span>;
              })}
            </div>
            <div className="rest-key"><kbd>Space</kbd><strong>{restGlyphForBeats(effectiveDuration)}</strong><span>{tr("输入当前时值的休止符（固定保留）", "Enter a rest at the current duration (always reserved)")}</span></div>
            <div className="notation-key-grid">
              <button onClick={toggleSelectedTie}><kbd>{shortcutLabel(preferences.shortcuts.tie)}</kbd><Link2 /><span>{tr("延音线", "Tie")}</span></button>
              <button onClick={toggleClefAtCursor}><kbd>{shortcutLabel(preferences.shortcuts.toggleClef)}</kbd><strong>{activeClefAt(draft, cursorBeat) === "treble" ? "𝄞" : "𝄢"}</strong><span>{tr("切换谱号", "Clef")}</span></button>
              <button onClick={() => toggleRepeatAtCursor("start")}><kbd>{shortcutLabel(preferences.shortcuts.repeatStart)}</kbd><strong>𝄆</strong><span>{tr("反复开始", "Repeat start")}</span></button>
              <button onClick={() => toggleRepeatAtCursor("end")}><kbd>{shortcutLabel(preferences.shortcuts.repeatEnd)}</kbd><strong>𝄇</strong><span>{tr("反复结束", "Repeat end")}</span></button>
            </div>
            <div className="key-change-row">
              <button onClick={() => insertKeyChange(activeKeySignatureAt(draft, cursorBeat) - 1)}><kbd>{shortcutLabel(preferences.shortcuts.keyFlatter)}</kbd><strong>♭</strong></button>
              <button onClick={() => insertKeyChange(0)}><kbd>{shortcutLabel(preferences.shortcuts.keyNatural)}</kbd><strong>♮</strong></button>
              <button onClick={() => insertKeyChange(activeKeySignatureAt(draft, cursorBeat) + 1)}><kbd>{shortcutLabel(preferences.shortcuts.keySharper)}</kbd><strong>♯</strong></button>
              <span>{tr(`当前位置：${localizedKeyName(KEY_SIGNATURES.find((item) => item.fifths === activeKeySignatureAt(draft, cursorBeat))?.name ?? "", locale)}`, `At cursor: ${localizedKeyName(KEY_SIGNATURES.find((item) => item.fifths === activeKeySignatureAt(draft, cursorBeat))?.name ?? "", locale)}`)}</span>
            </div>
          </div>

          <div className="shortcut-note">
            <Keyboard />
            <div><strong>{tr("光标与删除", "Cursor and deletion")}</strong><span>{tr("←/→ 移动固定槽 · ⇧←/→ 跨小节<br />Home/End 到小节边界 · Backspace 删除前一个音", "←/→ move one fixed slot · ⇧←/→ move one bar<br />Home/End bar edges · Backspace removes the previous note")}</span></div>
          </div>
        </aside>

        <main className="composer-workspace">
          <section className="score-setup-bar">
            <label><span>{tr("速度", "Tempo")}</span><div><input type="number" min="20" max="300" value={draft.tempo.bpm} onChange={(event) => commit((current) => ({ ...current, tempo: { bpm: Math.max(20, Math.min(300, Number(event.target.value))) } }))} /><small>BPM</small></div></label>
            <label><span>{tr("拍号", "Time")}</span><div><select value={draft.timeSignature.beats} onChange={(event) => changeTimeSignature({ beats: Number(event.target.value) })}>{[2, 3, 4, 5, 6, 7, 9, 12].map((value) => <option key={value}>{value}</option>)}</select><b>/</b><select value={draft.timeSignature.beatUnit} onChange={(event) => changeTimeSignature({ beatUnit: Number(event.target.value) as 1 | 2 | 4 | 8 | 16 })}>{[2, 4, 8, 16].map((value) => <option key={value}>{value}</option>)}</select></div></label>
            <label className="key-field"><span>{tr("初始调号", "Initial key")}</span><select value={draft.notation?.keySignature ?? 0} onChange={(event) => commit((current) => ({ ...current, notation: { ...current.notation, clef: current.notation?.clef ?? "treble", keySignature: Number(event.target.value) } }))}>{KEY_SIGNATURES.map((key) => <option key={key.fifths} value={key.fifths}>{localizedKeyName(key.name, locale)}</option>)}</select></label>
            <label><span>{tr("初始谱号", "Initial clef")}</span><select value={draft.notation?.clef ?? "treble"} onChange={(event) => commit((current) => ({ ...current, notation: { ...current.notation, keySignature: current.notation?.keySignature ?? 0, clef: event.target.value as Clef } }))}><option value="treble">𝄞 {tr("高音谱号", "Treble")}</option><option value="bass">𝄢 {tr("低音谱号", "Bass")}</option></select></label>
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
              <button className={`entry-status-button ${entryMode ? "active" : ""}`} onClick={() => setEntryMode((value) => !value)}><Keyboard /> {entryMode ? tr(`录入中 · ${shortcutLabel(preferences.shortcuts.toggleEntry)} 结束`, `Entering · ${shortcutLabel(preferences.shortcuts.toggleEntry)} to stop`) : tr(`${shortcutLabel(preferences.shortcuts.toggleEntry)} 开始键盘录入`, `${shortcutLabel(preferences.shortcuts.toggleEntry)} to start entry`)}</button>
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
                scrollRef={staffScrollRef}
                dragging={draggingSurface === "staff"}
                onPointerDown={(event) => beginScoreDrag("staff", event)}
                onPointerMove={moveScoreDrag}
                onPointerUp={endScoreDrag}
              />}
            {(notationView === "numbered" || notationView === "split") && <NumberedScoreCanvas
              score={draft}
              selectedId={selectedId}
              cursorBeat={cursorBeat}
              playbackBeat={playbackBeat}
              scrollRef={numberedScrollRef}
              dragging={draggingSurface === "numbered"}
              onPointerDown={(event) => beginScoreDrag("numbered", event)}
              onPointerMove={moveScoreDrag}
              onPointerUp={endScoreDrag}
            />}
            <div className="paper-footer"><span>{tr("单声部固定槽录入 · 谱面不响应点击 · 只由键盘光标控制", "Monophonic fixed-slot entry · The score is display-only and controlled by the keyboard cursor")}</span><strong>{tr(`第 ${Math.floor(cursorBeat / measureBeats) + 1} 小节 · 第 ${(cursorBeat % measureBeats) + 1} 拍`, `Bar ${Math.floor(cursorBeat / measureBeats) + 1} · Beat ${(cursorBeat % measureBeats) + 1}`)}</strong></div>
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
                <div className={selectedNote.midi === null ? "rest" : ""}>{selectedNote.midi === null ? restGlyphForBeats(selectedNote.durationBeats) : "♩"}</div>
                <span><strong>{selectedNote.midi === null ? tr("休止符", "Rest") : selectedNote.spelling || midiSpelling(selectedNote.midi, draft.notation?.keySignature)}</strong><small>{locale === "zh-CN" ? durationName(selectedNote.durationBeats) : `${selectedNote.durationBeats} beats`} · {tr(`第 ${selectedNote.beat + 1} 拍`, `Beat ${selectedNote.beat + 1}`)}</small></span>
              </div>
              {selectedNote.midi !== null && (
                <label><span>{tr("音高", "Pitch")}</span><div className="stepper wide"><button onClick={() => {
                  const midi = Math.max(0, selectedNote.midi! - 1);
                  patchSelected({ midi, spelling: midiSpelling(midi, draft.notation?.keySignature, accidental), numeral: numeralForMidi(midi, draft.tuning.tonicMidi) });
                }}><Minus /></button><strong>{selectedNote.spelling || midiSpelling(selectedNote.midi, draft.notation?.keySignature)}</strong><button onClick={() => {
                  const midi = Math.min(127, selectedNote.midi! + 1);
                  patchSelected({ midi, spelling: midiSpelling(midi, draft.notation?.keySignature, accidental), numeral: numeralForMidi(midi, draft.tuning.tonicMidi) });
                }}><Plus /></button></div></label>
              )}
              <label><span>{tr("起始拍", "Start beat")}</span><input type="number" min="0" step={EDIT_GRID_BEATS} value={selectedNote.beat} onChange={(event) => patchSelected({ beat: Math.max(0, Number(event.target.value)) })} /></label>
              <label><span>{tr("时值", "Duration")}</span><select value={selectedNote.durationBeats} onChange={(event) => patchSelected({ durationBeats: Number(event.target.value) })}>{DURATION_OPTIONS.flatMap((option) => [<option key={option.beats} value={option.beats}>{locale === "zh-CN" ? option.label : `${option.beats} beats`}</option>, <option key={`${option.beats}-dot`} value={option.beats * 1.5}>{locale === "zh-CN" ? `附点${option.label} · ${option.beats * 1.5} 拍` : `Dotted · ${option.beats * 1.5} beats`}</option>])}</select></label>
              {selectedNote.midi !== null && <label><span>{tr("简谱音级", "Numbered degree")}</span><input value={selectedNote.numeral ?? ""} placeholder={numeralForMidi(selectedNote.midi, draft.tuning.tonicMidi)} onChange={(event) => patchSelected({ numeral: event.target.value })} /></label>}
              <label><span>{tr("歌词", "Lyric")}</span><input value={selectedNote.lyric ?? ""} placeholder={tr("当前音对应的字", "Syllable for this note")} onChange={(event) => patchSelected({ lyric: event.target.value })} /></label>
              <div className="note-actions">
                {selectedNote.midi !== null && <button className={selectedNote.tieToNext ? "active" : ""} onClick={toggleSelectedTie}><Link2 /> {selectedNote.tieToNext ? tr("取消延音线", "Remove tie") : tr("连接下一音", "Tie to next")}</button>}
                <button onClick={duplicateSelected}><Copy /> {tr("复制到下一拍", "Duplicate next")}</button>
                <button className="danger" onClick={removeSelected}><Trash2 /> {tr("删除", "Delete")}</button>
              </div>
            </section>
          ) : (
            <div className="inspector-empty"><Keyboard /><strong>{tr("移动到一个音符", "Move to a note")}</strong><span>{tr("开启录入后用方向键移动橙色光标。光标位于音符起点时，可在这里精确编辑歌词和属性。", "Start keyboard entry and move the orange cursor with the arrow keys. When it reaches a note start, edit lyrics and properties here.")}</span></div>
          )}

          <section className="tuning-fields">
            <div className="inspector-section-title"><AlignLeft /><span><strong>{tr("练唱基准", "Practice tuning")}</strong><small>{tr("保存后直接用于音准判定", "Used for pitch scoring after save")}</small></span></div>
            <label><span>{tr("简谱 1 =", "Numbered 1 =")}</span><select value={draft.tuning.tonicMidi} onChange={(event) => commit((current) => ({ ...current, tuning: { ...current.tuning, tonicMidi: Number(event.target.value) } }))}>{Array.from({ length: 36 }, (_, index) => 48 + index).map((midi) => <option key={midi} value={midi}>{midiToNoteName(midi)}</option>)}</select></label>
            <label><span>{tr("A4 基准", "A4 reference")}</span><div><input type="number" min="430" max="450" value={draft.tuning.referenceHz} onChange={(event) => commit((current) => ({ ...current, tuning: { ...current.tuning, referenceHz: Number(event.target.value) } }))} /><small>Hz</small></div></label>
          </section>

          <div className="editor-help">
            <strong>{tr("键盘录入顺序", "Keyboard entry sequence")}</strong>
            <p>{tr("开始录入 → 选择时值 → 用十二音键输入；Shift+音键升半音，Ctrl+音键降半音，空格仍输入当前时值的标准休止符。每次输入后按十六分网格自动前进，小节末会续到下一小节。", "Start entry, choose a duration, then use the 12 pitch keys. Shift+pitches raises a semitone, Ctrl+pitches lowers one, and Space still enters a proper rest at the current duration. Entry advances on the sixteenth grid and continues into the next bar.")}</p>
          </div>
        </aside>
      </div>
      {showEditorSettings && (
        <div className="editor-settings-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setShowEditorSettings(false)}>
          <aside className="editor-settings-drawer">
            <div className="editor-settings-head">
              <div><span>{tr("制谱偏好", "COMPOSER PREFERENCES")}</span><strong>{tr("显示与键位", "Display & keys")}</strong></div>
              <button onClick={() => setShowEditorSettings(false)} aria-label={tr("关闭", "Close")}><X /></button>
            </div>
            <section className="display-scale-setting">
              <div><span>{tr("全软件界面缩放", "Interface scale")}</span><strong>{uiScale}%</strong></div>
              <input
                type="range"
                min="80"
                max="200"
                step="10"
                value={uiScale}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  onUiScaleChange(next);
                  setPreferences((current) => ({ ...current, uiScale: next }));
                }}
              />
              <div className="scale-presets">
                {[100, 125, 150, 175, 200].map((value) => <button className={uiScale === value ? "active" : ""} key={value} onClick={() => {
                  onUiScaleChange(value);
                  setPreferences((current) => ({ ...current, uiScale: value }));
                }}>{value}%</button>)}
              </div>
              <small>{tr("高分辨率或远距离屏幕建议使用 125%–200%。文字、按钮、侧栏和谱面会同步放大。", "Use 125%–200% on high-resolution or distant displays. Text, controls, panels, and notation scale together.")}</small>
            </section>
            <div className="shortcut-settings-intro">
              <Keyboard />
              <span><strong>{tr("自定义键位", "Custom key bindings")}</strong><small>{tr("点击一个按键框，再按新的组合键。Esc 取消；重复键位不会保存。", "Click a key box, then press a new key or chord. Esc cancels; duplicates are rejected.")}</small></span>
            </div>
            {shortcutGroups.map((group) => (
              <section className="shortcut-settings-group" key={group.title}>
                <h3>{group.title}</h3>
                <div>
                  {group.ids.map((id) => (
                    <label key={id}>
                      <span>{shortcutName(id)}</span>
                      <button
                        className={rebinding === id ? "listening" : ""}
                        onClick={() => setRebinding(id)}
                        onKeyDown={(event) => rebinding === id && changeShortcut(id, event)}
                      >{rebinding === id ? tr("请按新键…", "Press a key…") : shortcutLabel(preferences.shortcuts[id])}</button>
                    </label>
                  ))}
                </div>
              </section>
            ))}
            <button className="reset-shortcuts" onClick={() => {
              setPreferences((current) => ({ ...current, shortcuts: { ...DEFAULT_SHORTCUTS } }));
              setRebinding(null);
              setToast(tr("快捷键已恢复默认", "Keyboard shortcuts restored."));
            }}><RotateCcw /> {tr("恢复默认键位", "Restore default bindings")}</button>
          </aside>
        </div>
      )}
      {toast && <div className="composer-toast"><span>✓</span>{toast}<button onClick={() => setToast("")}><X /></button></div>}
    </div>
  );
}
