import { loadDataset } from './data.js';
import { startApplication } from './application.js';
import { escapeHTML as e } from './utils/html.js';
import { enhanceLiquidGlass } from './liquid-glass.js';
const $ = selector => document.querySelector(selector);

let dataset, dataWarning = '';
try {
  const loaded = await loadDataset(fetch, new URL('../data/vocabulary.json', import.meta.url), new URL('../data/demo.json', import.meta.url));
  dataset = loaded.dataset; dataWarning = loaded.warning;
} catch (error) {
  $('#app').innerHTML = `<div class="boot"><h1>词库暂时没有打开</h1><p>请通过本地服务器访问，并尝试刷新页面。</p><p>${e(error.message)}</p><button onclick="location.reload()">重新加载</button></div>`;
  throw error;
}

await startApplication(dataset, dataWarning);
enhanceLiquidGlass($('#app'));
