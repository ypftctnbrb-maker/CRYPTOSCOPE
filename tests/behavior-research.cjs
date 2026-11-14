'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/app.js','utf8');
const section=source.slice(source.indexOf('const researchCache='),source.indexOf('let marketTab='));
const sample={id:'sample',name:'Sample',symbol:'s',current_price:2,market_cap:100e6,total_volume:20e6,
  circulating_supply:50e6,total_supply:75e6,max_supply:100e6,last_updated:'2026-11-12T10:00:00Z'};
function browser(fetcher=async id=>({id,market_data:{},developer_data:{},links:{}})) {
  const elements=new Map(),requests=[];
  let now=Date.parse('2026-11-13T07:00:00Z');
  const el=id=>{
    if(!elements.has(id))elements.set(id,{textContent:'',innerHTML:'',hidden:true,disabled:false,
      scrollIntoView(){},setAttribute(){},addEventListener(){}});
    return elements.get(id);
  };
  class Clock extends Date {
    constructor(...args){super(...(args.length?args:[now]));}
    static now(){return now;}
  }
  const context={Date:Clock,URL,Intl,console,coins:[{...sample},{...sample,id:'other',name:'Other'}],
    $:el,csText:s=>s,coinGeckoRetryAt:0,
    marketReceivedAt:new Map([['sample',now],['other',now]]),lastMarketSuccess:now,marketRefreshFailed:false,fmt:(n,d=2)=>new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n),
    compact:n=>'$'+n,usd:n=>'$'+n,
    escapeHtml:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
    getJson:async url=>{requests.push(url);return fetcher(decodeURIComponent(url.split('/coins/')[1].split('?')[0]));}};
  vm.createContext(context);
  vm.runInContext(section,context);
  vm.runInContext(source.slice(source.indexOf('function marketAssetNote('),source.indexOf('function marketCoverageNote(')),context);
  return {el,requests,run:code=>vm.runInContext(code,context),set:(key,value)=>{context[key]=value;},advance:ms=>{now+=ms;}};
}
test('missing and malformed research values never become zero',()=>{
  const b=browser();
  for(const value of [null,undefined,'',' ',false,[],{},'12',NaN,Infinity,-1]) {
    b.set('input',value);
    assert.equal(b.run('researchNumber(input)'),'Нет данных');
  }
  assert.equal(b.run('researchNumber(0)'),'0');
});
test('simultaneous research clicks share one request',async()=>{
  let release;
  const b=browser(id=>new Promise(resolve=>{release=()=>resolve({id,market_data:{},links:{}});}));
  const first=b.run("inspectPotential('sample')");
  const second=b.run("inspectPotential('sample')");
  assert.equal(b.requests.length,1);
  release();
  await Promise.all([first,second]);
});

test('market and supply are visible when project API fails; source age is preserved',async()=>{
  const b=browser(async()=>{throw Error('offline');});
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML,status=b.el('fundamentalStatus').textContent;
  assert.match(html,/100000000/);
  assert.match(html,/50,000,000 S/);
  assert.match(html,/устарело/);
  assert.match(html,/Коммиты за 4 недели<\/small><strong>Нет данных/);
  assert.match(status,/Подробности не обновлены/);
  assert.doesNotMatch(status,/проверено/);
  assert.equal(b.el('researchRefresh').disabled,false);
});

test('response supplies units, source time, FDV and circulating share without inferring unlocks',async()=>{
  const b=browser(async id=>({id,last_updated:'2026-11-13T06:59:00Z',market_data:{
    current_price:{usd:2},market_cap:{usd:100e6},total_volume:{usd:20e6},fully_diluted_valuation:{usd:200e6},
    circulating_supply:50e6,total_supply:75e6,max_supply:100e6},developer_data:{commit_count_4_weeks:0}}));
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/50%/);
  assert.match(html,/2×/);
  assert.match(html,/20%/);
  assert.match(html,/Коммиты за 4 недели<\/small><strong>0/);
  assert.match(html,/разлоки и накопление держателей не подтверждены/);
  assert.match(html,/время метрики не предоставлено/);
  assert.doesNotMatch(html,/данные старше 10 мин/);
});

test('inconsistent supply and zero denominators do not produce misleading ratios',async()=>{
  const b=browser(async id=>({id,market_data:{market_cap:{usd:0},fully_diluted_valuation:{usd:200},
    circulating_supply:200,max_supply:100}}));
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/Доля в обращении от максимума<\/small><strong>Нет данных/);
  assert.match(html,/FDV \/ капитализация<\/small><strong>Нет данных/);
  assert.doesNotMatch(html,/Infinity|NaN/);
});

test('cache lasts five minutes; failed explicit refresh preserves last good details and receipt time',async()=>{
  let fail=false;
  const b=browser(async id=>{
    if(fail)throw Error('offline');
    return {id,last_updated:'2026-11-13T06:59:00Z',market_data:{max_supply:777},developer_data:{stars:99}};
  });
  await b.run("inspectPotential('sample')");
  const time=b.run("researchCache.get('sample').time");
  b.advance(60000);
  await b.run("inspectPotential('sample')");
  assert.equal(b.requests.length,1);
  fail=true;
  await b.run("inspectPotential('sample',true)");
  assert.equal(b.requests.length,2);
  assert.equal(b.run("researchCache.get('sample').time"),time);
  assert.match(b.el('fundamentalContent').innerHTML,/777 S/);
  assert.match(b.el('fundamentalStatus').textContent,/Подробности не обновлены/);
  b.advance(300000);
  fail=false;
  await b.run("inspectPotential('sample')");
  assert.equal(b.requests.length,3);
});

test('rapid switching cannot replace the selected coin with a delayed response',async()=>{
  let release;
  const b=browser(id=>new Promise(resolve=>{release=()=>resolve({id,market_data:{max_supply:999},links:{}});}));
  const pending=b.run("inspectPotential('sample')");
  await b.run("inspectPotential('other')");
  assert.equal(b.requests.length,1,'Switching to a new coin must respect the request gap');
  release();
  await pending;
  assert.match(b.el('fundamentalContent').innerHTML,/<h4>Other/);
  assert.doesNotMatch(b.el('fundamentalContent').innerHTML,/999 S/);
  assert.equal(b.el('researchRefresh').disabled,false);
});

test('CoinGecko cooldown and click spam do not issue new requests',async()=>{
  const b=browser();
  b.run('coinGeckoRetryAt=Date.now()+900000');
  for(let i=0;i<5;i++)await b.run("inspectPotential('sample',true)");
  assert.equal(b.requests.length,0);
  assert.match(b.el('fundamentalStatus').textContent,/повтор после/);
  assert.match(b.el('fundamentalContent').innerHTML,/50,000,000 S/);
});

test('wrong asset identity is rejected without caching or leaking its data',async()=>{
  const b=browser(async()=>({id:'impostor',market_data:{max_supply:777}}));
  await b.run("inspectPotential('sample')");
  assert.equal(b.run('researchCache.size'),0);
  assert.doesNotMatch(b.el('fundamentalContent').innerHTML,/777 S/);
  assert.match(b.el('fundamentalStatus').textContent,/Подробности не обновлены/);
});

test('external content is escaped and repository links require the actual GitHub host',async()=>{
  const b=browser(async id=>({id,market_data:{},links:{homepage:['javascript:alert(1)'],repos_url:{github:[
    'https://github.com.evil.test/a/b','https://evil.test/a/b','https://github.com/owner/repo',
    'https://user:password@github.com/a/b','javascript:alert(1)','https://github.com/owner/repo']}}}));
  b.run("coins[0].name='<img src=x onerror=alert(1)>'");
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/&lt;img/);
  assert.doesNotMatch(html,/<img|javascript:|evil.test|password/);
  assert.equal(html.split('href="https://github.com/owner/repo"').length,2);
});

test('unknown or future source timestamps are never labelled fresh',()=>{
  const b=browser();
  assert.equal(b.run("researchTime('2099-01-01T00:00:00Z')"),'время источника неизвестно');
  assert.equal(b.run("researchTime('garbage')"),'время источника неизвестно');
  assert.equal(b.run('researchTime(null)'),'время источника неизвестно');
});

test('older market timestamp wins over newer overall coin metadata',async()=>{
  const b=browser(async id=>({id,last_updated:'2026-11-13T06:59:00Z',
    market_data:{last_updated:'2026-11-12T10:00:00Z',market_cap:{usd:100}}}));
  await b.run("inspectPotential('sample')");
  assert.match(b.el('fundamentalStatus').textContent,/данные старше 10 мин/);
  assert.match(b.el('fundamentalContent').innerHTML,/данные старше 10 мин/);
});
