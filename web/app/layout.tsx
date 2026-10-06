import './globals.css';
export const metadata = { title: '排課助手' };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (<html lang="zh-Hant"><head>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" /></head>
    <body>{children}</body></html>);
}
