import { createApp } from 'vue';
import ElementPlus from 'element-plus';
import 'element-plus/dist/index.css';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import {
  Bell,
  Calendar,
  Clock,
  Coin,
  Connection,
  DataLine,
  FolderChecked,
  Guide,
  Histogram,
  Key,
  Link,
  Loading,
  Monitor,
  Moon,
  Operation,
  Refresh,
  Setting,
  Sunny,
  Tickets,
  Timer,
  TrendCharts,
  User,
  Wallet
} from '@element-plus/icons-vue';
import App from './App.vue';
import './styles.scss';

const app = createApp(App);

app.config.errorHandler = (error, instance, info) => {
  if (typeof window !== 'undefined') {
    window.__AWP_RENDER_ERRORS = window.__AWP_RENDER_ERRORS || [];
    window.__AWP_RENDER_ERRORS.push({
      info,
      message: error?.message || String(error),
      stack: error?.stack || ''
    });
  }
  console.error('[美术部工作台渲染错误]', info, error);
};

app.config.warnHandler = (message, instance, trace) => {
  console.warn('[美术部工作台渲染警告]', message, trace);
};

app
  .use(ElementPlus, { locale: zhCn })
  .component('Bell', Bell)
  .component('Calendar', Calendar)
  .component('Clock', Clock)
  .component('Coin', Coin)
  .component('Connection', Connection)
  .component('DataLine', DataLine)
  .component('Monitor', Monitor)
  .component('Moon', Moon)
  .component('Operation', Operation)
  .component('FolderChecked', FolderChecked)
  .component('Guide', Guide)
  .component('Histogram', Histogram)
  .component('Key', Key)
  .component('Link', Link)
  .component('Loading', Loading)
  .component('Refresh', Refresh)
  .component('Setting', Setting)
  .component('Sunny', Sunny)
  .component('Tickets', Tickets)
  .component('Timer', Timer)
  .component('TrendCharts', TrendCharts)
  .component('User', User)
  .component('Wallet', Wallet)
  .mount('#app');
