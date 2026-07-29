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
- `notes[].midi`：目标音高；`null` 表示休止。
- `notes[].beat`：从曲目开始算起的起始拍。
- `notes[].durationBeats`：持续拍数。
- `notes[].numeral`：可选的简谱显示文字，如 `1`、`#4`、`6·`。
- `notes[].lyric`：可选歌词。

音符必须按 `beat` 递增排列且不能重叠。桌面应用导入时会再次校验，并给出可读错误。

## 移调

应用不会修改原始文件。手动升降调或“以当前音为首音”只会给所有非休止音临时增加相同的半音偏移。A4 参考频率可以在 430–450 Hz 间调整。

## 兼容其他格式

v1 以稳定、简单的 JSON 为交换格式。MusicXML/MIDI 导入可以通过转换器加入，转换后的运行时格式仍是 `.singright.json`。
