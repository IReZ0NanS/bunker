import type { Metadata } from "next";
import { Manrope, Oswald } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["cyrillic", "latin"],
});

const oswald = Oswald({
  variable: "--font-oswald",
  subsets: ["cyrillic", "latin"],
});

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3000";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const metadataBase = new URL(`${protocol}://${host}`);
  const title = "Бункер: Протокол — онлайн-гра без ведучого";
  const description = "Автономна онлайн-гра про виживання для 4–12 людей: досьє, дискусії, голосування та випадкові події.";
  return {
    metadataBase,
    title,
    description,
    icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
    openGraph: {
      title,
      description,
      type: "website",
      locale: "uk_UA",
      images: [{ url: "/og.png", width: 1734, height: 907, alt: "Бункер: Протокол виживання" }],
    },
    twitter: { card: "summary_large_image", title, description, images: ["/og.png"] },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="uk">
      <body className={`${manrope.variable} ${oswald.variable}`}>{children}</body>
    </html>
  );
}
