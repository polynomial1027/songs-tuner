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
      "跨平台实时歌唱音准训练器。支持逐音校准、连续跟唱、整曲复盘、统一曲谱导入和录音分析。",
    icons: {
      icon: "/icon.png",
      shortcut: "/icon.png",
    },
    openGraph: {
      title: "SingRight 准唱 — 练准每一个音",
      description: "麦克风实时校准、逐音练习、连续跟唱与整曲复盘。",
      images: ["/og.png"],
      type: "website",
      locale: "zh_CN",
    },
    twitter: {
      card: "summary_large_image",
      title: "SingRight 准唱 — 练准每一个音",
      description: "跨平台实时歌唱音准训练器。",
      images: ["/og.png"],
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
