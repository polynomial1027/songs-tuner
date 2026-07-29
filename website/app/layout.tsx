import type { Metadata } from "next";
import { headers } from "next/headers";
import { Geist_Mono, Noto_Sans_SC, Outfit } from "next/font/google";
import "./globals.css";

const noto = Noto_Sans_SC({
  variable: "--font-noto",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const outfit = Outfit({
  variable: "--font-outfit",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  return {
    metadataBase,
    title: {
      default: "SingRight 准唱 — 练准每一个音",
      template: "%s · SingRight 准唱",
    },
    description:
      "跨平台歌唱音准训练与五线谱制谱软件。支持点谱、参考音频对齐、逐音校准、连续跟唱、整曲复盘和录音分析。",
    icons: {
      icon: "/icon.png",
      shortcut: "/icon.png",
    },
    openGraph: {
      title: "SingRight 准唱 — 练准每一个音",
      description: "五线谱打谱、参考音频波形对齐、麦克风实时校准与整曲复盘。",
      images: ["/og-v2.png"],
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: "SingRight 准唱 — 练准每一个音",
      description: "跨平台五线谱制谱与实时歌唱音准训练器。",
      images: ["/og-v2.png"],
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${noto.variable} ${outfit.variable} ${geistMono.variable}`}
      >
        {children}
      </body>
    </html>
  );
}
