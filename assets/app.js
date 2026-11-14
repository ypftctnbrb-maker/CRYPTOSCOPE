const $=id=>document.getElementById(id);
const VERIFIED_BINANCE_PAIRS=Object.freeze({
  "bitcoin": "BTCUSDT",
  "ethereum": "ETHUSDT",
  "solana": "SOLUSDT",
  "ripple": "XRPUSDT",
  "binancecoin": "BNBUSDT",
  "dogecoin": "DOGEUSDT",
  "cardano": "ADAUSDT",
  "tron": "TRXUSDT",
  "chainlink": "LINKUSDT",
  "avalanche-2": "AVAXUSDT",
  "polkadot": "DOTUSDT",
  "litecoin": "LTCUSDT",
  "bitcoin-cash": "BCHUSDT",
  "stellar": "XLMUSDT",
  "uniswap": "UNIUSDT",
  "aave": "AAVEUSDT",
  "monero": "XMRUSDT",
  "zcash": "ZECUSDT",
  "pepe": "PEPEUSDT",
  "near": "NEARUSDT",
  "aptos": "APTUSDT",
  "arbitrum": "ARBUSDT",
  "optimism": "OPUSDT",
  "sui": "SUIUSDT",
  "ethena": "ENAUSDT",
  "render-token": "RENDERUSDT"
});
const verifiedPair=c=>c&&VERIFIED_BINANCE_PAIRS[c.id]||null;
const livePrices=new Map(),liveTimes=new Map();
const livePairs=new Set(Object.values(VERIFIED_BINANCE_PAIRS));
let liveSocket=null,liveRetry=1000,liveTimer=null,liveRenderTimer=null,liveLastMessage=0,liveStartedAt=0;
const livePriceFor=c=>{
  const pair=verifiedPair(c);
  return pair&&Date.now()-liveLastMessage<15000&&Date.now()-(liveTimes.get(pair)||0)<15000?livePrices.get(pair):undefined;
};
const displayPrice=c=>{
  const v=livePriceFor(c);
  return Number.isFinite(v)?v:c.current_price;
};
function updateLiveStatus(message,ok) {
  const el=$('liveStatus');
  if(el) {
    el.textContent=message;
    el.classList.toggle('connected',!!ok);
  }
}
function clearLiveQuotes() {
  livePrices.clear();
  liveTimes.clear();
  liveLastMessage=0;
  clearTimeout(liveRenderTimer);
  liveRenderTimer=null;
  refreshLiveValues();
}
function retryLive(socket,message) {
  if(socket&&liveSocket!==socket)return;
  liveSocket=null;
  clearTimeout(liveTimer);
  liveTimer=null;
  clearLiveQuotes();
  updateLiveStatus(message,false);
  if(socket) {
    try { socket.close(); } catch(e) { /* A failed transport is already detached. */ }
  }
  if(document.hidden)return;
  liveTimer=setTimeout(connectLive,liveRetry);
  liveRetry=Math.min(liveRetry*2,30000);
}
function pauseLive() {
  const socket=liveSocket;
  liveSocket=null;
  clearTimeout(liveTimer);
  liveTimer=null;
  clearLiveQuotes();
  if(socket) {
    try { socket.close(); } catch(e) { /* No transport work while hidden. */ }
  }
  updateLiveStatus(csText('LIVE приостановлен'),false);
}
function connectLive() {
  if(document.hidden)return;
  if(liveSocket&&(liveSocket.readyState===0||liveSocket.readyState===1))return;
  clearTimeout(liveTimer);
  liveTimer=null;
  liveStartedAt=Date.now();
  clearLiveQuotes();
  try {
    const socket=new WebSocket('wss://stream.binance.com:9443/ws/!miniTicker@arr');
    liveSocket=socket;
    updateLiveStatus('LIVE: подключение…',false);
    socket.onopen=()=>{
      if(liveSocket!==socket)return;
      updateLiveStatus('LIVE Binance · ожидание котировок',false);
    };
    socket.onmessage=e=>{
      if(liveSocket!==socket)return;
      let ticks;
      try { ticks=JSON.parse(e.data); } catch(err) { return; }
      if(!Array.isArray(ticks))return;
      let changed=false;
      const receivedAt=Date.now();
      for(const t of ticks) {
        if(!t||!livePairs.has(t.s))continue;
        const p=Number(t.c);
        if(!Number.isFinite(p)||p<=0)continue;
        livePrices.set(t.s,p);
        liveTimes.set(t.s,receivedAt);
        changed=true;
      }
      if(!changed)return;
      liveLastMessage=receivedAt;
      liveRetry=1000;
      updateLiveStatus('LIVE Binance · '+new Date(liveLastMessage).toLocaleTimeString(),true);
      if(!liveRenderTimer)liveRenderTimer=setTimeout(()=>{
        liveRenderTimer=null;
        refreshLiveValues();
      },500);
    };
    socket.onerror=()=>retryLive(socket,'LIVE недоступен · CoinGecko');
    socket.onclose=()=>retryLive(socket,'LIVE отключён · CoinGecko');
  } catch(e) {
    retryLive(null,'LIVE недоступен · CoinGecko');
  }
}
function checkLiveHealth() {
  if(document.hidden)return;
  if(liveSocket&&Date.now()-(liveLastMessage||liveStartedAt)>=15000) {
    retryLive(liveSocket,csText('LIVE: котировки устарели · CoinGecko'));
  }
  refreshLiveValues();
}
function livePriceTitle(c) {
  if(Number.isFinite(livePriceFor(c))) {
    return 'Binance Spot · '+verifiedPair(c)+' · '+new Date(liveTimes.get(verifiedPair(c))).toLocaleTimeString();
  }
  return 'CoinGecko · '+marketAssetNote(c);
}
function refreshLiveValues() {
  const btc=coins.find(c=>c.id==='bitcoin');
  if(btc) {
    $('btc').textContent=usd(displayPrice(btc));
    $('btc').title=livePriceTitle(btc);
  }
  for(const id of ['major','small']) {
    const body=$(id);
    if(!body)continue;
    body.querySelectorAll('tr[data-id]').forEach(tr=>{
      const c=coins.find(x=>x.id===tr.dataset.id);
      if(!c)return;
      const price=livePriceFor(c);
      const cell=tr.cells[1];
      if(cell) {
        cell.textContent=usd(displayPrice(c));
        cell.title=livePriceTitle(c);
        cell.classList.toggle('live-price',Number.isFinite(price));
      }
    });
  }
  if(selectedCoinId) {
    const c=coins.find(x=>x.id===selectedCoinId);
    if(c) {
      $('dPrice').textContent=usd(displayPrice(c));
      $('dPrice').title=livePriceTitle(c);
    }
  }
}
const fmt=(n,d=2)=>Number.isFinite(n)?new Intl.NumberFormat('en-US',{maximumFractionDigits:d}).format(n):'—';
const usd=n=>Number.isFinite(n)?'$'+fmt(n,n<1?6:2):'—';
const compact=n=>Number.isFinite(n)?'$'+new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:2}).format(n):'—';
let coins=[];

const dict={ru:{title:'Рынок в реальном времени',subtitle:'Цены, объёмы, потоки сделок и деривативы',chart:'График',markets:'Рынок',prospects:'Перспективные',btcCap:'Капитализация BTC',btcVolume:'Объём BTC за 24 ч',candle:'BTC / USDT · TradingView',marketTitle:'Крупные монеты · от $200 млн',prospectTitle:'Монеты с потенциалом роста',prospectSub:'Кандидаты для изучения. Рыночный интерес не подтверждает активность команды и качество токеномики.',refresh:'Обновить',coin:'Монета',price:'Цена',cap:'Капитализация',volume:'Объём 24 ч',fVolume:'Объём / капитализация от 10%',fWhales:'Накопление крупных держателей · скоро',fUnlock:'Эмиссия и разлоки · скоро',fOi:'Открытый интерес · скоро',fDev:'Активность разработчиков · скоро',fLiquidity:'Объём торгов от $1 млн / 24 ч',coverage:'Охват ограничен загруженными страницами API. Отсутствие монеты не означает, что она не соответствует критериям.',risk:'Не инвестиционная рекомендация. Данные сторонних сервисов могут задерживаться или быть недоступны.'}};
function csText(value){return value}
function translate(){document.documentElement.lang='ru';document.documentElement.dir='ltr';document.querySelectorAll('[data-i]').forEach(el=>{const value=dict.ru[el.dataset.i];if(value)el.textContent=value});render()}
function row(c) {
  const p=c.price_change_percentage_24h;
  const safe=(c.symbol||'').replace(/[^a-z0-9]/gi,'').toUpperCase();
  const img=/^https:\/\//.test(c.image||'')?'<img loading="lazy" alt="" src="'+c.image.replace(/"/g,'')+'">':'';
  return '<tr data-id="'+escapeHtml(c.id)+'"><td><div class="coin">'+img+'<div>'+escapeHtml(c.name)+
    ' <small>'+safe+'</small><small class="market-age">'+escapeHtml(marketAssetNote(c))+'</small></div></div></td><td>'+usd(displayPrice(c))+
    '</td><td class="'+(p>=0?'positive':'negative')+'">'+(Number.isFinite(p)?(p>0?'+':'')+fmt(p)+'%':'—')+
    '</td><td>'+compact(c.market_cap)+'</td><td>'+compact(c.total_volume)+'</td></tr>';
}
function escapeHtml(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
let coinRequest=0;let selectedCoinId='';let detailRequest=0;let lastCoinId='';let lastSpotSymbol='';function drawCvd(values){const canvas=$('cvdCanvas'),w=Math.max(280,canvas.clientWidth),h=220,dpr=Math.min(window.devicePixelRatio||1,2);canvas.width=w*dpr;canvas.height=h*dpr;const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,w,h);ctx.strokeStyle='#33445e';ctx.lineWidth=1;for(let i=0;i<5;i++){const y=12+i*(h-24)/4;ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(w,y);ctx.stroke()}if(!values.length)return;let lo=Math.min(0,...values),hi=Math.max(0,...values);if(hi===lo){hi+=1;lo-=1}const y=v=>h-12-(v-lo)/(hi-lo)*(h-24);ctx.strokeStyle='#56b9ff';ctx.lineWidth=2.5;ctx.beginPath();values.forEach((v,i)=>{const x=i/(values.length-1||1)*(w-1);if(!i)ctx.moveTo(x,y(v));else ctx.lineTo(x,y(v))});ctx.stroke();ctx.fillStyle='#94a6bf';ctx.font='12px system-ui';ctx.fillText('CVD: '+fmt(values[values.length-1],4),10,19)}async function loadTrades(symbol,id){const seq=++coinRequest;$('buyVolume').textContent='—';$('sellVolume').textContent='—';$('dCvd').textContent='—';$('flowStatus').textContent=csText('Загрузка исторических агрегированных сделок Binance Spot…');drawCvd([]);try{const endpoint='https://api.binance.com/api/v3/aggTrades?symbol='+encodeURIComponent(symbol);const latest=await getJson(endpoint+'&limit=1');if(!Array.isArray(latest)||!latest.length)throw Error('No trades');const lastId=Number(latest[0].a);if(!Number.isSafeInteger(lastId))throw Error('Invalid trade id');const windowSize=Number($('cvdWindow').value)||4000;const firstId=Math.max(0,lastId-windowSize+1);const batches=[];for(let from=firstId;from<=lastId;from+=1000){const count=Math.min(1000,lastId-from+1);batches.push(getJson(endpoint+'&fromId='+from+'&limit='+count))}const results=await Promise.all(batches);if(seq!==coinRequest)return;const trades=results.flat().filter(t=>Number.isFinite(Number(t.a))&&Number(t.a)<=lastId).sort((a,b)=>Number(a.a)-Number(b.a));if(!trades.length)throw Error('No historical trades');let buy=0,sell=0,delta=0;const points=[];for(const t of trades){const q=Number(t.q);if(!Number.isFinite(q)||q<0)continue;if(t.m){sell+=q;delta-=q}else{buy+=q;delta+=q}points.push(delta)}if(!points.length)throw Error('No valid quantities');$('buyVolume').textContent=fmt(buy,4)+' '+symbol.replace(/USDT$/,'');$('sellVolume').textContent=fmt(sell,4)+' '+symbol.replace(/USDT$/,'');$('dCvd').textContent=(delta>=0?'+':'')+fmt(delta,4)+' '+symbol.replace(/USDT$/,'');const first=new Date(Number(trades[0].T)).toLocaleString(),last=new Date(Number(trades[trades.length-1].T)).toLocaleString();$('flowStatus').textContent='Binance Spot · '+symbol+' · '+points.length+csText(' агрегированных сделок · ')+first+' → '+last;drawCvd(points)}catch(e){if(seq!==coinRequest)return;$('flowStatus').textContent=csText('История сделок недоступна для ')+symbol+csText('. Возможно ограничение API, региона или отсутствие пары.');drawCvd([])}}let chartInstance=null,chartResize=null,chartSeq=0,activeTf='1h',chartSymbol='';async function loadCandles(symbol){const seq=++chartSeq;chartSymbol=symbol;$('chartStatus').textContent=csText('Загрузка Binance Spot · ')+symbol+' · '+activeTf;$('nativeChart').hidden=false;$('detailChart').hidden=true;try{if(!window.LightweightCharts)throw Error('Chart library unavailable');const rows=await getJson('https://api.binance.com/api/v3/klines?symbol='+encodeURIComponent(symbol)+'&interval='+encodeURIComponent(activeTf)+'&limit=350');if(seq!==chartSeq)return;if(!Array.isArray(rows)||!rows.length)throw Error('Candles unavailable');const candles=rows.map(r=>({time:Math.floor(Number(r[0])/1000),open:Number(r[1]),high:Number(r[2]),low:Number(r[3]),close:Number(r[4])}));const volumes=rows.map(r=>({time:Math.floor(Number(r[0])/1000),value:Number(r[5]),color:Number(r[4])>=Number(r[1])?'rgba(54,213,160,.35)':'rgba(255,101,126,.35)'}));if(candles.some(x=>![x.time,x.open,x.high,x.low,x.close].every(Number.isFinite)))throw Error('Invalid candle data');if(chartResize){chartResize.disconnect();chartResize=null}if(chartInstance){chartInstance.remove();chartInstance=null}const host=$('nativeChart');chartInstance=LightweightCharts.createChart(host,{width:host.clientWidth,height:host.clientHeight,layout:{background:{type:'solid',color:'#0b1423'},textColor:'#a3b4c9'},grid:{vertLines:{color:'#1c2b3d'},horzLines:{color:'#1c2b3d'}},rightPriceScale:{borderColor:'#33445e'},timeScale:{borderColor:'#33445e',timeVisible:true,secondsVisible:false},crosshair:{mode:LightweightCharts.CrosshairMode.Normal}});const series=chartInstance.addCandlestickSeries({upColor:'#36d5a0',downColor:'#ff657e',borderVisible:false,wickUpColor:'#36d5a0',wickDownColor:'#ff657e'});series.setData(candles);const volume=chartInstance.addHistogramSeries({priceFormat:{type:'volume'},priceScaleId:'volume',lastValueVisible:false,priceLineVisible:false});chartInstance.priceScale('volume').applyOptions({scaleMargins:{top:.82,bottom:0}});volume.setData(volumes);chartInstance.timeScale().fitContent();chartResize=new ResizeObserver(()=>{if(chartInstance)chartInstance.applyOptions({width:host.clientWidth,height:host.clientHeight})});chartResize.observe(host);$('chartStatus').textContent='Binance Spot · '+symbol+' · '+activeTf+' · '+candles.length+csText(' свечей · ')+new Date().toLocaleTimeString()}catch(e){if(seq!==chartSeq)return;if(chartResize){chartResize.disconnect();chartResize=null}if(chartInstance){chartInstance.remove();chartInstance=null}$('nativeChart').hidden=true;$('detailChart').hidden=false;$('detailChart').src='https://s.tradingview.com/widgetembed/?frameElementId=detailChart&symbol='+encodeURIComponent('BINANCE:'+symbol)+'&interval='+({'5m':'5','15m':'15','1h':'60','4h':'240','1d':'D','1w':'W'}[activeTf]||'60')+'&hidesidetoolbar=0&symboledit=1&theme=dark&style=1&timezone=Etc%2FUTC';$('chartStatus').textContent=csText('Binance Spot: история свечей недоступна. Резервный график TradingView (проверяйте наличие пары).')}}
$('timeframes').addEventListener('click',e=>{const b=e.target.closest('button[data-tf]');if(!b)return;activeTf=b.dataset.tf;document.querySelectorAll('#timeframes button').forEach(x=>x.classList.toggle('active',x===b));if(chartSymbol)loadCandles(chartSymbol)});
async function openCoin(id, force=false) {
  const c=coins.find(x=>x.id===id);
  if(!c||(!force&&selectedCoinId===id&&!$('coinDetail').hidden))return;
  const changingCoin=selectedCoinId!==id;
  selectedCoinId=id;
  const detailSeq=++detailRequest;
  const box=$('coinDetail');
  box.hidden=false;
  $('detailName').textContent=c.name+' ('+c.symbol.toUpperCase()+')';
  $('dPrice').textContent=usd(displayPrice(c));
  $('dCap').textContent=compact(c.market_cap);
  $('dVolume').textContent=compact(c.total_volume);
  $('dChange').textContent=Number.isFinite(c.price_change_percentage_24h)?fmt(c.price_change_percentage_24h)+'%':'—';
  ['dOi','dFunding','dCvd','dLiq'].forEach(k=>$(k).textContent='—');
  $('detailStatus').textContent='Checking available market instruments…';
  const symbol=verifiedPair(c);
  if(!symbol) {
    chartSymbol='';
    lastSpotSymbol='';
    chartSeq++;
    coinRequest++;
    $('nativeChart').hidden=true;
    $('detailChart').hidden=true;
    $('chartStatus').textContent=csText('Биржевая пара не подтверждена: график отключён во избежание подмены актива');
    $('flowStatus').textContent=csText('Spot CVD недоступен: биржевая пара не подтверждена');
    $('detailStatus').textContent=csText('CoinGecko · биржевые данные отключены для неподтверждённой пары');
    return;
  }
  if(changingCoin||lastSpotSymbol!==symbol) {
    lastSpotSymbol=symbol;
    loadCandles(symbol);
    loadTrades(symbol,id);
  }
  try {
    const [oi,funding]=await Promise.allSettled([
      getJson('https://fapi.binance.com/fapi/v1/openInterest?symbol='+encodeURIComponent(symbol)),
      getJson('https://fapi.binance.com/fapi/v1/premiumIndex?symbol='+encodeURIComponent(symbol))
    ]);
    if(detailSeq!==detailRequest)return;
    if(oi.status==='fulfilled'&&Number.isFinite(Number(oi.value.openInterest))) {
      $('dOi').textContent=fmt(Number(oi.value.openInterest),0)+' '+c.symbol.toUpperCase();
    }
    if(funding.status==='fulfilled'&&Number.isFinite(Number(funding.value.lastFundingRate))) {
      $('dFunding').textContent=fmt(Number(funding.value.lastFundingRate)*100,4)+'%';
    }
    $('detailStatus').textContent='CoinGecko market data · Binance Futures derivatives where available. Chart symbol may be unavailable.';
  } catch(e) {
    if(detailSeq===detailRequest)$('detailStatus').textContent='Market data loaded; derivative metrics unavailable.';
  }
}
const researchCache=new Map(),researchPending=new Map();
const RESEARCH_TTL=300000,RESEARCH_REQUEST_GAP=30000;
let researchSeq=0,researchCoinId='',researchRetryAt=0;
const researchValue=n=>typeof n==='number'&&Number.isFinite(n)&&n>=0?n:null;
const researchNumber=n=>researchValue(n)===null?'Нет данных':fmt(n,0);
const safeExternal=u=>{
  if(typeof u!=='string')return '';
  try {
    const x=new URL(u);
    return x.protocol==='https:'&&!x.username&&!x.password?x.href:'';
  } catch(e) { return ''; }
};
function researchTime(value) {
  if(typeof value!=='string')return 'время источника неизвестно';
  const time=Date.parse(value);
  if(!Number.isFinite(time)||time>Date.now()+60000)return 'время источника неизвестно';
  const stale=Date.now()-time>600000?' · данные старше 10 мин':'';
  return 'данные от '+new Date(time).toLocaleString('ru-RU')+stale;
}
function researchMarket(c) {
  return {current_price:{usd:c.current_price},market_cap:{usd:c.market_cap},total_volume:{usd:c.total_volume},
    fully_diluted_valuation:{usd:c.fully_diluted_valuation},circulating_supply:c.circulating_supply,
    total_supply:c.total_supply,max_supply:c.max_supply};
}
function renderResearch(c,entry,notice='') {
  c=coins.find(x=>x.id===c.id)||c;
  const d=entry?.data,hasMarket=!!d&&Object.keys(d.market_data||{}).length>0;
  const m=hasMarket?d.market_data:researchMarket(c),dev=d?.developer_data||{},links=d?.links||{};
  const received=entry?new Date(entry.time).toLocaleString('ru-RU'):'ещё не получена';
  const sourceTime=hasMarket?m.last_updated||d.last_updated:c.last_updated;
  const marketNote=hasMarket?researchTime(sourceTime):marketAssetNote(c);
  const marketSource='CoinGecko · '+marketNote;
  const devSource='CoinGecko · время метрики не предоставлено'+(entry?' · получено '+received:'');
  const sourceUrl='https://www.coingecko.com/en/coins/'+encodeURIComponent(c.id);
  const apiUrl='https://api.coingecko.com/api/v3/coins/'+encodeURIComponent(c.id);
  const money=n=>researchValue(n)===null?'Нет данных':compact(n);
  const token=n=>researchValue(n)===null?'Нет данных':fmt(n,4)+' '+String(c.symbol||'').toUpperCase();
  const cap=researchValue(m.market_cap?.usd),fdv=researchValue(m.fully_diluted_valuation?.usd);
  const volume=researchValue(m.total_volume?.usd),circulating=researchValue(m.circulating_supply),max=researchValue(m.max_supply);
  const ratio=(a,b,suffix,scale=1)=>a!==null&&b!==null&&b>0?fmt(a/b*scale,2)+suffix:'Нет данных';
  const share=circulating!==null&&max!==null&&max>0&&circulating<=max?fmt(circulating/max*100,2)+'%':'Нет данных';
  const github=[...new Set((Array.isArray(links.repos_url?.github)?links.repos_url.github:[]).map(safeExternal).filter(u=>{
    if(!u)return false;
    const x=new URL(u);
    return x.hostname==='github.com'&&/^\/[^/]+\/[^/]+\/?$/.test(x.pathname)&&!x.search&&!x.hash;
  }))].slice(0,10);
  const home=(Array.isArray(links.homepage)?links.homepage:[]).map(safeExternal).find(Boolean);
  const market=[
    ['Цена',researchValue(m.current_price?.usd)===null?'Нет данных':usd(m.current_price.usd),marketSource],
    ['Капитализация',money(cap),marketSource],
    ['Объём торгов за 24 ч',money(volume),marketSource],
    ['Объём / капитализация',ratio(volume,cap,'%',100),marketSource+' · оборот, не глубина ликвидности'],
    ['Полная оценка (FDV)',money(fdv),marketSource],
    ['FDV / капитализация',ratio(fdv,cap,'×'),marketSource+' · не календарь разлоков'],
    ['В обращении',token(circulating),marketSource],
    ['Общее предложение',token(m.total_supply),marketSource],
    ['Максимальное предложение',token(max),marketSource+' · отсутствие лимита в ответе не означает бесконечную эмиссию'],
    ['Доля в обращении от максимума',share,marketSource+' · не график будущей эмиссии'],
  ];
  const development=[
    ['Коммиты за 4 недели',researchNumber(dev.commit_count_4_weeks),devSource],
    ['Участники pull request',researchNumber(dev.pull_request_contributors),devSource+' · не размер команды'],
    ['Звёзды GitHub',researchNumber(dev.stars),devSource+' · не показатель качества'],
    ['Подписчики Telegram',researchNumber(d?.community_data?.telegram_channel_user_count),devSource],
  ];
  const group=(title,items)=>'<h5>'+title+'</h5><div class="fundamental-grid">'+items.map(([label,value,source])=>
    '<div class="metric"><small>'+escapeHtml(label)+'</small><strong>'+escapeHtml(value)+'</strong>'+
    '<span class="flowlegend">'+escapeHtml(source)+'</span></div>').join('')+'</div>';
  const external=(url,label)=>'<a target="_blank" rel="noopener noreferrer" href="'+escapeHtml(url)+'">'+escapeHtml(label)+'</a>';
  const available=[...market,...development].filter(([,value])=>value!=='Нет данных').length;
  const references=[external(sourceUrl,'CoinGecko'),external(apiUrl,'Ответ API')];
  if(home)references.push(external(home,'Сайт проекта (ссылка CoinGecko)'));
  github.forEach(u=>references.push(external(u,'GitHub: '+new URL(u).pathname.slice(1))));
  $('fundamentalContent').innerHTML='<h4>'+escapeHtml(c.name)+' ('+escapeHtml(String(c.symbol||'').toUpperCase())+')</h4>'+
    '<p class="research-coverage">Доступно '+available+' из '+(market.length+development.length)+' метрик. Карточка неполная.</p>'+
    group('Рынок и предложение',market)+group('Разработка и сообщество',development)+
    '<div class="fundamental-links">'+references.join(' · ')+'</div>'+
    '<p class="note">Состав команды, разлоки и накопление держателей не подтверждены: специализированные источники не подключены. '+
    (github.length?'Репозитории указаны CoinGecko; принадлежность и активность требуют проверки.':'Подтверждённых ссылок на репозитории нет. ')+
    'Рейтинг перспективности не присвоен.</p>';
  $('fundamentalStatus').textContent=(notice?notice+' · ':'')+(entry?'Ответ CoinGecko получен '+received:'Рыночный снимок каталога')+
    (d&&!hasMarket?' · рыночные данные из каталога':'')+' · '+marketNote;
}
async function getResearch(id,force=false) {
  if(researchPending.has(id))return researchPending.get(id);
  const cached=researchCache.get(id);
  if(!force&&cached&&Date.now()-cached.time<RESEARCH_TTL)return cached;
  const retryAt=Math.max(researchRetryAt,coinGeckoRetryAt);
  if(Date.now()<retryAt) {
    const error=new Error('Research cooldown');
    error.retryAt=retryAt;
    throw error;
  }
  researchRetryAt=Date.now()+RESEARCH_REQUEST_GAP;
  const pending=(async()=>{
    const data=await getJson('https://api.coingecko.com/api/v3/coins/'+encodeURIComponent(id)+
      '?localization=false&tickers=false&market_data=true&community_data=true&developer_data=true&sparkline=false');
    if(!data||data.id!==id||!data.market_data||typeof data.market_data!=='object'||Array.isArray(data.market_data)) {
      throw Error('Invalid research response');
    }
    const entry={data,time:Date.now()};
    researchCache.set(id,entry);
    if(researchCache.size>50)researchCache.delete(researchCache.keys().next().value);
    return entry;
  })();
  researchPending.set(id,pending);
  try { return await pending; }
  finally { researchPending.delete(id); }
}
async function inspectPotential(id,force=false) {
  const c=coins.find(x=>x.id===id);
  if(!c)return;
  researchCoinId=id;
  const seq=++researchSeq,panel=$('fundamentalPanel');
  panel.hidden=false;
  panel.scrollIntoView({behavior:'smooth',block:'start'});
  renderResearch(c,researchCache.get(id),'Загрузка подробностей');
  $('researchRefresh').hidden=false;
  $('researchRefresh').disabled=true;
  panel.setAttribute('aria-busy','true');
  try {
    const entry=await getResearch(id,force);
    if(seq===researchSeq)renderResearch(c,entry);
  } catch(e) {
    if(seq!==researchSeq)return;
    const retryAt=Math.max(e.retryAt||0,coinGeckoRetryAt,researchRetryAt);
    const message='Подробности не обновлены'+(Date.now()<retryAt?' · повтор после '+new Date(retryAt).toLocaleTimeString('ru-RU'):
      ' · API недоступен или вернул некорректный ответ');
    renderResearch(c,researchCache.get(id),message);
  } finally {
    if(seq===researchSeq) {
      $('researchRefresh').disabled=false;
      panel.setAttribute('aria-busy','false');
    }
  }
}
$('researchRefresh').addEventListener('click',()=>{if(researchCoinId)inspectPotential(researchCoinId,true);});
let marketTab='leaders',majorShown=5,smallShown=5;let favoriteIds=new Set();try{const stored=JSON.parse(localStorage.getItem('cs-favorites')||'[]');if(Array.isArray(stored))favoriteIds=new Set(stored.filter(x=>typeof x==='string').slice(0,300))}catch(e){}function saveFavorites(){try{localStorage.setItem('cs-favorites',JSON.stringify([...favoriteIds]))}catch(e){}}function rowWithFavorite(c){const r=row(c);return r.replace('</tr>','<td class="favorite-cell"><button class="favorite-toggle'+(favoriteIds.has(c.id)?' is-favorite':'')+'" data-favorite="'+escapeHtml(c.id)+'" aria-label="'+(favoriteIds.has(c.id)?'Убрать из избранного':'Добавить в избранное')+'" aria-pressed="'+favoriteIds.has(c.id)+'">'+(favoriteIds.has(c.id)?'★':'☆')+'</button></td></tr>')}function render() {
  const query=$('search').value.toLowerCase().trim(),sort=$('sort').value;
  const base=coins.filter(c=>(c.name+' '+c.symbol).toLowerCase().includes(query));
  const numeric=(c,k)=>Number.isFinite(Number(c[k]))?Number(c[k]):-Infinity;
  const sorted=base.sort((a,b)=>numeric(b,sort)-numeric(a,sort));
  let major=sorted.filter(c=>c.market_cap>=200e6);
  if(marketTab==='gainers')major=major.filter(c=>Number.isFinite(c.price_change_percentage_24h)&&c.price_change_percentage_24h>0)
    .sort((a,b)=>b.price_change_percentage_24h-a.price_change_percentage_24h);
  if(marketTab==='losers')major=major.filter(c=>Number.isFinite(c.price_change_percentage_24h)&&c.price_change_percentage_24h<0)
    .sort((a,b)=>a.price_change_percentage_24h-b.price_change_percentage_24h);
  if(marketTab==='favorites')major=sorted.filter(c=>favoriteIds.has(c.id));
  const small=sorted.filter(c=>c.market_cap>=20e6&&c.market_cap<200e6&&Number.isFinite(c.total_volume)&&
    c.total_volume>=1e6&&c.market_cap>0&&c.total_volume/c.market_cap>=.1);
  const shownMajor=major.slice(0,majorShown),shownSmall=small.slice(0,smallShown);
  $('major').innerHTML=shownMajor.length?shownMajor.map(rowWithFavorite).join(''):
    '<tr><td colspan="6" class="loading">Нет подходящих монет</td></tr>';
  $('small').innerHTML=shownSmall.length?shownSmall.map(c=>rowWithFavorite(c).replace('</tr>',
    '<td class="research-cell"><button class="research-button" data-research="'+escapeHtml(c.id)+'">Проверить</button></td></tr>')).join(''):
    '<tr><td colspan="7" class="loading">Нет подходящих монет</td></tr>';
  $('majorMore').hidden=majorShown>=major.length||marketTab!=='all';
  $('smallMore').hidden=smallShown>=small.length;
  $('majorCount').textContent=csText('Показано ')+shownMajor.length+csText(' из ')+major.length;
  $('smallCount').textContent=csText('Показано ')+shownSmall.length+csText(' из ')+small.length;
  $('marketHint').textContent=({leaders:csText('Топ-5 по капитализации'),gainers:csText('Топ-5 по росту за 24 часа'),
    losers:csText('Топ-5 по падению за 24 часа'),favorites:csText('Сохранённые монеты на этом устройстве'),
    all:csText('Каталог монет · по 20 за раз')})[marketTab];
  document.querySelectorAll('#marketTabs button').forEach(btn=>{
    const active=btn.dataset.marketTab===marketTab;
    btn.classList.toggle('active',active);
    btn.setAttribute('aria-pressed',String(active));
  });
  updateMarketCoverageHint();
  if(window.CSI18N)window.CSI18N.apply();
}
let coinGeckoRetryAt=0;
function rateLimitError(retryAt) {
  const error=new Error('HTTP 429: CoinGecko cooldown');
  error.status=429;
  error.retryAt=retryAt;
  return error;
}
function coinGeckoDeadline(value,now) {
  const raw=String(value||'').trim(),min=now+30000,max=now+7200000;
  if(/^\d+$/.test(raw)) {
    const seconds=Number(raw);
    return seconds>=7200?max:Math.max(min,now+seconds*1000);
  }
  // The obsolete HTTP asctime format has no timezone token, but HTTP dates are UTC.
  const asctime=/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) +([0-9]{1,2}) ([0-9]{2}:[0-9]{2}:[0-9]{2}) ([0-9]{4})$/.exec(raw);
  const month=asctime?String('JanFebMarAprMayJunJulAugSepOctNovDec'.indexOf(asctime[1])/3+1).padStart(2,'0'):'';
  const parsed=Date.parse(asctime?asctime[4]+'-'+month+'-'+asctime[2].padStart(2,'0')+'T'+asctime[3]+'Z':raw);
  return Number.isFinite(parsed)?Math.max(min,Math.min(max,parsed)):min;
}
async function getJson(url) {
  const isCoinGecko=url.startsWith('https://api.coingecko.com/');
  if(isCoinGecko&&Date.now()<coinGeckoRetryAt)throw rateLimitError(coinGeckoRetryAt);
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),10000);
  try {
    const r=await fetch(url,{signal:controller.signal,headers:{accept:'application/json'}});
    if(isCoinGecko&&r.status===429) {
      const deadline=coinGeckoDeadline(r.headers?.get('Retry-After'),Date.now());
      coinGeckoRetryAt=Math.max(coinGeckoRetryAt,deadline);
      throw rateLimitError(coinGeckoRetryAt);
    }
    if(!r.ok)throw Error('HTTP '+r.status);
    return await r.json();
  } finally {
    clearTimeout(timeout);
  }
}
function btcUpdate(c){$('btc').textContent=usd(displayPrice(c));$('btcCap').textContent=compact(c.market_cap);$('btcVolume').textContent=compact(c.total_volume);const p=c.price_change_percentage_24h;$('btcChange').textContent='24h: '+(Number.isFinite(p)?(p>0?'+':'')+fmt(p)+'%':'—');$('btcChange').className=p>=0?'positive':'negative'}
let marketLoadPending=false,lastMarketSuccess=0,lastMarketAttempt=0,marketRetryAt=0,marketFailures=0;
const marketReceivedAt=new Map();
let marketCoverage={pages:0,retained:0},marketRefreshFailed=false;
function marketAssetNote(c) {
  const received=marketReceivedAt.get(c.id)||0;
  const parsed=typeof c.last_updated==='string'?Date.parse(c.last_updated):NaN;
  const sourceKnown=Number.isFinite(parsed)&&parsed>0&&parsed<=received;
  const time=value=>new Date(value).toLocaleString('ru-RU');
  return (sourceKnown?'данные от '+time(parsed):'время источника неизвестно')+
    (received?' · получено '+time(received):' · время получения неизвестно')+
    (sourceKnown&&Date.now()-parsed>600000?' · устарело':'')+
    (received&&(received<lastMarketSuccess||marketRefreshFailed)?' · не обновлено':'');
}
function marketCoverageNote() {
  if(!marketCoverage.pages||marketCoverage.pages===4)return '';
  return ' · неполные данные: '+marketCoverage.pages+'/4 страниц'+
    (marketCoverage.retained?' · прежних монет: '+marketCoverage.retained:'');
}
function updateMarketCoverageHint() {
  if(marketCoverage.pages>0&&marketCoverage.pages<4) {
    $('marketHint').textContent+=' · только среди загруженных и сохранённых монет'+marketCoverageNote();
  }
}
function delayMarketRetry() {
  marketFailures++;
  marketRetryAt=Date.now()+Math.min(900000,30000*2**Math.min(marketFailures-1,5))*(0.8+Math.random()*0.4);
  marketRetryAt=Math.max(marketRetryAt,coinGeckoRetryAt);
}
function updatePotentialTimestamp(error=false) {
  const el=$('potentialUpdated');
  if(!el)return;
  error=error||marketRefreshFailed;
  if(!lastMarketSuccess) {
    el.textContent=error?csText('Данные недоступны · повторите позже'):csText('Данные ещё не загружены');
    return;
  }
  const age=Math.round((Date.now()-lastMarketSuccess)/60000);
  el.textContent=(error?csText('Ошибка обновления · сохранены данные от '):csText('CoinGecko · обновлено: '))+
    new Date(lastMarketSuccess).toLocaleTimeString()+(age>5?' · '+age+csText(' мин назад'):'')+
    (age>10?csText(' · данные могут устареть'):'')+marketCoverageNote();
}
async function load(force=false) {
  const now=Date.now();
  if(marketLoadPending)return;
  if(now<coinGeckoRetryAt||((!force||marketFailures>0)&&now<marketRetryAt)) {
    if(force) {
      const message='CoinGecko: повтор после '+new Date(Math.max(coinGeckoRetryAt,marketRetryAt)).toLocaleTimeString();
      $('status').textContent=message;
      const updated=$('potentialUpdated');
      if(updated)updated.textContent=message+(lastMarketSuccess?' · данные от '+new Date(lastMarketSuccess).toLocaleTimeString():'')+
        marketCoverageNote();
    }
    return;
  }
  lastMarketAttempt=Date.now();
  marketLoadPending=true;
  const status=$('status');
  status.textContent=csText('Обновление CoinGecko…');
  try {
    const pages=await Promise.allSettled([1,2,3,4].map(page=>getJson(
      'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page='+
      page+'&sparkline=false&price_change_percentage=24h')));
    const validAsset=c=>c&&typeof c.id==='string'&&c.id.trim()&&typeof c.name==='string'&&typeof c.symbol==='string';
    const good=pages.filter(x=>x.status==='fulfilled'&&Array.isArray(x.value)&&x.value.length>0&&x.value.every(validAsset));
    if(!good.length)throw Error('No market pages');
    const partial=good.length<4,receivedAt=Date.now(),updatedIds=new Set();
    // Partial batches update known data without deleting assets from unavailable pages.
    const map=new Map(partial?coins.map(c=>[c.id,c]):[]);
    if(!partial)marketReceivedAt.clear();
    good.forEach(x=>x.value.forEach(c=>{
      map.set(c.id,c);
      updatedIds.add(c.id);
      marketReceivedAt.set(c.id,receivedAt);
    }));
    coins=[...map.values()];
    marketCoverage={pages:good.length,retained:coins.filter(c=>!updatedIds.has(c.id)).length};
    lastMarketSuccess=receivedAt;
    marketRefreshFailed=false;
    if(partial)delayMarketRetry();
    else {
      marketFailures=0;
      marketRetryAt=lastMarketSuccess+300000;
    }
    const btc=coins.find(c=>c.id==='bitcoin');
    if(btc)btcUpdate(btc);
    render();
    if(selectedCoinId&&coins.some(c=>c.id===selectedCoinId))openCoin(selectedCoinId,true);
    else if(btc&&!$('search').value.trim())openCoin(btc.id);
    status.textContent='CoinGecko · '+new Date(lastMarketSuccess).toLocaleTimeString('ru-RU')+' · '+coins.length+csText(' монет')+
      marketCoverageNote()+(partial?' · повтор после '+new Date(marketRetryAt).toLocaleTimeString('ru-RU'):'');
    $('dot').classList.toggle('ok',!partial);
    updatePotentialTimestamp();
    refreshLiveValues();
  } catch(e) {
    console.warn('CoinGecko refresh failed',e);
    marketRefreshFailed=true;
    $('dot').classList.remove('ok');
    delayMarketRetry();
    updatePotentialTimestamp(true);
    if(coins.length) {
      render();
      refreshLiveValues();
    }
    if(coinGeckoRetryAt>Date.now()) {
      status.textContent='CoinGecko: лимит запросов · повтор после '+new Date(marketRetryAt).toLocaleTimeString();
    }
    if(coins.length) {
      if(coinGeckoRetryAt<=Date.now())status.textContent=csText('CoinGecko недоступен · сохранены прежние данные');
      return;
    }
    try {
      const t=await getJson('https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT');
      $('btc').textContent=usd(Number(t.lastPrice));
      $('btcChange').textContent='24h: '+fmt(Number(t.priceChangePercent))+'%';
      if(coinGeckoRetryAt<=Date.now())status.textContent='BTC: Binance · каталог временно недоступен';
    } catch(err) {
      if(coinGeckoRetryAt<=Date.now())status.textContent=csText('Рыночные данные недоступны');
    }
  } finally {
    marketLoadPending=false;
  }
}

$('cvdWindow').addEventListener('change',()=>{if(lastSpotSymbol&&selectedCoinId)loadTrades(lastSpotSymbol,selectedCoinId)});
$('marketTabs').addEventListener('click',e=>{const b=e.target.closest('button[data-market-tab]');
if(!b)return;
marketTab=b.dataset.marketTab;
majorShown=marketTab==='all'?20:marketTab==='favorites'?20:5;
render();
document.getElementById('marketHint').scrollIntoView({behavior:'smooth',block:'center'})});
$('majorMore').addEventListener('click',()=>{majorShown+=20;
render()});
$('smallMore').addEventListener('click',()=>{smallShown+=20;
render()});
let searchTimer;
$('search').addEventListener('input',()=>{render();
clearTimeout(searchTimer);
const q=$('search').value.trim().toLowerCase();
if(!q){const btc=coins.find(c=>c.id==='bitcoin');
if(btc)openCoin(btc.id);
return}searchTimer=setTimeout(()=>{const matches=coins.filter(c=>c.symbol.toLowerCase()===q||c.name.toLowerCase()===q);
const candidate=matches[0]||
  coins.filter(c=>c.symbol.toLowerCase().startsWith(q)||c.name.toLowerCase().startsWith(q)).sort((a,b)=>(b.market_cap||0)-(a.market_cap||0))[0];
if(candidate)openCoin(candidate.id);
else{lastSpotSymbol='';
selectedCoinId='';
detailRequest++;
$('coinDetail').hidden=true;
coinRequest++}},450)});
$('sort').addEventListener('change',render);
$('volGrowth').addEventListener('change',render);
$('liquidity').addEventListener('change',render);
$('refresh').addEventListener('click',()=>load(true));
$('potentialRefresh').addEventListener('click',()=>load(true));
document.querySelectorAll('#major,#small').forEach(t=>t.addEventListener('click',e=>{const research=e.target.closest('button[data-research]');
if(research){inspectPotential(research.dataset.research);
return}const star=e.target.closest('button[data-favorite]');
if(star){const id=star.dataset.favorite;
if(favoriteIds.has(id))favoriteIds.delete(id);
else favoriteIds.add(id);
saveFavorites();
render();
return}const tr=e.target.closest('tr[data-id]');
if(tr){$('search').value=coins.find(c=>c.id===tr.dataset.id)?.symbol.toUpperCase()||'';
openCoin(tr.dataset.id);
$('coinDetail').scrollIntoView({behavior:'smooth',block:'start'})}}));
$('closeDetail').addEventListener('click',()=>{coinRequest++;
detailRequest++;
selectedCoinId='';
lastSpotSymbol='';
chartSeq++;
chartSymbol='';
$('coinDetail').hidden=true;
$('detailChart').src='about:blank'});
translate();
load();
connectLive();
document.addEventListener('visibilitychange',()=>{if(document.hidden){pauseLive()}
else{connectLive();

if(Date.now()>=marketRetryAt&&Date.now()-lastMarketAttempt>=300000)load()}});

setInterval(()=>{updatePotentialTimestamp();

if(!document.hidden&&Date.now()>=marketRetryAt&&Date.now()-lastMarketAttempt>=300000)load();

checkLiveHealth()},5000);
