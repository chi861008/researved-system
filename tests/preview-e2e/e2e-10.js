const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync(require('path').join(__dirname,'../../prototype/scheduler-grid-preview.html'),'utf8'),{url:'https://x.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{};w.confirm=()=>{throw new Error('confirm')}}});
const w=dom.window,d=w.document;
const click=s=>{const e=d.querySelector(s);if(!e)throw new Error('missing '+s);e.click()};
const setSel=(s,v)=>{const e=d.querySelector(s);e.value=v;e.dispatchEvent(new w.Event('change',{bubbles:true}))};
const setIn=v=>{const e=d.getElementById('tn');e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}))};
const notice=()=>(d.querySelector('.toast')||{}).textContent;
click('[data-a=role][data-r=teacher]');click('[data-a=tab][data-t=plan]');
console.log('未排前 自動排課可按:',!d.querySelector('[data-a=run]').disabled);
click('[data-a=run]');console.log('排完 自動排課鈕 disabled:',d.querySelector('[data-a=run]').disabled,'| 鎖定字樣:',d.getElementById('view').textContent.includes('鎖定'));
const first=d.querySelector('[data-a=sub]');const sid=first.closest('.li').textContent.trim().slice(0,30);
// 請人代：未推播前
first.click();setIn('Coco');click('[data-a=sok]');console.log('請人代(推播前):',notice());
console.log('列表顯示代課:',d.getElementById('view').textContent.includes('代課：Coco'));
// 核准 + 推播
click('[data-a=approve]');if(d.querySelector('[data-a=approve]').textContent.includes('確認'))click('[data-a=approve]');
click('[data-a=tab][data-t=notify]');click('[data-a=send]');click('[data-a=tab][data-t=plan]');
// 改時間
d.querySelectorAll('[data-a=chg]')[1].click();
const chips=d.querySelectorAll('[data-a=pk]');console.log('建議時段數:',chips.length);
if(chips.length){chips[0].click();click('[data-a=sok]');console.log('改時間(已推播):',notice())}
// 其他時間 錯誤檢查：Joanna 不上班
d.querySelectorAll('[data-a=chg]')[2].click();setSel('[data-a=cd]','2026-10-10');setSel('[data-a=ct]','600');click('[data-a=sok]');
console.log('錯誤提示:',(d.querySelector('[role=alert]')||{}).textContent);click('[data-a=sx]');
// 記住老師名稱
d.querySelectorAll('[data-a=sub]')[3].click();console.log('記住的名稱晶片:',[...d.querySelectorAll('[data-a=nm]')].map(e=>e.textContent));
click('[data-a=sx]');
click('[data-a=tab][data-t=notify]');console.log('訊息紀錄筆數:',d.querySelectorAll('.sec').length, d.getElementById('view').textContent.includes('代課，時間不變')||d.getElementById('view').textContent.includes('已調整'));
console.log('localStorage:',w.localStorage.getItem('pl_names'));
