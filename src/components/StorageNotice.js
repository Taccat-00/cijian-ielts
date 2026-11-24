import { escapeHTML as e } from '../utils/html.js';
import { icon } from './icons.js';
import { Button } from './controls.js';

export function StorageNotice({message,readOnly=false,conflict=false,retry=false}) {
  const title=readOnly?'只读浏览':conflict?'学习记录已更改':'操作尚未保存';
  return `<div class="storage-notice-copy">${icon('info')}<div><strong>${title}</strong><p>${e(message)}</p></div></div><div class="storage-notice-actions">${retry && !readOnly && !conflict?Button({label:'重试保存',action:'retry-save',variant:'secondary'}):''}${readOnly || conflict?Button({label:'重新加载',action:'reload',variant:'text-link'}):''}</div>`;
}
