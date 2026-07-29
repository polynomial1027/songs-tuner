# SingRight 曲谱格式 v1

SingRight 使用 UTF-8 编码的 JSON 文件，推荐后缀为 `.singright.json`。音高使用 MIDI 音符编号，时值使用拍数，因此无需绑定某一种记谱软件。

## 最小示例

```json
{
  "$schema": "https://raw.githubusercontent.com/polynomial1027/songs-tuner/main/schema/singright-score.schema.json",
  "format": "singright-score",
  "version": 1,
  "metadata": {
    "id": "my-song",
    "title": "我的歌曲",
    "artist": "佚名"
  },
  "tempo": { "bpm": 88 },
  "timeSignature": { "beats": 4, "beatUnit": 4 },
  "tuning": { "referenceHz": 440, "tonicMidi": 60 },
  "notation": { "clef": "treble", "keySignature": 0 },
  "notes": [
    {
      "id": "n1",
      "midi": 60,
      "beat": 0,
      "durationBeats": 1,
      "numeral": "1",
      "lyric": "唱"
    }
  ]
}
```

## 字段

- `format`：固定为 `singright-score`。
- `version`：当前固定为 `1`。
- `metadata.id`：曲目稳定标识，只能使用字母、数字、点、下划线和短横线。
- `metadata.title`：显示名称。
- `tempo.bpm`：每分钟拍数，范围 20–300。
- `timeSignature`：拍号。
- `tuning.referenceHz`：A4 的频率，默认 440 Hz。
- `tuning.tonicMidi`：简谱 `1` 对应的 MIDI 音高。
- `notation.clef`：可选，五线谱谱号，支持 `treble`（高音）或 `bass`（低音）。
- `notation.keySignature`：可选，调号的升降号数量，`-7` 至 `7`；负数代表降号。
- `notes[].midi`：目标音高；`null` 表示休止。
- `notes[].beat`：从曲目开始算起的起始拍。
- `notes[].durationBeats`：持续拍数。
- `notes[].numeral`：可选的简谱显示文字，如 `1`、`#4`、`6·`。
- `notes[].lyric`：可选歌词。
- `notes[].spelling`：可选的五线谱音名拼写，如 `F♯4` 或 `B♭3`，用于保留等音记谱习惯。

音符必须按 `beat` 递增排列且不能重叠。桌面应用导入时会再次校验，并给出可读错误。

## 内置五线谱工作台

桌面端可以直接新建或编辑曲谱，无需手写 JSON：

- 谱面只负责显示，使用键盘固定槽录入：`Enter` 开始/结束，`1`–`5` 选时值，`Q W E R T Y U I O P [ ]` 依次对应当前八度的十二个半音。
- `↑`/`↓` 切换八度，`←`/`→` 移动固定槽，`Shift` + `←`/`→` 跨小节，`Home`/`End` 到小节边界，`Backspace` 删除光标前一个音。
- 支持高音/低音谱号、15 种调号、常用拍号、20–300 BPM。
- 支持全、二分、四分、八分、十六分及附点时值，使用标准休止符字形，并支持降号、调号或升号拼写、歌词和简谱音级。
- 音符不能重叠或越过小节线；每小节容量由拍号严格确定。
- 支持选择、复制、删除、半音/八度移动、拍点调整以及 100 步撤销/重做。
- 支持预备拍、节拍器、区间循环和合成音试听。
- 可导入 SingRight JSON 或单声部 MusicXML，并导出 SingRight JSON、MusicXML 和标准 MIDI。

### 参考音频轨

制谱时可在本机加载 WAV、MP3、M4A、WebM 等系统支持的音频，查看波形并调整裁剪范围、谱前偏移、音量和播放速度。JSON 仅保存下面的对齐参数和原文件名，不会嵌入或上传音频：

```json
"audioGuide": {
  "name": "reference.mp3",
  "trimStartSeconds": 2.4,
  "trimEndSeconds": 97.8,
  "offsetSeconds": 0.5,
  "gain": 0.75,
  "playbackRate": 1
}
```

再次打开曲谱时，出于本机隐私和浏览器安全限制，需要重新选择对应音频文件。

## 移调

应用不会修改原始文件。手动升降调只会给所有非休止音临时增加相同的半音偏移。“首音定调”会保存用户唱出的第一个音的实际频率，后续目标音按曲谱音程从该频率推导，统一作用于逐音、连续跟唱与整曲复盘。A4 参考频率可以在 400–480 Hz 间调整。

## 兼容其他格式

v1 以稳定、简单的 JSON 为交换格式。MusicXML/MIDI 导入可以通过转换器加入，转换后的运行时格式仍是 `.singright.json`。
