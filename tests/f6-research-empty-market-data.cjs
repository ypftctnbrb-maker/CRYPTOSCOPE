'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('assets/app.js','utf8');
const section=source.slice(source.indexOf('const researchCache='),source.indexOf('let marketTab='));
const sample={id:'sample',name:'Sample',symbol:'s',current_price:2,market_cap:100e6,total_volume:20e6,
  circulating_supply:50e6,total_supply:75e6,max_supply:100e6,fully_diluted_valuation:200e6,last_updated:'2026-11-12T10:00:00Z'};
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
// F6: a valid detail response with an empty market_data object must not erase catalogue values.
test('F6 control: failed detail request keeps catalogue FDV and supply',async()=>{
  const b=browser(async()=>{throw Error('offline');});
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/200000000/);
  assert.match(html,/50,000,000 S/);
});
test('F6: valid detail response with empty market_data keeps catalogue FDV and supply',async()=>{
  const b=browser(async id=>({id,market_data:{}}));
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/200000000/,'catalogue FDV must remain visible');
  assert.match(html,/50,000,000 S/,'catalogue circulating supply must remain visible');
  assert.doesNotMatch(html,/Доступно 0 из/);
  assert.ok(b.el('fundamentalStatus').textContent.includes(b.run('marketAssetNote(coins[0])')));
  assert.match(b.el('fundamentalStatus').textContent,/рыночные данные из каталога/);
});
test('F6: partial detail market data stays authoritative without silently mixing catalogue values',async()=>{
  const b=browser(async id=>({id,market_data:{current_price:{usd:9}},developer_data:{stars:7}}));
  await b.run("inspectPotential('sample')");
  const html=b.el('fundamentalContent').innerHTML;
  assert.match(html,/<strong>\$9<\/strong>/);
  assert.match(html,/<strong>7<\/strong>/);
  assert.doesNotMatch(html,/200000000|50,000,000 S/);
  assert.doesNotMatch(b.el('fundamentalStatus').textContent,/рыночные данные из каталога/);
});
