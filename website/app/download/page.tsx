import type { Metadata } from "next";
import { sitePath } from "../site-path";
import DownloadsClient from "./DownloadsClient";

export const metadata: Metadata = {
  title: "下载",
  description: "下载 SingRight 准唱的 macOS、Windows 或 Linux 版本。",
};

export default function DownloadPage() {
  return (
    <main className="download-page">
      <nav className="site-nav wrap">
        <a className="site-brand" href={sitePath()}>
          <span className="brand-wave"><i /><i /><i /></span>
          <span><strong>SingRight</strong><small>准唱</small></span>
        </a>
        <div className="nav-links">
          <a href={sitePath()}>返回首页</a>
          <a href="https://github.com/polynomial1027/songs-tuner" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>
      <header className="download-hero wrap">
        <div className="hero-kicker"><i /> 免费 · 开源 · 本机处理</div>
        <h1>选择你的系统，<br /><em>开始练准。</em></h1>
        <p>不需要账户。首次启动后允许麦克风权限，就可以打开示例音阶开始练习。</p>
      </header>
      <DownloadsClient />
      <section className="install-notes wrap">
        <div>
          <span>安装提示</span>
          <h2>第一次打开</h2>
          <p>预览版本可能还没有商业代码签名。如果系统提示来源未知，请在系统安全设置中选择仍要打开。发布包来自 GitHub Actions 的公开构建记录。</p>
        </div>
        <ol>
          <li><i>01</i><span><strong>安装并打开</strong><small>选择适合系统的安装包</small></span></li>
          <li><i>02</i><span><strong>允许麦克风</strong><small>声音只在当前设备处理</small></span></li>
          <li><i>03</i><span><strong>唱出第一个音</strong><small>从示例音阶或导入曲谱开始</small></span></li>
        </ol>
      </section>
      <footer>
        <div className="wrap">
          <a className="site-brand" href={sitePath()}><span className="brand-wave"><i /><i /><i /></span><span><strong>SingRight</strong><small>准唱</small></span></a>
          <p>练准每一个音。</p>
          <div><a href={sitePath()}>首页</a><a href="https://github.com/polynomial1027/songs-tuner">GitHub</a><a href="https://github.com/polynomial1027/songs-tuner/issues">问题反馈</a></div>
        </div>
      </footer>
    </main>
  );
}
