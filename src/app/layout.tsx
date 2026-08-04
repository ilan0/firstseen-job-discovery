import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { ServiceWorkerRegistration } from "@/components/pwa/service-worker-registration";
import { rolloutFlags } from "@/config/rollout";
import "./globals.css";

export function generateMetadata(): Metadata {
  const pwaEnabled = rolloutFlags().pwa;
  return {
    title: { default: "FirstSeen", template: "%s · FirstSeen" },
    description: "Fresh, verified software engineering opportunities matched to you.",
    applicationName: "FirstSeen",
    ...(pwaEnabled
      ? {
          manifest: "/manifest.webmanifest",
          appleWebApp: {
            capable: true,
            statusBarStyle: "black-translucent" as const,
            title: "FirstSeen",
          },
          icons: {
            icon: [
              { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
              { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
            ],
            apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
          },
        }
      : {}),
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#084b38",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  const pwaEnabled = rolloutFlags().pwa;
  return (
    <html lang="en">
      <body>
        {children}
        <ServiceWorkerRegistration enabled={pwaEnabled} />
      </body>
    </html>
  );
}
