"use client";

import { useEffect, useMemo, useState } from "react";

interface ReleaseAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface LatestRelease {
  tag_name: string;
  published_at: string;
  html_url: string;
  assets: ReleaseAsset[];
}

const RELEASES_URL = "https://github.com/polynomial1027/songs-tuner/releases";

const platforms = [
  {
    id: "mac",
    name: "macOS",
    detail: "Apple Silicon / Intel",
    format: ".dmg",
    minimum: "macOS 10.15+",
    icon: "⌘",
    match: (name: string) => name.endsWith(".dmg"),
  },
  {
    id: "windows",
    name: "Windows",
    detail: "64-bit",
    format: ".msi / .exe",
    minimum: "Windows 10+",
    icon: "⊞",
    match: (name: string) => name.endsWith(".msi") || name.toLowerCase().endsWith("-setup.exe"),
  },
  {
    id: "linux",
    name: "Linux",
    detail: "x86_64",
    format: ".AppImage / .deb",
    minimum: "Ubuntu 22.04+",
    icon: "◆",
    match: (name: string) => name.endsWith(".AppImage") || name.endsWith(".deb"),
  },
];

type DownloadLocale = "zh-CN" | "en";

function matchesLocale(name: string, locale: DownloadLocale): boolean {
  const normalized = name.toLowerCase();
  return locale === "zh-CN"
    ? normalized.includes("zh-cn")
    : /(^|[-_.])en([-. _]|$)/.test(normalized);
}

export default function DownloadsClient() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("https://api.github.com/repos/polynomial1027/songs-tuner/releases?per_page=10", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then((response) => response.ok ? response.json() as Promise<Array<LatestRelease & { draft?: boolean }>> : Promise.reject())
      .then((releases) => setRelease(releases.find((candidate) => !candidate.draft) ?? null))
      .catch(() => setRelease(null))
      .finally(() => setLoaded(true));
  }, []);

  const date = useMemo(() => release
    ? new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "long", day: "numeric" }).format(new Date(release.published_at))
    : "", [release]);

  return (
    <section className="downloads wrap">
      <div className="release-line">
        <span>最新版本</span>
        <strong>{release?.tag_name ?? (loaded ? "预览版即将发布" : "正在检查…")}</strong>
        {date && <small>发布于 {date}</small>}
        <a href={release?.html_url ?? RELEASES_URL}>查看发布说明 ↗</a>
      </div>
      <div className="platform-cards">
        {platforms.map((platform) => {
          const zhAsset = release?.assets.find((candidate) => platform.match(candidate.name) && matchesLocale(candidate.name, "zh-CN"));
          const enAsset = release?.assets.find((candidate) => platform.match(candidate.name) && matchesLocale(candidate.name, "en"));
          const fallbackAsset = release?.assets.find((candidate) => platform.match(candidate.name));
          const ready = Boolean(zhAsset || enAsset || fallbackAsset);
          return (
            <article key={platform.id}>
              <div className={`platform-icon ${platform.id}`}>{platform.icon}</div>
              <span>{platform.detail}</span>
              <h2>{platform.name}</h2>
              <p>{platform.minimum}<br />安装包格式 {platform.format}</p>
              <div className="language-downloads">
                <a href={(zhAsset ?? fallbackAsset)?.browser_download_url ?? RELEASES_URL}>
                  <span><b>中文版</b><small>{zhAsset ? `${(zhAsset.size / 1024 / 1024).toFixed(1)} MB` : "中文界面"}</small></span><i>↓</i>
                </a>
                <a href={(enAsset ?? fallbackAsset)?.browser_download_url ?? RELEASES_URL}>
                  <span><b>English</b><small>{enAsset ? `${(enAsset.size / 1024 / 1024).toFixed(1)} MB` : "English UI"}</small></span><i>↓</i>
                </a>
              </div>
              <small>{ready ? "应用内可随时切换中文 / English" : "构建完成后自动出现下载包"}</small>
            </article>
          );
        })}
      </div>
      <div className="installer-language-note">
        <strong>双语安装与界面</strong>
        <span>Windows 安装器会按系统语言自动选择中文或 English，也可以在安装开始时手动切换。macOS 与 Linux 请先选偏好的语言包，进入应用后仍可随时改语言。</span>
      </div>
      <div className="source-download">
        <span>想自己构建或参与开发？</span>
        <a href="https://github.com/polynomial1027/songs-tuner" target="_blank" rel="noreferrer">获取源代码 ↗</a>
      </div>
    </section>
  );
}
