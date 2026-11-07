import "./globals.css";

export const metadata = {
  title: "Inkling",
  description: "A Chinese handwriting tutor, built for WHACK 2026.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
