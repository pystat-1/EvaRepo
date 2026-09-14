import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Eva — قاعدة بيانات الطلاب",
  description: "نظام تقييم الممارسة اليومية في المستشفى — المرحلة الأولى: قاعدة البيانات",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ar" dir="rtl" className="h-full">
      <body className="min-h-full flex flex-col bg-slate-50 text-slate-900 antialiased">
        {children}
      </body>
    </html>
  );
}
