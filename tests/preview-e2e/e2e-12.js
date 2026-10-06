const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync(require('path').join(__dirname,'../../prototype/scheduler-grid-preview.html'),'utf8'),{url:'https://x.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{}}});
const w=dom.window,d=w.document;
const click=s=>{const e=d.querySelector(s);if(!e)throw new Error('missing '+s);e.click()};
const txt=()=>d.getElementById('view').textContent;
const ev=(t,e)=>e.dispatchEvent(new w.Event(t,{bubbles:true,cancelable:true}));
const tap=s=>{const e=d.querySelector(s);if(!e)throw new Error('missing '+s);ev('pointerdown',e);ev('pointerup',e)};
// 學生 Oct：選每週五 19:00
console.log('學生標題:',d.querySelector('h1').textContent,'| 截止:',txt().match(/於 (\S+) 前/)[1]);
tap('[data-p=s][data-k="2026-10-09|1140"]');
// 老師：提醒、排課、核准、推播
click('[data-a=role][data-r=teacher]');click('[data-a=tab][data-t=plan]');
click('[data-a=tab][data-t=students]');
console.log('進度卡:',/填寫狀況/.test(txt()),'未填提醒鈕:',d.querySelector('[data-a=remind]').textContent.trim());
click('[data-a=tab][data-t=plan]');
console.log('下月按鈕 disabled (排課前):',d.querySelector('[data-a=openNext]').disabled);
click('[data-a=run]');click('[data-a=approve]');click('[data-a=tab][data-t=notify]');click('[data-a=send]');
const octLessons=(txt().match(/10\/\d+（/g)||[]).length;
console.log('Oct 推播完成，狀態:',d.querySelector('.pillt').textContent);
// 學生：現在沒有開放
click('[data-a=role][data-r=student]');console.log('學生(無開放):',d.querySelector('h1').textContent,'| 有我的課表:',/我的課表/.test(txt()),'| 底部送出列:',!!d.querySelector('[data-a=submit]'));
// 老師：開始 11 月
click('[data-a=role][data-r=teacher]');click('[data-a=openNext]');
console.log('老師月份:',d.querySelector('.wnav b').textContent.replace(/\s+/g,' '),'| 提示:',d.querySelector('.toast').textContent);
console.log('11月上班訊息:',d.getElementById('hm').value.split('\n').slice(0,3).join(' | '));
// 學生：Nov
click('[data-a=role][data-r=student]');console.log('學生標題:',d.querySelector('h1').textContent);
console.log('沿用鈕:',(d.querySelector('[data-a=carry]')||{}).textContent);
click('[data-a=carry]');console.log(d.querySelector('.toast').textContent,'| 已選:',d.querySelector('[data-a=submit]').textContent.trim());
// 老師：排 11 月
click('[data-a=role][data-r=teacher]');click('[data-a=tab][data-t=plan]');click('[data-a=run]');
const t=txt();console.log('11月排課:',t.match(/已排入 \d+ 堂，待補其他老師 \d+ 位次/)[0]);
console.log('11/1 有課嗎(Emma 10/31 已排過同一週):',/11\/1（日）/.test(t));
// 切回十月
click('[data-a=mprev]');console.log('回到:',d.querySelector('.wnav b').textContent.replace(/\s+/g,' '));
