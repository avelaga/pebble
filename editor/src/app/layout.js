import "./globals.css";
import AuthProvider from "./components/AuthProvider";

// Runs before first paint so a dark-mode user never sees a light flash.
// Light is the default, whatever the OS preference.
const themeScript = `try{document.documentElement.dataset.theme=localStorage.getItem("pebble_theme")==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}`;

export const metadata = {
  title: "pebble",
  description: "Editor UI for managing blog posts",
  // The logo is a white drawing: black icon for light browser chrome, white
  // for dark. iOS ignores transparency, so its icon is black on off-white.
  icons: {
    icon: [
      { url: "/favicon-black-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: light)" },
      { url: "/favicon-white-32.png", type: "image/png", sizes: "32x32", media: "(prefers-color-scheme: dark)" },
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180" },
  },
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
