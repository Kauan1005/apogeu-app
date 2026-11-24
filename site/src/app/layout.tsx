import type { Metadata, Viewport } from "next";
import { cookies } from "next/headers";
import { Geist, Geist_Mono, Montserrat } from "next/font/google";
import "./globals.css";
import { RegisterSW } from "@/components/register-sw";
import { PressFeedback } from "@/components/press-feedback";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// fonte do nome da marca ("apogeu"); servida pelo próprio site (next/font), sem chamar o Google no navegador
const brandFont = Montserrat({ variable: "--font-brand", subsets: ["latin"], weight: "500" });

export const metadata: Metadata = {
  title: { default: "Apogeu", template: "%s · Apogeu" },
  description: "Finanças pessoais: contas, cartões e Pix organizados automaticamente.",
  manifest: "/manifest.webmanifest",
  icons: { icon: [{ url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" }, { url: "/icons/app.svg", type: "image/svg+xml" }], apple: "/icons/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: "Apogeu", statusBarStyle: "black-translucent" },
  robots: { index: false, follow: false },
};

type Theme = "dark" | "light" | "auto";
async function currentTheme(): Promise<Theme> {
  const v = (await cookies()).get("apogeu-theme")?.value;
  return v === "light" || v === "auto" ? v : "dark"; // escuro é o padrão
}

export async function generateViewport(): Promise<Viewport> {
  const t = await currentTheme();
  const themeColor = t === "light" ? "#f6f5f2" : t === "auto"
    ? [{ media: "(prefers-color-scheme: light)", color: "#f6f5f2" }, { media: "(prefers-color-scheme: dark)", color: "#0b0b0b" }]
    : "#0b0b0b";
  return { themeColor, colorScheme: t === "dark" ? "dark" : t === "light" ? "light" : "light dark", viewportFit: "cover" };
}

export default async function RootLayout({ children }: LayoutProps<"/">) {
  const theme = await currentTheme();
  return (
    <html
      lang="pt-BR"
      data-theme={theme}
      className={`${geistSans.variable} ${geistMono.variable} ${brandFont.variable}`}
    >
      <body>
        {children}
        <RegisterSW />
        <PressFeedback />
      </body>
    </html>
  );
}
