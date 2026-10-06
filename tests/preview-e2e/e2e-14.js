const {JSDOM}=require('jsdom');const fs=require('fs');
const dom=new JSDOM(fs.readFileSync(require('path').join(__dirname,'../../prototype/scheduler-grid-preview.html'),'utf8'),{url:'https://x.test/',runScripts:'dangerously',pretendToBeVisual:true,beforeParse(w){w.scrollTo=()=>{}}});
const w=dom.window,d=w.document;
const click=s=>{const e=d.querySelector(s);if(!e)throw new Error('missing '+s);e.click()};
const txt=()=>d.getElementById('view').textContent;
const toast=()=>(d.querySelector('.toast')||{}).textContent;
const setIn=(id,v)=>{const e=d.getElementById(id);e.value=v;e.dispatchEvent(new w.Event('input',{bubbles:true}))};
click('[data-a=role][data-r=teacher]');click('[data-a=tab][data-t=students]');
setIn('ns','Fiona');click('[data-a=addst]');console.log('新增:',toast(),'| 名單含 Fiona:',txt().includes('Fiona'));
setIn('ns','Fiona');click('[data-a=addst]');console.log('重複:',toast());
// 先排課，再隱藏有課的學生
click('[data-a=tab][data-t=plan]');click('[data-a=run]');
const before=txt().match(/已排入 (\d+) 堂/)[1];
click('[data-a=tab][data-t=students]');click('[data-a=hide][data-id=s2]');console.log('第一次按隱藏:',toast());
click('[data-a=hide][data-id=s2]');console.log('第二次:',toast());
console.log('Bella 還在名單:',/Bella/.test(d.querySelector('.card').textContent),'| 隱藏區:',txt().match(/已隱藏的學生（\d+）/)[0]);
click('[data-a=tab][data-t=plan]');console.log('排課堂數',before,'->',txt().match(/已排入 (\d+) 堂/)[1]);
click('[data-a=tab][data-t=students]');click('[data-a=unhide][data-id=s2]');console.log('恢復:',toast());
// 代課老師刪除
click('[data-a=tab][data-t=plan]');d.querySelector('[data-a=sub]').click();
const i=d.getElementById('tn');i.value='Coco';i.dispatchEvent(new w.Event('input',{bubbles:true}));click('[data-a=sok]');
d.querySelectorAll('[data-a=sub]')[1].click();console.log('記住的老師:',[...d.querySelectorAll('[data-a=nm]')].map(e=>e.textContent));
click('[data-a=nmdel]');console.log('刪除後:',[...d.querySelectorAll('[data-a=nm]')].map(e=>e.textContent),'| localStorage:',w.localStorage.getItem('pl_names'),'| 原課仍標示代課:',/代課：Coco/.test(d.getElementById('view').textContent));
