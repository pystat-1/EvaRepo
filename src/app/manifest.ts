import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Eva — تطبيق المقيّم",
    short_name: "Eva",
    description: "تقييم الممارسة اليومية للطلاب في المستشفى",
    start_url: "/my",
    display: "standalone",
    background_color: "#f8fafc",
    theme_color: "#1a5276",
    lang: "ar",
    dir: "rtl",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
