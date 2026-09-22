import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import { App } from './App';
import './styles.css';

if (import.meta.env.DEV && import.meta.env['VITE_DISABLE_REACT_DEVTOOLS'] !== '1') {
  void import('react-grab').catch((error: unknown) => { if (error instanceof Error) console.warn('开发选取工具不可用', error.message); });
  void import('react-scan').then(({ scan }) => scan({ enabled: true })).catch((error: unknown) => { if (error instanceof Error) console.warn('开发渲染工具不可用', error.message); });
}
const root = document.getElementById('root');
if (root) createRoot(root).render(<StrictMode><ConfigProvider locale={zhCN} theme={{ token: { colorPrimary: '#2563eb', colorText: '#17223b', colorTextSecondary: '#667085', colorBorder: '#e6eaf0', borderRadius: 8, controlHeight: 36, fontFamily: '-apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif' } }}><App /></ConfigProvider></StrictMode>);
