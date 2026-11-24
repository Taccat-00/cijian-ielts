import { STORAGE_KEY } from '../core.js';
import { createReviewPersistence } from '../persistence.js';
import { createV2State, migrateV1, readV2 } from './schema.js';
import { deviceTimeZone } from './calendar.js';

// A live-page lease, separate from the short root-commit lock. No localStorage
// pseudo-locks. Old v1 pages do not cooperate, hence explicit migration guidance.
export async function acquireWriterLease(locks,key=STORAGE_KEY) {
  if(!locks?.request)return {writable:false,release(){}};
  let release,resolveReady;
  const ready=new Promise(resolve=>{resolveReady=resolve;});
  const hold=new Promise(resolve=>{release=resolve;});
  const request=locks.request(`cijian:app:${key}`,{ifAvailable:true,mode:'exclusive'},async lock=>{
    resolveReady(Boolean(lock));if(lock)await hold;
  });
  request.catch(()=>resolveReady(false));
  return {writable:await ready,release};
}

export async function openLearningStorage(storage,{clock=Date.now,timeZone=deviceTimeZone(),
  locks=globalThis.navigator?.locks,allowMigration=false,readOnly=false,sessionIdFactory}={}) {
  const raw=storage.getItem(STORAGE_KEY), data=raw===null?null:JSON.parse(raw);
  if(data?.version===1 && !allowMigration && !readOnly)throw Object.assign(new Error('升级前请关闭其他旧版学习标签页，再备份并升级。'),{code:'MIGRATION_REQUIRED'});
  const lease=readOnly?{writable:false,release(){}}:await acquireWriterLease(locks);
  if(!lease.writable) {
    let state;
    if(data===null)state=createV2State({now:clock(),timeZone});
    else if(data.version===2)state=readV2(raw);
    else if(data.version===1)state=migrateV1(data,{now:clock(),timeZone,sessionIdFactory});
    else throw new Error('记录版本不受支持，原数据未覆盖');
    return {state,repository:null,release:lease.release,writable:false,
      warning:readOnly?'当前为只读浏览，未执行迁移或保存。':locks?.request?'其他学习页正在使用记录；此页只读，请关闭其他学习页后刷新。':'当前浏览器不支持安全写入锁；此页只读，请使用支持 Web Locks 的浏览器。'};
  }
  try {
    const repository=await createReviewPersistence(storage,{clock,timeZone,locks,migrate:allowMigration,sessionIdFactory});
    return {repository,state:repository.snapshot(),writable:true,release:lease.release,warning:''};
  } catch(error){lease.release();throw error;}
}
