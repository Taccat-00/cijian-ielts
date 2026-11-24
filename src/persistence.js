import { STORAGE_KEY } from './core.js';
import { BACKUP_KEY, FSRS_BACKUP_KEY, createV2State, migrateV1, readV2, validateV2 } from './review/schema.js';
import { deviceTimeZone } from './review/calendar.js';
import { eventId } from './review/engine.js';

// Compare against the exact snapshot read by this page before writing. Never
// silently replace records saved by a newer tab or by a cleared browser store.
export function createPersistence(storage, key) {
  let raw = storage.getItem(key);
  return {
    raw,
    isCurrent() { return storage.getItem(key) === raw; },
    save(value) {
      if (storage.getItem(key) !== raw) {
        const error = new Error('学习记录已在其他页面更改');
        error.code = 'STORAGE_CONFLICT';
        throw error;
      }
      const next = JSON.stringify(value);
      if (next !== raw) storage.setItem(key, next);
      raw = next;
    }
  };
}

function storageError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Importing this module never migrates a store. Opening an old v2 writer creates
// a verified raw backup before publishing the FSRS format marker.
export async function createReviewPersistence(storage, {
  key = STORAGE_KEY, backupKey = BACKUP_KEY, migrate = false,
  clock = Date.now, timeZone = deviceTimeZone(), sessionIdFactory,
  locks = globalThis.navigator?.locks, singleTab = false
} = {}) {
  if (key === backupKey || key === FSRS_BACKUP_KEY || backupKey === FSRS_BACKUP_KEY) throw new Error('备份键不能与主存储键相同');
  const exclusive = task => {
    if (locks?.request) return locks.request(`cijian:root:${key}`, { mode: 'exclusive' }, task);
    if (!singleTab) throw storageError('SINGLE_TAB_REQUIRED', '当前环境无 Web Locks；请明确使用单标签页模式');
    return task();
  };
  let raw, state;
  // Serialize initialization as well as commits, including backup verification.
  const initialize = () => {
    raw = storage.getItem(key);
    if (raw !== null) {
      const data = JSON.parse(raw);
      if (data?.version === 2) {
        const candidate=readV2(raw);
        if(data.srs.algorithmVersion===1) {
          const backup=storage.getItem(FSRS_BACKUP_KEY);
          if(backup!==null && backup!==raw)throw storageError('BACKUP_CONFLICT','已有不同的 FSRS 升级前备份，迁移已停止');
          if(backup===null)storage.setItem(FSRS_BACKUP_KEY,raw);
          if(storage.getItem(FSRS_BACKUP_KEY)!==raw)throw storageError('BACKUP_FAILED','FSRS 升级前备份未完成');
          if(storage.getItem(key)!==raw)throw storageError('STORAGE_CONFLICT','学习记录已在其他页面更改');
          const next=JSON.stringify(candidate);
          storage.setItem(key,next);
          raw=next;
        }
        state=candidate; return;
      }
      if (data?.version !== 1) throw storageError('UNSUPPORTED_VERSION', '存储版本不受支持，禁止降级覆盖');
      if (!migrate) throw storageError('MIGRATION_REQUIRED', 'v1 记录需显式开启备份迁移');
      const candidate = migrateV1(data,{ now:clock(),timeZone,sessionIdFactory });
      const backup=storage.getItem(backupKey);
      if (backup !== null && backup !== raw) throw storageError('BACKUP_CONFLICT', '已有不同的 v1 备份，迁移已停止');
      if (backup === null) storage.setItem(backupKey,raw);
      if (storage.getItem(backupKey) !== raw) throw storageError('BACKUP_FAILED', '旧记录备份未完成');
      if (storage.getItem(key) !== raw) throw storageError('STORAGE_CONFLICT', '学习记录已在其他页面更改');
      const next=JSON.stringify(candidate);
      storage.setItem(key,next);
      raw=next; state=candidate;
    } else {
      // A blank state is kept in memory until the caller explicitly commits.
      state=createV2State({now:clock(),timeZone});
    }
  };
  // Reading an existing v2 snapshot does not require a write capability.
  const existing=storage.getItem(key);
  if (existing !== null && JSON.parse(existing)?.version === 2 && JSON.parse(existing)?.srs?.algorithmVersion === 2) { raw=existing; state=readV2(raw); }
  else await exclusive(initialize);

  let queue=Promise.resolve();
  function enqueue(task) {
    const result=queue.then(()=>exclusive(task));
    queue=result.catch(()=>{});
    return result;
  }
  function checkCurrent() {
    if (storage.getItem(key) !== raw) throw storageError('STORAGE_CONFLICT', '学习记录已在其他页面更改');
  }
  function publish(candidate) {
    checkCurrent();
    if (candidate.revision !== state.revision) throw storageError('REVISION_CONFLICT', '候选快照修订号已过期');
    if (candidate.srs.timeZone !== state.srs.timeZone || candidate.srs.activatedAt !== state.srs.activatedAt) throw new Error('学习时区与启用时间不可自动更改');
    candidate.revision++;
    const checked=validateV2(candidate), next=JSON.stringify(checked);
    // No in-memory publication until setItem succeeds. Failure leaves both the
    // durable snapshot and the repository baseline intact for a same-ID retry.
    checkCurrent();
    storage.setItem(key,next);
    raw=next; state=checked;
    return validateV2(state);
  }
  return {
    get raw() { return raw; },
    get mode() { return locks?.request ? 'web-locks' : 'single-tab'; },
    snapshot() { return validateV2(state); },
    isCurrent() { return storage.getItem(key) === raw; },
    commit(candidate) {
      const copy=structuredClone(candidate);
      return enqueue(()=>publish(copy));
    },
    // Score, memory and plan updates share one atomic snapshot. Gating here
    // happens before scoring or scheduling, including retries after refresh.
    transact(reducer, { event = null } = {}) {
      if (typeof reducer !== 'function') return Promise.reject(new TypeError('需要快照更新函数'));
      const descriptor=event === null ? null : structuredClone(event);
      return enqueue(()=>{
        checkCurrent();
        const candidate=validateV2(state), session=candidate.session;
        let id;
        if (descriptor !== null) {
          id=eventId(descriptor.sessionId,descriptor.questionIndex);
          if (!session || session.sessionId !== descriptor.sessionId) throw storageError('STALE_EVENT','仅接受当前会话事件');
          const accepted=session.answers[descriptor.questionIndex];
          if (accepted?.eventId === id) return { accepted:false,state:validateV2(state) };
          const now=clock();
          const latest=Object.values(candidate.srs.memories).reduce((at,m)=>Math.max(at,m.lastReviewedAt ?? 0),candidate.srs.activatedAt);
          if (now < latest) throw storageError('CLOCK_ROLLBACK','学习时钟回退，请校时后重试');
          if (session.status !== 'active' || session.index !== descriptor.questionIndex || session.answers.length !== session.index ||
              now < session.startedAt || (session.timed && now >= session.deadline)) throw storageError('STALE_EVENT','仅接受当前未答题位的事件');
        }
        const result=reducer(candidate);
        if (result?.then) throw new Error('快照更新函数必须同步执行');
        if (descriptor !== null) {
          const updated=candidate.session;
          if (updated?.sessionId !== descriptor.sessionId || updated.answers.length !== state.session.answers.length + 1) throw new Error('事件必须恰好提交一份答案');
          const answer=updated.answers[descriptor.questionIndex];
          if (!answer || answer.wordId !== state.session.questions[descriptor.questionIndex].wordId) throw new Error('答案与题目不一致');
          const latest=Object.values(state.srs.memories).reduce((at,m)=>Math.max(at,m.lastReviewedAt ?? 0),state.srs.activatedAt);
          if (answer.at < latest) throw storageError('CLOCK_ROLLBACK','学习时钟回退，请校时后重试');
          answer.eventId=id;
        }
        return { accepted:true,state:publish(candidate) };
      });
    }
  };
}
