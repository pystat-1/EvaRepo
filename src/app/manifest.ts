import type { MetadataRoute } from "next";

// One installable PWA for the whole platform. start_url is "/" (not a
// role-specific page) so that whoever installs it — admin, evaluator, or
// student — lands on their own home via the role router in app/page.tsx.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eva — منصة التقييم السريري",
    short_name: "Eva",
    description: "تقييم الممارسة اليومية للطلاب في المستشفى — للمدير والمقيّم",
    id: "/",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#f8fafc",
    theme_color: "#0e5c6b",
    lang: "ar",
    dir: "rtl",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "طلابي", short_name: "طلابي", url: "/my" },
      { name: "جدولي", short_name: "جدولي", url: "/schedule" },
      { name: "لوحة المدير", short_name: "المدير", url: "/dashboard" },
    ],
  };
}
