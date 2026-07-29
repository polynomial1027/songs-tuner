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

麦克风和上传的录音默认只在用户设备上处理。软件不会把音频上传到远端服务。

## 许可证

[MIT](LICENSE)
