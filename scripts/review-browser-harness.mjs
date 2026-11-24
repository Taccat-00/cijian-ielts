// Isolated manual browser acceptance harness. Not in PUBLIC_FILES or dist.
// Each invocation allocates fresh origins; never open the user's learning port.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createStaticServer } from './serve.mjs';
import { initialState } from '../src/core.js';
import { migrateV1 } from '../src/review/schema.js';
import { generateDailyPlan } from '../src/review/daily-plan.js';
const root=fileURLToPath(new URL('../',import.meta.url));
const legacy=initialState();legacy.goal=3;legacy.saved=['atmosphere'];legacy.notes.atmosphere='迁移测试笔记';
legacy.daily['2026-11-19']=['atmosphere'];legacy.stats.atmosphere={attempts:2,correct:1};legacy.mistakes.atmosphere={count:1,lastAt:Date.parse('2026-11-19T04:00:00Z')};
const demo=JSON.parse(await readFile(new URL('../data/demo.json',import.meta.url),'utf8'));
const clockAt=Date.parse('2026-11-20T04:00:00Z');
const oldMixed=initialState();oldMixed.goal=40;oldMixed.daily['2026-11-19']=demo.words.slice(0,20).map(w=>w.id);
oldMixed.saved=demo.words.slice(0,3).map(w=>w.id);oldMixed.mistakes.atmosphere={count:2,lastAt:clockAt-86400000};
const mixed=migrateV1(oldMixed,{now:clockAt,timeZone:'Asia/Shanghai'});
mixed.srs.planSettings={chapterIds:demo.chapters.map(c=>c.id),mode:'ordered'};
mixed.srs.dailyPlans['2026-11-20']=generateDailyPlan(mixed,demo,{now:clockAt});
async function start(fixture) {
  const base=createStaticServer(root,{local:false}).listeners('request')[0];
  const server=http.createServer(async(req,res)=>{
    if(req.url==='/'||req.url==='/index.html') {
      let html=await readFile(new URL('../index.html',import.meta.url),'utf8');
      html=html.replace(/<script type="module" src="\.\/src\/app\.js"><\/script>/,
        `<aside aria-label="隔离验收控件" style="position:fixed;bottom:8px;right:8px;z-index:1000;background:#fff;padding:8px;max-width:min(420px,calc(100vw - 16px));border:1px solid #aaa;font-size:12px"><details><summary>隔离验收控件：${fixture || '空白用户'}</summary>
        <button id="test-snapshot">查看测试快照</button><button id="test-next-day">下一学习日并刷新</button>
        <button id="test-fail">模拟保存失败</button><button id="test-recover">恢复保存</button><pre id="test-output" style="max-height:180px;overflow:auto"></pre></details></aside>
        <script type="module">
          const key='cijian.ielts.v1';
          if(!localStorage.getItem('test.clock'))localStorage.setItem('test.clock',String(Date.parse('2026-11-20T04:00:00Z')));
          ${fixture?`if(localStorage.getItem(key)===null)localStorage.setItem(key,${JSON.stringify(JSON.stringify(fixture==='v1'?legacy:mixed))});`:''}
          window.__testStore={getItem:k=>localStorage.getItem(k),setItem:(k,v)=>{if(window.__testFail)throw new Error('测试容量不足');localStorage.setItem(k,v);}};
          document.querySelector('#test-next-day').onclick=()=>{localStorage.setItem('test.clock',String(Number(localStorage.getItem('test.clock'))+86400000));location.reload();};
          document.querySelector('#test-fail').onclick=()=>{window.__testFail=true;document.querySelector('#test-output').textContent='保存失败模拟已开启';};
          document.querySelector('#test-recover').onclick=()=>{window.__testFail=false;document.querySelector('#test-output').textContent='保存功能已恢复';};
          document.querySelector('#test-snapshot').onclick=()=>{
            const s=JSON.parse(localStorage.getItem(key)||'null');
            document.querySelector('#test-output').textContent=JSON.stringify(s&&{version:s.version,revision:s.revision,goal:s.goal,saved:s.saved,notes:s.notes,mistakes:s.mistakes,daily:s.daily,stats:s.stats,
              session:s.session&&{sessionId:s.session.sessionId,index:s.session.index,status:s.session.status,answers:s.session.answers.length,draft:s.session.draft},
              timeZone:s.srs?.timeZone,plans:s.srs?.dailyPlans,
              memories:s.srs&&Object.fromEntries(Object.entries(s.srs.memories).map(([id,m])=>[id,{status:m.status,repetition:m.repetition,nextReviewAt:m.nextReviewAt,lapseCount:m.lapseCount,origin:m.origin,events:m.learningHistory.length}])),
              backup:localStorage.getItem('cijian.ielts.backup.v1')!==null},null,2);
          };
          await import('./src/app.js');
        </script>`);
      res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-cache'}).end(html);return;
    }
    if(req.url==='/src/app.js') {
      const source=(await readFile(new URL('../src/app.js',import.meta.url),'utf8')).replace('await startApplication(dataset, dataWarning);',
        `await startApplication(${fixture==='missing'?"{...dataset,words:dataset.words.slice(0,10)}":"dataset"}, dataWarning, {storage:window.__testStore, clock:()=>Number(localStorage.getItem('test.clock')), timeZone:'Asia/Shanghai'${fixture==='no-locks'?',locks:null':''}});`);
      res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'}).end(source);return;
    }
    base(req,res);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  console.log(`${fixture || '空白用户'}隔离测试：http://127.0.0.1:${server.address().port}`);
  return server;
}
const servers=await Promise.all([start(false),start('v1'),start('mixed'),start('missing'),start('no-locks')]);
process.on('SIGINT',()=>{servers.forEach(s=>s.close());process.exit();});
