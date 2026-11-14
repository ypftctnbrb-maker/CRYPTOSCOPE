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
// F1: card built from a catalogue record captured before an in-flight request must not outlive a catalogue refresh.
const fresh="coins[0]={id:'sample',name:'Sample',symbol:'s',current_price:3,market_cap:150e6,total_volume:30e6,"+
  "circulating_supply:60e6,total_supply:75e6,max_supply:100e6,fully_diluted_valuation:200e6,"+
  "last_updated:new Date(Date.now()-500).toISOString()};marketReceivedAt.set('sample',Date.now());lastMarketSuccess=Date.now();";
test('F1 control: without a catalogue refresh the fallback card matches the catalogue provenance',async()=>{
  const b=browser(async()=>{throw Error('offline');});
  await b.run("inspectPotential('sample')");
  assert.ok(b.el('fundamentalStatus').textContent.includes(b.run('marketAssetNote(coins[0])')));
  assert.match(b.el('fundamentalContent').innerHTML,/100000000/);
});
test('F1: failed request after a catalogue refresh shows the current record and its own provenance',async()=>{
  let reject;
  const b=browser(()=>new Promise((_,r)=>{reject=r;}));
  const pending=b.run("inspectPotential('sample')");
  b.advance(1000);
  b.run(fresh);
  reject(Error('offline'));
  await pending;
  const html=b.el('fundamentalContent').innerHTML,status=b.el('fundamentalStatus').textContent;
  assert.match(html,/150000000/,'current capitalisation must be shown');
  assert.doesNotMatch(html,/100000000/,'stale capitalisation must not be shown');
  assert.ok(status.includes(b.run('marketAssetNote(coins[0])')),'status must describe the record that is shown');
});
