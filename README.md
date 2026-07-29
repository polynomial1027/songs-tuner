# SingRight 准唱

SingRight 是一款面向 macOS、Windows 和 Linux 的开源唱歌音准训练器。它通过麦克风在本机实时检测音高，并根据导入的统一曲谱进行逐音、连续跟唱和整曲复盘。

产品与下载页面：[polynomial1027.github.io/songs-tuner](https://polynomial1027.github.io/songs-tuner/)

## 已实现

- 实时麦克风音高检测与音分偏差显示
- 逐音校准：唱准并稳定保持后自动进入下一音
- 连续跟唱：按速度和时值滚动比对
- 整曲复盘：录制完整演唱并列出需要重练的音
- 导入 `.singright.json` 曲谱
- 上传 WAV、MP3、M4A 等浏览器可解码录音并离线分析
- 半音升降调、首音定调、A4 参考频率与容差设置
- 内置五线谱工作台：鼠标点谱、屏幕钢琴和 A–G 键盘录入
- 高音/低音谱号、调号、拍号、附点、休止符、唱名和歌词编辑
- 100 步撤销/重做、自动保存、复制、删除和精确拍点编辑
- 合成音试听、预备拍、节拍器和小节区间循环
- 参考音频波形、裁剪、偏移、音量和播放速度调整
- MusicXML 导入导出与标准 MIDI 导出
- 低到高音阶示例和一个空白曲目模板
- GitHub Actions 自动构建 macOS、Windows、Linux 安装包
- 独立下载官网

## 项目结构

```text
desktop/   Tauri + React 跨平台桌面应用
examples/  示例曲谱
docs/      曲谱格式说明
website/   下载官网
```

## 本地开发

需要 Node.js 22+、pnpm 10+ 和 Rust stable。

```bash
cd desktop
pnpm install
pnpm tauri dev
```

仅运行前端预览：

```bash
cd desktop
pnpm dev
```

官网：

```bash
cd website
npm ci
npm run dev
```

## 构建安装包

推送 `v*` 标签会触发 `.github/workflows/release.yml`，在三个操作系统上构建并附加安装包到 GitHub Release。

## 隐私

麦克风、上传的录音和制谱参考音频默认只在用户设备上处理。曲谱只保存参考音频的文件名和对齐参数，不会嵌入或上传音频。

## 许可证

[MIT](LICENSE)
