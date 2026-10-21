'use strict';
/* Mac's Marlin — offshore marlin planner. Private data (marks, catches, settings) live only in localStorage. */
const tfetch=(u)=>fetch(u,{signal:AbortSignal.timeout?AbortSignal.timeout(25000):undefined}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.json();});
const TZ='Australia/Brisbane',HR=3600e3,$=id=>document.getElementById(id);
const LS={get(k,d){try{const v=localStorage.getItem('mm.'+k);return v?JSON.parse(v):d;}catch(e){return d;}},set(k,v){localStorage.setItem('mm.'+k,JSON.stringify(v));}};
const esc=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmtT=t=>new Intl.DateTimeFormat('en-AU',{timeZone:TZ,hour:'numeric',minute:'2-digit',hour12:true}).format(t).replace(' ','').toLowerCase();
const fmtD=t=>new Intl.DateTimeFormat('en-AU',{timeZone:TZ,weekday:'short',day:'numeric',month:'short'}).format(t);
const CEN={lat:-25.6,lon:153.1};
function scoreColor(s){s=clamp(s/100);const h=s<.5?lerp(s,0,.5,0,48):lerp(s,.5,1,48,130);const l=s<.5?50:lerp(s,.5,1,48,24);return`hsl(${h.toFixed(0)},78%,${l.toFixed(0)}%)`;}
function nm(a,b){const R=3440.065,r=Math.PI/180,dl=(b.lat-a.lat)*r,dn=(b.lon-a.lon)*r;const x=Math.sin(dl/2)**2+Math.cos(a.lat*r)*Math.cos(b.lat*r)*Math.sin(dn/2)**2;return 2*R*Math.asin(Math.sqrt(x));}
function brg(a,b){const r=Math.PI/180,y=Math.sin((b.lon-a.lon)*r)*Math.cos(b.lat*r),x=Math.cos(a.lat*r)*Math.sin(b.lat*r)-Math.sin(a.lat*r)*Math.cos(b.lat*r)*Math.cos((b.lon-a.lon)*r);return(Math.atan2(y,x)/r+360)%360;}
function parseCoord(s,neg){s=String(s||'').trim().toUpperCase();if(!s)return null;const h=/[SW]/.test(s)?-1:/[NE]/.test(s)?1:0;const n=s.replace(/[^\d.\-\s]/g,' ').trim().split(/\s+/).map(Number);if(n.some(isNaN))return null;
  let v=Math.abs(n[0])+(n[1]||0)/60+(n[2]||0)/3600;const sg=h||(n[0]<0?-1:(neg?-1:1));return sg*v;}

/* ---------------- ocean grid ---------------- */
let OC=null,G=null,STAT=null;
function cellIdx(lat,lon){if(!G)return null;const j=Math.round((lat-G.lat0)/G.step),i=Math.round((lon-G.lon0)/G.step);if(j<0||i<0||j>=G.ny||i>=G.nx)return null;return{j,i};}
function val(k,j,i){const a=OC&&OC[k];if(!a)return null;const v=a[j]&&a[j][i];return v==null?null:v;}
/* nearest valid sea cell within ~3 cells (marks near the coast / cloud gaps) */
function near(k,lat,lon,rad=3){const c=cellIdx(lat,lon);if(!c)return null;let best=null,bd=1e9;
  for(let dj=-rad;dj<=rad;dj++)for(let di=-rad;di<=rad;di++){const v=val(k,c.j+dj,c.i+di);if(v==null)continue;const d=dj*dj+di*di;if(d<bd){bd=d;best=v;}}return best;}
function nmax(k,j,i,r=2){let m=null;for(let dj=-r;dj<=r;dj++)for(let di=-r;di<=r;di++){const v=val(k,j+dj,i+di);if(v!=null&&(m==null||v>m))m=v;}return m;}

/* ---------------- factor functions (each 0..1, null = no data) ---------------- */
const W={sst:24,front:18,cur:12,bait:12,depth:12,light:8,sol:5,moon:4,tide:5};
const FN={sst:'Water temp',front:'Temp break',cur:'Current / eddy edge',bait:'Bait & colour',depth:'Depth / shelf',light:'Light',sol:'Solunar',moon:'Moon phase',tide:'Tide change'};
function fSst(s){if(s==null)return null;return s<19?0.05:s<21?lerp(s,19,21,.05,.3):s<22.5?lerp(s,21,22.5,.3,.7):s<24?lerp(s,22.5,24,.7,.95):s<=27.5?1:s<29?lerp(s,27.5,29,1,.75):.7;}
function fFront(d){return d==null?null:1/(1+(d/8)**2);}
function fCur(e,s){if(e==null&&s==null)return null;const v=Math.max(e==null?0:clamp(e/0.02),s==null?0:clamp(s/0.012));return .25+.75*v;}
function fBait(c,g){if(c==null)return null;const f1=c<.06?.25:c<.12?lerp(c,.06,.12,.25,.8):c<=.5?1:c<1.5?lerp(c,.5,1.5,1,.6):.45;return .55*f1+.45*(g==null?.3:clamp(g/0.03));}
function juvSeason(m){return[11,12,1,2,3].includes(m)?1:(m===10||m===4)?.5:0;}
function fDepth(d,m,lat){if(d==null||d<=0)return null;const blue=d<30?.1:d<80?lerp(d,30,80,.1,.35):d<150?lerp(d,80,150,.35,.8):d<=1200?1:d<3000?lerp(d,1200,3000,1,.75):.7;
  const inBlackArea=lat<=-24.0&&lat>=-27.6;const black=d<15?.2:d<30?lerp(d,15,30,.2,1):d<=90?1:d<200?lerp(d,90,200,1,.6):.5;
  return Math.max(blue,(inBlackArea?juvSeason(m):0)*black);}
function fLight(alt){return alt<-8?.1:alt<-6?lerp(alt,-8,-6,.1,.8):alt<-3?lerp(alt,-6,-3,.8,1):alt<=12?1:alt<30?lerp(alt,12,30,1,.65):.6;}
function fTide(t,ext){if(!ext||!ext.length)return null;let d=1e9;for(const x of ext)d=Math.min(d,Math.abs(t-x.t)/HR);return d<=1?1:d<2.5?lerp(d,1,2.5,1,.6):.5;}
function combine(f){let s=0,w=0;const parts=[];for(const k in W){const v=f[k];if(v==null)continue;s+=W[k]*v;w+=W[k];parts.push({k,v});}return{score:w?100*s/w:null,wsum:w,parts};}
/* static (ocean) factors for a point */
function oceanFactors(lat,lon,month){const c=cellIdx(lat,lon);const o={};if(!c)return o;
  const sst=near('sst',lat,lon),df=near('dfront',lat,lon),chl=near('chl',lat,lon),cg=c?nmax('chlgrad',c.j,c.i,1):null,ce=c?nmax('curedge',c.j,c.i,2):null,sg=c?nmax('slagrad',c.j,c.i,2):null;
  const dep=near('depth',lat,lon,1);
  o.sst=fSst(sst);o.front=fFront(df);o.cur=fCur(ce,sg);o.bait=fBait(chl,cg);o.depth=fDepth(dep>0?dep:null,month,lat);
  o._raw={sst,df,chl,cg,ce,sg,dep,spd:near('speed',lat,lon)};return o;}
/* time factors; ev = sun/moon events for the day(s) */
const EVC={};function events(ds,lat=CEN.lat,lon=CEN.lon){const k=ds+lat.toFixed(1)+lon.toFixed(1);if(!EVC[k]){const t0=dayStart(ds,TZ)-6*HR;EVC[k]=sunMoonEvents(t0,t0+36*HR,lat,lon);}return EVC[k];}
function timeFactors(t,lat,lon,tideExt){const ds=ymd(t,TZ),ev=events(ds,lat,lon),sol=solunarFactor(t,ev),il=moonIllum(t);
  return{light:fLight(sunAlt(t,lat,lon)),sol:.3+.7*sol.v,moon:.45+.55*moonPhaseFactor(il.phase),tide:fTide(t,tideExt),_sol:sol,_ph:il};}
function scoreAt(lat,lon,t,tideExt,oc){const m=+ymd(t,TZ).slice(5,7);const o=oc||oceanFactors(lat,lon,m);const tf=timeFactors(t,lat,lon,tideExt);const f=Object.assign({},o,tf);const r=combine(f);r.f=f;r.conf=confidence(r);return r;}
function confidence(r){let c=r.wsum/100;const age=dataAgeDays('sst');if(age!=null&&age>3)c-=.15;if(age!=null&&age>7)c-=.2;if(r.f&&r.f.bait==null)c-=.05;return c>=.85?'medium':c>=.65?'low-medium':'low';}
function dataAgeDays(k){const s=OC&&OC.meta.sources[k];if(!s||!s.time)return null;return(Date.now()-Date.parse(s.time))/864e5;}

/* ---------------- marks ---------------- */
const FADS=(window.FADS.fads||[]).map((f,n)=>Object.assign({id:'fad'+n,pub:true},f));
let MARKS=LS.get('marks',[]);
function allMarks(which='all'){return(which==='fad'?[]:MARKS.map(m=>Object.assign({pub:false},m))).concat(which==='mine'?[]:FADS);}

/* ---------------- tabs ---------------- */
document.querySelectorAll('nav button').forEach(b=>b.onclick=()=>show(b.dataset.t));
function show(t){document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('on',b.dataset.t===t));document.querySelectorAll('.tab').forEach(s=>s.classList.toggle('on',s.id==='t-'+t));
  if(t==='map'&&MAP)setTimeout(()=>MAP.invalidateSize(),50);if(t==='score')renderScore();if(t==='plan')renderPlan();if(t==='marks')renderMarks();if(t==='log')renderLog();location.hash=t;}

/* ---------------- days ---------------- */
const TODAY=ymd(Date.now(),TZ);const DAYS=[...Array(7)].map((_,i)=>addDays(TODAY,i));
function fillDays(sel){sel.innerHTML=DAYS.map((d,i)=>`<option value="${d}">${i===0?'Today':i===1?'Tomorrow':fmtD(dayStart(d,TZ)+12*HR)}</option>`).join('');}

/* ---------------- map ---------------- */
let MAP=null,OVL=null,LY={};
function initMap(){
  MAP=window.__map=L.map('map',{zoomControl:true,attributionControl:true,preferCanvas:true}).setView([-25.4,153.0],7);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',{maxZoom:13,attribution:'Basemap © Esri, GEBCO, NOAA, Garmin, HERE'}).addTo(MAP);
  for(const k of['front','cur','bathy','fad','mine'])LY[k]=L.layerGroup().addTo(MAP);
  $('layerSel').onchange=drawShade;$('mapTime').oninput=()=>{mapTimeLabel();drawShadeSoon();};
  [['lyFront','front'],['lyCur','cur'],['lyBathy','bathy'],['lyFad','fad'],['lyMine','mine']].forEach(([id,k])=>$(id).onchange=e=>e.target.checked?LY[k].addTo(MAP):LY[k].remove());
  MAP.on('click',e=>pointPopup(e.latlng.lat,e.latlng.lng));
  MAP.on('contextmenu',e=>{prefillMark(e.latlng.lat,e.latlng.lng);});
  const now=Date.now(),t0=Math.floor(now/HR)*HR;$('mapTime').dataset.t0=t0;mapTimeLabel();
}
function mapT(){return+$('mapTime').dataset.t0+(+$('mapTime').value)*HR;}
function mapTimeLabel(){const t=mapT();$('mapTimeL').textContent=fmtD(t)+' '+fmtT(t);}
let shTimer=null;function drawShadeSoon(){clearTimeout(shTimer);shTimer=setTimeout(drawShade,120);}
const RAMPS={sst:{min:20,max:28,unit:'°C',c:v=>`hsl(${lerp(v,20,28,240,0)},85%,50%)`},chl:{min:-1.3,max:0.5,unit:'mg/m³ (log)',c:v=>`hsl(${lerp(v,-1.3,.5,230,90)},70%,${lerp(v,-1.3,.5,35,45)}%)`,fmt:v=>(10**v).toFixed(2)},speed:{min:0,max:1.2,unit:'m/s',c:v=>`hsl(${lerp(v,0,1.2,200,0)},80%,${lerp(v,0,1.2,30,55)}%)`}};
let STATIC=null,STATIC_M=null;
function staticGrid(m){if(STATIC&&STATIC_M===m)return STATIC;STATIC=[];for(let j=0;j<G.ny;j++){const row=[];for(let i=0;i<G.nx;i++){const d=val('depth',j,i);if(d==null||d<=0){row.push(null);continue;}
  const lat=G.lat0+j*G.step,lon=G.lon0+i*G.step;const o={sst:fSst(val('sst',j,i)),front:fFront(val('dfront',j,i)),cur:fCur(nmax('curedge',j,i,2),nmax('slagrad',j,i,2)),bait:fBait(val('chl',j,i),nmax('chlgrad',j,i,1)),depth:fDepth(d,m,lat)};row.push(o);}STATIC.push(row);}STATIC_M=m;return STATIC;}
function drawShade(){if(!OC||!MAP)return;const k=$('layerSel').value;if(OVL){OVL.remove();OVL=null;}if(k==='none'){$('legend').innerHTML='';return;}
  const cv=document.createElement('canvas');cv.width=G.nx;cv.height=G.ny;const cx=cv.getContext('2d');const t=mapT();
  let tf=null,stat=null;if(k==='score'){tf=timeFactors(t,CEN.lat,CEN.lon,null);stat=staticGrid(+ymd(t,TZ).slice(5,7));}
  for(let j=0;j<G.ny;j++)for(let i=0;i<G.nx;i++){let col=null;
    if(k==='score'){const o=stat[j][i];if(!o)continue;const r=combine(Object.assign({},o,{light:tf.light,sol:tf.sol,moon:tf.moon}));if(r.score==null)continue;col=scoreColor(r.score);}
    else{let v=val(k,j,i);if(v==null)continue;if(k==='chl')v=Math.log10(Math.max(v,.01));col=RAMPS[k].c(v);}
    cx.fillStyle=col;cx.fillRect(i,G.ny-1-j,1,1);}
  const h=G.step/2;OVL=L.imageOverlay(cv.toDataURL(),[[G.lat0-h,G.lon0-h],[G.lat0+(G.ny-1)*G.step+h,G.lon0+(G.nx-1)*G.step+h]],{opacity:.7,interactive:false}).addTo(MAP);
  legend(k);}
function legend(k){let g,lo,hi,u;
  if(k==='score'){g='linear-gradient(90deg,'+[0,25,50,75,100].map(scoreColor).join(',')+')';lo='0 poor';hi='100 best';u='Marlin bite score (ocean + time; wind not included)';}
  else{const R=RAMPS[k];g='linear-gradient(90deg,'+[0,.25,.5,.75,1].map(x=>R.c(R.min+x*(R.max-R.min))).join(',')+')';lo=(R.fmt?R.fmt(R.min):R.min);hi=(R.fmt?R.fmt(R.max):R.max)+' '+R.unit;u=$('layerSel').selectedOptions[0].text+(k==='chl'?' — green = bait-rich, blue = clear EAC water':'');}
  $('legend').innerHTML=`<div>${esc(u)}</div><div class="bar" style="background:${g}"></div><div class="ends"><span>${lo}</span><span>${hi}</span></div>`;}
function drawVectors(){if(!OC)return;LY.front.clearLayers();LY.cur.clearLayers();
  for(const f of OC.fronts||[])L.polyline(f.l.map(p=>[p[1],p[0]]),{color:'#fff',weight:2.2,opacity:.9,dashArray:'5 4'}).bindTooltip(f.t.toFixed(1)+'°C break').addTo(LY.front);
  if(OC.ucur)for(let j=1;j<G.ny;j+=4)for(let i=1;i<G.nx;i+=4){const u=val('ucur',j,i),v=val('vcur',j,i);if(u==null||v==null)continue;const s=Math.hypot(u,v);if(s<.08)continue;
    const lat=G.lat0+j*G.step,lon=G.lon0+i*G.step,k=.16*Math.min(1.5,s)/s;const la2=lat+v*k,lo2=lon+u*k/Math.cos(lat*Math.PI/180);
    const a=Math.atan2(v,u),hl=.035;const p1=[la2-hl*Math.sin(a-.5),lo2-hl*Math.cos(a-.5)/Math.cos(lat*Math.PI/180)],p2=[la2-hl*Math.sin(a+.5),lo2-hl*Math.cos(a+.5)/Math.cos(lat*Math.PI/180)];
    L.polyline([[lat,lon],[la2,lo2],p1,[la2,lo2],p2],{color:'#111',weight:1.4,opacity:.75,interactive:false}).addTo(LY.cur);}}
function drawBathy(B){LY.bathy.clearLayers();for(const c of B.contours){if(c.depth<50)continue;const shelf=c.depth===200;const w=shelf?2.4:c.depth>=1000?1.2:.9;
  for(const l of c.lines)L.polyline(l.map(p=>[p[1],p[0]]),{color:shelf?'#10202e':'#5d8fb3',weight:w,opacity:shelf?.95:.7,interactive:true}).bindTooltip(c.depth+' m').addTo(LY.bathy);}}
function drawMarks(){LY.fad.clearLayers();LY.mine.clearLayers();
  for(const f of FADS)L.circleMarker([f.lat,f.lon],{radius:5,color:'#fff',weight:1.5,fillColor:'#ff9f1c',fillOpacity:1}).bindPopup(()=>markPopup(f)).addTo(LY.fad);
  for(const m of MARKS)L.circleMarker([m.lat,m.lon],{radius:6,color:'#fff',weight:2,fillColor:'#c03cff',fillOpacity:1}).bindPopup(()=>markPopup(m)).addTo(LY.mine);}
function breakdownTable(r){return'<table>'+r.parts.map(p=>`<tr><td>${FN[p.k]}</td><td style="width:40%"><div class="fbar"><i style="width:${(p.v*100).toFixed(0)}%;background:${scoreColor(p.v*100)}"></i></div></td><td>${W[p.k]}</td></tr>`).join('')+'</table>';}
function rawLine(o){const r=o._raw||{};const a=[];if(r.sst!=null)a.push('SST '+r.sst.toFixed(1)+'°C');if(r.df!=null)a.push('break '+(r.df/1.852).toFixed(1)+' nm');if(r.chl!=null)a.push('chl '+r.chl.toFixed(2));if(r.spd!=null)a.push('current '+(r.spd*1.944).toFixed(1)+' kn');if(r.dep!=null&&r.dep>0)a.push(Math.round(r.dep)+' m (chart)');return a.join(' · ');}
function pointPopup(lat,lon){const t=mapT(),m=+ymd(t,TZ).slice(5,7);const o=oceanFactors(lat,lon,m);const r=scoreAt(lat,lon,t,null,o);
  const html=r.score==null?'No ocean data here (land or outside the area).':`<b style="font-size:16px">${Math.round(r.score)}</b> /100 · ${fmtT(t)} ${fmtD(t)}<br><span class="small">${esc(rawLine(o))}</span>${breakdownTable(r)}<span class="small">Confidence: ${r.conf}. ${lat.toFixed(4)}, ${lon.toFixed(4)}</span><br><button onclick="prefillMark(${lat.toFixed(5)},${lon.toFixed(5)})">📌 Add mark here</button>`;
  L.popup().setLatLng([lat,lon]).setContent(html).openOn(MAP);}
function markPopup(m){const t=mapT();const r=scoreAt(m.lat,m.lon,t,null);return`<b>${esc(m.name)}</b>${m.pub?' <span class="small">(public FAD)</span>':' 🔒'}<br>${m.depth?m.depth+' m · ':''}${esc(m.type||'')}<br><b>${r.score==null?'–':Math.round(r.score)}</b>/100 at ${fmtT(t)}<br><span class="small">${esc(rawLine(r.f))}</span>`;}
window.prefillMark=function(lat,lon){$('mkLat').value=(+lat).toFixed(5);$('mkLon').value=(+lon).toFixed(5);const d=near('depth',lat,lon,1);if(d>0)$('mkDepth').value=Math.round(d);show('marks');$('mkName').focus();};

/* ---------------- tide/sea level at marks (Open-Meteo marine, model sea level incl. tide) ---------------- */
let TIDES={};
async function loadMarkTides(marks){const need=marks.filter(m=>!TIDES[m.id]);if(!need.length)return;
  for(let n=0;n<need.length;n+=40){const ch=need.slice(n,n+40);
    try{const u=`https://marine-api.open-meteo.com/v1/marine?latitude=${ch.map(m=>m.lat.toFixed(3)).join(',')}&longitude=${ch.map(m=>m.lon.toFixed(3)).join(',')}&hourly=sea_level_height_msl&timezone=GMT&forecast_days=7&cell_selection=sea`;
      const j=await tfetch(u);const arr=Array.isArray(j)?j:[j];
      arr.forEach((d,k)=>{if(!d.hourly)return;const ts=d.hourly.time.map(s=>Date.parse(s+'Z')),fn=makeSeries(ts,d.hourly.sea_level_height_msl);TIDES[ch[k].id]=tideExtremes(fn,ts[0],ts[ts.length-1]);});
    }catch(e){console.warn('tide fetch',e.message);}}}

/* ---------------- score tab ---------------- */
function bestOfDay(m,ds){const t0=dayStart(ds,TZ);const oc=oceanFactors(m.lat,m.lon,+ds.slice(5,7));let best=null;
  for(let h=4;h<=19;h+=.5){const t=t0+h*HR;const r=scoreAt(m.lat,m.lon,t,TIDES[m.id],oc);if(r.score!=null&&(!best||r.score>best.score))best=Object.assign(r,{t});}return best;}
async function renderScore(){if(!OC){$('scList').innerHTML='<li>Loading ocean data…</li>';return;}const ds=$('scDay').value||TODAY,which=$('scWhich').value;
  const ms=allMarks(which);await loadMarkTides(ms);
  const rows=ms.map(m=>({m,b:bestOfDay(m,ds)})).filter(x=>x.b).sort((a,b)=>b.b.score-a.b.score);
  const ev=events(ds),il=moonIllum(dayStart(ds,TZ)+12*HR);
  const sr=ev.sunRiseSet.filter(x=>x.rising&&ymd(x.t,TZ)===ds)[0],ss=ev.sunRiseSet.filter(x=>!x.rising&&ymd(x.t,TZ)===ds)[0];
  const maj=ev.transits.filter(x=>ymd(x.t,TZ)===ds).map(x=>fmtT(x.t)).join(', ');
  const top=rows[0];
  $('scTop').innerHTML=`<div class="row" style="align-items:center"><span class="pill" style="background:${top?scoreColor(top.b.score):'#555'};font-size:20px">${top?Math.round(top.b.score):'–'}</span><div class="grow"><b>${top?esc(top.m.name):'No marks'}</b><br><span class="mut small">${top?'best at '+fmtT(top.b.t):''}</span></div></div>
   <p class="small mut" style="margin:8px 0 0">${phaseEmoji(il.phase,-25)} ${phaseName(il.phase)} (${Math.round(il.fraction*100)}%) · sunrise ${sr?fmtT(sr.t):'–'} · sunset ${ss?fmtT(ss.t):'–'} · major solunar ${maj||'–'} · juvenile black season: ${juvSeason(+ds.slice(5,7))===1?'yes (Nov–Mar)':juvSeason(+ds.slice(5,7))?'shoulder':'no'}</p>
   <p class="small mut" style="margin:4px 0 0">Ocean layers are the latest satellite snapshot (SST ${ageTxt('sst')}, currents ${ageTxt('cur')}, chlorophyll ${ageTxt('chl')}); later days reuse them, so trust falls off with each day ahead.</p>`;
  $('scList').innerHTML=rows.map(({m,b})=>`<li><details><summary><span class="pill" style="background:${scoreColor(b.score)}">${Math.round(b.score)}</span><div class="grow"><div class="nm">${m.pub?'':'🔒 '}${esc(m.name)}</div><div class="mut small">best ${fmtT(b.t)} · ${m.depth?m.depth+' m · ':''}${esc(m.type||'')}</div></div></summary>
     <p class="small mut">${esc(rawLine(b.f))}</p>${breakdownTable(b)}<p class="small mut">Confidence: ${b.conf}. ${b.f._sol&&b.f._sol.label?esc(b.f._sol.label)+'. ':''}${b.f.tide!=null?'Tide factor uses Open-Meteo model sea level at the mark.':'No tide data for this mark.'}${m.pub?' Source: qld.gov.au FAD list.':''}</p></details></li>`).join('')||'<li class="mut">No marks yet. Add your own on the Marks tab.</li>';}
function ageTxt(k){const s=OC&&OC.meta.sources[k];if(!s)return'unavailable';const d=dataAgeDays(k);return(d<1.5?'≈1 day old':Math.round(d)+' days old')+(s.stale?' (stale copy)':'');}
function renderMethod(){$('methodBody').innerHTML=`<p>The bite score (0–100) is a <b>weighted average of simple 0–1 factors</b>. Every weight is listed here; nothing is hidden or learned. It ranks <i>where and when</i> conditions look most marlin-friendly. It does <b>not</b> know where the fish are, and it has not been validated against catch data yet. Treat it as a short-list, not a forecast.</p>
<table><tr><th>Factor</th><th>Wt</th><th>How it is scored</th></tr>
<tr><td>Water temp</td><td>24</td><td>MUR SST. 1.0 from 24–27.5 °C, 0.7 at 22.5, 0.3 at 21, near 0 below 19; eases to 0.75 above 29. Black, blue and striped marlin all fit roughly 22–28 °C.</td></tr>
<tr><td>Temp break</td><td>18</td><td>Distance to the nearest SST front (gradient ≥ 0.03 °C/km, about 0.3 °C over 10 km): 1.0 on the break, 0.8 at 4 km, 0.5 at 8 km, 0.2 at 16 km.</td></tr>
<tr><td>Current / eddy edge</td><td>12</td><td>Strongest shear in IMOS geostrophic current speed, or sea-level slope (eddy rim), within about 8 km. Pulls bait up, and EAC edges hold fish.</td></tr>
<tr><td>Bait &amp; colour</td><td>12</td><td>Chlorophyll in the 0.12–0.5 mg/m³ "blue-green" band scores best (clear EAC water with some food). 55% of this factor is that band and 45% is the strength of the nearby chlorophyll front.</td></tr>
<tr><td>Depth / shelf</td><td>12</td><td>Blue and striped marlin: shelf edge and beyond (150–1200 m) = 1. Juvenile black marlin, Nov–Mar from Bundaberg to Moreton: 30–90 m wide grounds = 1. The better of the two profiles is used.</td></tr>
<tr><td>Light</td><td>8</td><td>Dawn and dusk (sun from 6° below to 12° above the horizon) = 1, midday 0.6, night 0.1.</td></tr>
<tr><td>Solunar</td><td>5</td><td>Major periods (moon over or underfoot) and minor periods (moonrise or moonset). Same maths as Mac's Jacks.</td></tr>
<tr><td>Moon phase</td><td>4</td><td>Close to new or full moon scores a little higher. The evidence for marlin is weak, so the weight is small.</td></tr>
<tr><td>Tide change</td><td>5</td><td>Within 1 h of a tide turn = 1, otherwise 0.5–0.6. Tides come from Open-Meteo modelled sea level at each mark. Only marks get this factor; the map grid leaves it out.</td></tr></table>
<p><b>Missing data</b> (cloud over the chlorophyll, coastal gaps) drops that factor out, and the rest are re-weighted. Confidence then drops: it reads <i>medium</i> at best, <i>low</i> when layers are missing or SST is more than 3 days old.</p>
<p><b>Known limits:</b> MUR SST is a smoothed, gap-filled analysis (~1 km), so sharp fronts are softened. Geostrophic currents (~20 km grid) miss small eddies and wind drift near the coast. VIIRS/MODIS chlorophyll is a weekly or 8-day composite. Inshore readings are inflated by river plumes and sediment (Burnett, Mary and Great Sandy Strait). ETOPO1 bathymetry (~1.8 km) blurs small ledges and canyon heads; use your sounder and charts. Wind and swell are <i>not</i> part of the bite score; they go into the Plan tab's go/no-go.</p>
<p><b>Next step to make it honest:</b> log catches (with SST auto-filled). Once there are about 30–50 fish, the weights can be checked against your own results.</p>`;}

/* ---------------- planner ---------------- */
const PORTS=[
 {id:'1770',name:'Seventeen Seventy (Round Hill Ck bar)',lat:-24.158,lon:151.889,off:{lat:-24.0,lon:152.25},bar:'Round Hill Creek Bar is a designated coastal bar. It is shallow and shifting at low tide, and an ebb against a NE–SE swell stands up quickly. Cross on the flood in daylight, log on with VMR Round Hill.',bom:'https://www.bom.gov.au/qld/forecasts/capricornia-coast.shtml'},
 {id:'bh',name:'Burnett Heads (Bundaberg)',lat:-24.758,lon:152.411,off:{lat:-24.6,lon:152.65},bar:'Burnett Heads is a dredged, rock-walled port entrance, not a designated coastal bar. It is usually straightforward, but strong SE wind against the ebb makes a short, steep chop at the leads. VMR Bundaberg can give local advice.',bom:'https://www.bom.gov.au/qld/forecasts/fraser-coast.shtml'},
 {id:'ur',name:'Urangan (Hervey Bay, via Sandy Cape)',lat:-25.293,lon:152.909,off:{lat:-24.75,lon:153.2},bar:'There is no bar, but the shelf is a long run north around Sandy Cape (≈45–60 nm). Breaksea Spit is dangerous in wind against tide. Distances here are straight-line, so add the run around the cape.',bom:'https://www.bom.gov.au/qld/forecasts/hervey-bay.shtml'},
 {id:'wb',name:'Tin Can Bay / Inskip (Wide Bay Bar)',lat:-25.775,lon:153.12,off:{lat:-25.75,lon:153.35},bar:'Wide Bay Bar is a designated coastal bar and one of Queensland\'s most dangerous. MSQ advises that an ebb tide combined with a south-east swell or sea can raise big breaking waves. Don\'t attempt it without local knowledge. Get current conditions and reference points from Tin Can Bay Coast Guard (07 5486 4290, VHF 16/67/80/82). Use the MSQ virtual navaids (AIS) only as a guide.',bom:'https://www.bom.gov.au/qld/forecasts/fraser-coast.shtml',links:[['MSQ Notice to Mariners 164/2025: Wide Bay Bar depths and virtual navaids (PDF)','https://www.publications.qld.gov.au/ckan-publications-attachments-prod/resources/138833a1-9a60-4385-a6ad-b1dd1e279587/2025-164.pdf'],['MSQ Beacon to Beacon: Great Sandy Strait (PDF)','https://www.msq.qld.gov.au/-/media/TMROnline/msqinternet/msqfiles/home/boatingmaps/greatsandystraitbeacon.pdf']]},
 {id:'mo',name:'Mooloolaba (Mooloolah bar)',lat:-26.684,lon:153.135,off:{lat:-26.65,lon:153.4},bar:'Mooloolah Bar is a designated coastal bar. It shoals between dredging campaigns and breaks across the entrance in a big E–SE swell, worst on the ebb. Check MSQ notices for current depths, and log on with Coast Guard Mooloolaba.',bom:'https://www.bom.gov.au/qld/forecasts/sunshine-coast-waters.shtml'},
 {id:'sc',name:'Scarborough (Moreton Bay N entrance)',lat:-27.195,lon:153.11,off:{lat:-27.0,lon:153.5},bar:'There is no bar through the northern entrance, but the run past Skirmish Point and the NW Channel gets rough in a strong SE wind against the tide. Bribie and Caloundra bars are designated coastal bars; avoid them in swell.',bom:'https://www.bom.gov.au/qld/forecasts/moreton-bay.shtml'}];
const DEF_LIM={speed:22,range:45,wind:14,windX:20,gust:26,wave:1.5,waveX:2.3,per:7};
let LIM=Object.assign({},DEF_LIM,LS.get('limits',{}));
const WXC={};
async function getWx(p){if(WXC[p.id]&&Date.now()-WXC[p.id].at<30*60e3)return WXC[p.id];
  const q=`latitude=${p.off.lat}&longitude=${p.off.lon}&timezone=GMT&forecast_days=7`;
  const [w,m,b]=await Promise.all([
    tfetch(`https://api.open-meteo.com/v1/forecast?${q}&hourly=wind_speed_10m,wind_gusts_10m,wind_direction_10m,cloud_cover,precipitation_probability&wind_speed_unit=kn`),
    tfetch(`https://marine-api.open-meteo.com/v1/marine?${q}&hourly=wave_height,swell_wave_height,swell_wave_period,swell_wave_direction,wind_wave_height,sea_surface_temperature`),
    fetch(`https://marine-api.open-meteo.com/v1/marine?latitude=${p.lat}&longitude=${p.lon}&timezone=GMT&forecast_days=7&cell_selection=sea&hourly=sea_level_height_msl`).catch(()=>null)]);
  const ts=w.hourly.time.map(s=>Date.parse(s+'Z'));const mi={};m.hourly.time.forEach((s,i)=>mi[Date.parse(s+'Z')]=i);
  const H=ts.map((t,i)=>{const k=mi[t];const g=(a)=>k==null||!m.hourly[a]?null:m.hourly[a][k];return{t,wind:w.hourly.wind_speed_10m[i],gust:w.hourly.wind_gusts_10m[i],dir:w.hourly.wind_direction_10m[i],cloud:w.hourly.cloud_cover[i],rain:w.hourly.precipitation_probability[i],wave:g('wave_height'),swell:g('swell_wave_height'),per:g('swell_wave_period'),sdir:g('swell_wave_direction'),sst:g('sea_surface_temperature')};});
  let tide=null;if(b&&b.hourly){const bt=b.hourly.time.map(s=>Date.parse(s+'Z'));const fn=makeSeries(bt,b.hourly.sea_level_height_msl);tide={fn,ext:tideExtremes(fn,bt[0],bt[bt.length-1])};}
  return WXC[p.id]={at:Date.now(),H,tide};}
function hourStatus(h){const why=[];let s=0;
  if(h.wind==null)return{s:1,why:['no data']};
  if(h.wind>=LIM.windX){s=2;why.push('wind '+Math.round(h.wind)+' kn');}else if(h.wind>LIM.wind){s=Math.max(s,1);why.push('wind '+Math.round(h.wind)+' kn');}
  if(h.gust>=LIM.gust){s=2;why.push('gusts '+Math.round(h.gust)+' kn');}
  if(h.wave!=null){if(h.wave>=LIM.waveX){s=2;why.push('sea '+h.wave.toFixed(1)+' m');}else if(h.wave>LIM.wave){s=Math.max(s,1);why.push('sea '+h.wave.toFixed(1)+' m');}}
  if(h.per!=null&&h.swell!=null&&h.per<LIM.per&&h.swell>1){s=Math.max(s,1);why.push('short '+Math.round(h.per)+' s swell');}
  return{s,why};}
const DIRS=['N','NNE','NE','ENE','E','ESE','SE','SSE','S','SSW','SW','WSW','W','WNW','NW','NNW'];const dir16=d=>d==null?'':DIRS[Math.round(d/22.5)%16];
async function renderPlan(){const p=PORTS.find(x=>x.id===$('plPort').value)||PORTS[1];LS.set('port',p.id);const ds=$('plDay').value||TODAY;
  renderBar(p,null);$('plVerdict').innerHTML='Loading forecast…';$('plHours').innerHTML='';
  let wx;try{wx=await getWx(p);}catch(e){$('plVerdict').innerHTML='<span class="no">Forecast unavailable (offline?).</span> '+esc(e.message);return;}
  renderBar(p,wx.tide,ds);
  const t0=dayStart(ds,TZ),ev=events(ds,p.lat,p.lon);const fl=ev.civil.filter(x=>x.rising&&ymd(x.t,TZ)===ds)[0],dk=ev.civil.filter(x=>!x.rising&&ymd(x.t,TZ)===ds)[0];
  const tA=fl?fl.t:t0+5*HR,tB=dk?dk.t:t0+19*HR;
  const hrs=wx.H.filter(h=>h.t>=t0&&h.t<t0+24*HR).map(h=>Object.assign(h,hourStatus(h)));
  if(!hrs.length){$('plVerdict').innerHTML='No forecast for that day yet.';return;}
  const marks=allMarks().map(m=>Object.assign({},m,{d:nm(p,m)})).filter(m=>m.d<=LIM.range);
  await loadMarkTides(marks);
  const best=hr=>{let b=null;for(const m of marks){const r=scoreAt(m.lat,m.lon,hr.t,TIDES[m.id]);if(r.score!=null&&(!b||r.score>b.r.score))b={m,r};}return b;};
  const day=hrs.filter(h=>h.t>=tA-HR&&h.t<=tB);
  // maximal runs of non-no-go daylight hours, valued by go-ness x best reachable score
  let runs=[],cur=null;for(const h of day){if(h.s<2){if(!cur)cur={h:[]};cur.h.push(h);}else if(cur){runs.push(cur);cur=null;}}if(cur)runs.push(cur);
  for(const r of runs){r.val=0;for(const h of r.h){h.best=h.best||best(h);r.val+=(h.s===0?1:.55)*(h.best?h.best.r.score:40);}}
  runs.sort((a,b)=>b.val-a.val);const R=runs[0];
  const go=hrs.filter(h=>h.t>=tA&&h.t<=tB);const nGo=go.filter(h=>h.s===0).length,nNo=go.filter(h=>h.s===2).length;
  const verdict=nGo>=6?['go','GO']:nNo>=go.length-2?['no','NO-GO']:['cau','MARGINAL'];
  let plan='';
  if(R&&R.h.length>=3){const a=R.h[0].t,b=R.h[R.h.length-1].t+HR;
    // pick the top mark within the window (score at its best hour that leaves time to get there and back)
    let pick=null;for(const h of R.h){const bb=h.best;if(!bb)continue;const run=bb.m.d/LIM.speed*HR;if(h.t-run<a-HR*0.01||h.t+run>b)continue;if(!pick||bb.r.score>pick.r.score)pick=Object.assign({h},bb);}
    if(!pick){const h=R.h[Math.floor(R.h.length/2)];pick=h.best?Object.assign({h},h.best):null;}
    const sug=marks.map(m=>({m,r:scoreAt(m.lat,m.lon,pick?pick.h.t:a,TIDES[m.id])})).filter(x=>x.r.score!=null).sort((x,y)=>y.r.score-x.r.score).slice(0,3);
    const run=pick?pick.m.d/LIM.speed*HR:0;const leave=pick?Math.max(a,pick.h.t-run-1.5*HR):a; /* arrive ~1.5 h before the peak to troll the area into it */
    const ebb=wx.tide?ebbWindows(wx.tide,t0):[];const ebbHit=ebb.find(e=>leave>=e.a&&leave<=e.b);
    plan=`<p><b>Best window:</b> ${fmtT(a)}–${fmtT(b)} (${R.h.length} h without a no-go hour)</p>
      <p><b>Run out (leave port):</b> ${fmtT(leave)}${pick?` → reach <b>${esc(pick.m.name)}</b> (${pick.m.d.toFixed(0)} nm, ${Math.round(brg(p,pick.m))}°T, ~${(run/HR).toFixed(1)} h at ${LIM.speed} kn) to troll into its peak at ${fmtT(pick.h.t)}`:''}.<br><b>Head home by:</b> ${fmtT(b-(pick?run:0))}.</p>
      ${ebbHit?`<p class="cau">⚠ ${fmtT(leave)} falls on the run-out (ebb) tide at the entrance (${fmtT(ebbHit.a)}–${fmtT(ebbHit.b)}). Bars are worst on the ebb, so think about leaving earlier or later.</p>`:''}
      <p><b>Suggested marks:</b></p><ul class="list">${sug.map(x=>`<li><span class="pill" style="background:${scoreColor(x.r.score)}">${Math.round(x.r.score)}</span> ${x.m.pub?'':'🔒 '}${esc(x.m.name)} <span class="mut small">${x.m.d.toFixed(0)} nm ${dir16(brg(p,x.m))}</span></li>`).join('')}</ul>`;}
  else plan='<p>No usable daylight window within your limits. Stay home or pick another day.</p>';
  const mx=hrs.reduce((a,h)=>h.wind>a.wind?h:a,hrs[0]);const mw=hrs.reduce((a,h)=>(h.wave||0)>(a.wave||0)?h:a,hrs[0]);
  $('plVerdict').innerHTML=`<div class="row" style="align-items:center"><span class="pill ${verdict[0]}" style="background:${verdict[0]==='go'?'#1d7a45':verdict[0]==='no'?'#7a2323':'#8a6a12'};font-size:18px">${verdict[1]}</span><div class="grow small mut">Peak wind ${Math.round(mx.wind)} kn ${dir16(mx.dir)} (gusts ${Math.round(mx.gust)}) at ${fmtT(mx.t)} · max sea ${mw.wave!=null?mw.wave.toFixed(1)+' m':'–'} · swell ${hrs[8]&&hrs[8].swell!=null?hrs[8].swell.toFixed(1)+' m @ '+Math.round(hrs[8].per)+' s '+dir16(hrs[8].sdir):'–'}</div></div>${plan}
    <p class="small mut">Forecast from Open-Meteo (ECMWF/GFS/BoM ACCESS blend and wave models) for open water off ${esc(p.name)}. Check the official <a href="${p.bom}" target="_blank" rel="noopener">BoM coastal waters forecast</a> and warnings before you go.</p>`;
  $('plHours').innerHTML='<div class="small mut" style="margin-bottom:4px">Hourly (kn wind / m sea). Green = go, amber = caution, red = no-go, faded = dark.</div><div class="hrs">'+hrs.filter((h,i)=>i>=3&&i<=20).map(h=>`<div class="hr ${['go','cau','no'][h.s]} ${h.t<tA-HR/2||h.t>tB?'dark':''}" title="${esc(h.why.join(', '))}">${fmtT(h.t).replace(':00','')}<b>${Math.round(h.wind)}</b>${h.wave!=null?h.wave.toFixed(1):'–'}</div>`).join('')+'</div>';}
function ebbWindows(tide,t0){const out=[];const e=tide.ext;for(let i=0;i<e.length-1;i++)if(e[i].high&&!e[i+1].high&&e[i+1].t>t0-6*HR&&e[i].t<t0+30*HR)out.push({a:e[i].t,b:e[i+1].t});return out;}
function renderBar(p,tide,ds){let h=`<p>${esc(p.bar)}</p>`;
  if(tide&&ds){const t0=dayStart(ds,TZ);const ex=tide.ext.filter(x=>x.t>=t0&&x.t<t0+24*HR);h+=`<p><b>Tides at the entrance (model):</b> ${ex.map(x=>(x.high?'High ':'Low ')+fmtT(x.t)).join(' · ')||'–'}<br><b>Run-out (ebb):</b> ${ebbWindows(tide,t0).filter(w=>w.b>t0&&w.a<t0+24*HR).map(w=>fmtT(w.a)+'–'+fmtT(w.b)).join(', ')||'–'}</p><p class="small mut">Model sea level from Open-Meteo, not an official tide table. Times can be out by 30 min or more, so check the MSQ tide tables.</p>`;}
  h+=`<p><a href="https://www.msq.qld.gov.au/safety/crossing-a-bar" target="_blank" rel="noopener">MSQ: crossing a coastal bar</a> · <a href="${p.bom}" target="_blank" rel="noopener">BoM coastal waters forecast</a> · <a href="https://www.bom.gov.au/qld/warnings/" target="_blank" rel="noopener">BoM warnings</a> · <a href="https://www.msq.qld.gov.au/tides" target="_blank" rel="noopener">MSQ tide tables</a></p>`;
  if(p.links)h+='<p>'+p.links.map(l=>`<a href="${l[1]}" target="_blank" rel="noopener">${esc(l[0])}</a>`).join('<br>')+'</p>';
  h+='<p class="small mut">Wide Bay Bar advice: the BoM forecast for Fraser Island Coast covers the bar waters. MSQ notices to mariners give current depths and navaids. Tin Can Bay Coast Guard has live bar conditions.</p>';
  $('plBar').innerHTML=h;}
function initLimits(){const map={lmSpeed:'speed',lmRange:'range',lmWind:'wind',lmWindX:'windX',lmGust:'gust',lmWave:'wave',lmWaveX:'waveX',lmPer:'per'};
  for(const id in map){$(id).value=LIM[map[id]];$(id).onchange=()=>{const v=parseFloat($(id).value);if(!isNaN(v)){LIM[map[id]]=v;LS.set('limits',LIM);renderPlan();}};}}

/* ---------------- marks tab ---------------- */
function renderMarks(){$('mkList').innerHTML=MARKS.map((m,i)=>`<li><div class="row" style="align-items:center"><div class="grow"><div class="nm">🔒 ${esc(m.name)}</div><div class="mut small">${m.lat.toFixed(5)}, ${m.lon.toFixed(5)} · ${m.depth?m.depth+' m · ':''}${esc(m.type)}</div></div><button onclick="goMark(${i})">Map</button><button onclick="delMark(${i})" aria-label="Delete">🗑</button></div></li>`).join('')||'<li class="mut">No private marks yet.</li>';
  $('fadList').innerHTML=`<p class="small mut">From the <a href="${window.FADS.url}" target="_blank" rel="noopener">Queensland Government FAD list</a> (${esc(window.FADS.licence)}). FADs move or go missing, so check the list before you go. Not for navigation.</p><table>`+FADS.map(f=>`<tr><td>${esc(f.name)}</td><td>${f.lat.toFixed(4)}, ${f.lon.toFixed(4)}</td><td>${f.depth||''} m</td></tr>`).join('')+'</table>';}
window.goMark=i=>{const m=MARKS[i];show('map');setTimeout(()=>{MAP.setView([m.lat,m.lon],10);pointPopup(m.lat,m.lon);},100);};
window.delMark=i=>{if(confirm('Delete mark "'+MARKS[i].name+'"?')){MARKS.splice(i,1);LS.set('marks',MARKS);renderMarks();drawMarks();}};
function initMarks(){
  $('mkGps').onclick=()=>navigator.geolocation&&navigator.geolocation.getCurrentPosition(p=>{$('mkLat').value=p.coords.latitude.toFixed(5);$('mkLon').value=p.coords.longitude.toFixed(5);},e=>alert('GPS: '+e.message),{enableHighAccuracy:true});
  $('mkAdd').onclick=()=>{const lat=parseCoord($('mkLat').value,true),lon=parseCoord($('mkLon').value,false);const name=$('mkName').value.trim()||'Mark '+(MARKS.length+1);
    if(lat==null||lon==null||Math.abs(lat)>90||Math.abs(lon)>180){alert('Check the lat/lon');return;}
    MARKS.push({id:'m'+Date.now(),name,lat,lon,depth:parseInt($('mkDepth').value)||null,type:$('mkType').value});LS.set('marks',MARKS);
    ['mkName','mkLat','mkLon','mkDepth'].forEach(id=>$(id).value='');renderMarks();drawMarks();fillLogMarks();};
  $('mkExport').onclick=()=>download('macs-marlin-marks.json',JSON.stringify(MARKS,null,1),'application/json');
  $('mkImport').onchange=e=>readJson(e,a=>{if(!Array.isArray(a))throw Error('not a list');for(const m of a)if(typeof m.lat==='number'&&typeof m.lon==='number'&&!MARKS.some(x=>x.id===m.id))MARKS.push({id:m.id||'m'+Date.now()+Math.random(),name:String(m.name||'Mark'),lat:m.lat,lon:m.lon,depth:m.depth||null,type:m.type||'other'});LS.set('marks',MARKS);renderMarks();drawMarks();});}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;document.body.appendChild(a);a.click();setTimeout(()=>{URL.revokeObjectURL(a.href);a.remove();},500);}
function readJson(e,cb){const f=e.target.files[0];if(!f)return;f.text().then(t=>{try{cb(JSON.parse(t));alert('Imported');}catch(x){alert('Import failed: '+x.message);}});e.target.value='';}

/* ---------------- catch log ---------------- */
let CATCH=LS.get('catches',[]);
function fillLogMarks(){$('lgMark').innerHTML='<option value="">— GPS / not set —</option>'+allMarks().map(m=>`<option value="${esc(m.id)}">${m.pub?'':'🔒 '}${esc(m.name)}</option>`).join('');}
function localInput(t){const p=tzParts(t,TZ),z=n=>String(n).padStart(2,'0');return`${p.y}-${z(p.mo)}-${z(p.d)}T${z(p.h)}:${z(p.mi)}`;}
function initLog(){$('lgWhen').value=localInput(Date.now());fillLogMarks();
  const fillSst=(lat,lon)=>{const s=near('sst',lat,lon);if(s!=null)$('lgSst').value=s.toFixed(1);const d=near('depth',lat,lon,1);if(d>0&&!$('lgDepth').value)$('lgDepth').value=Math.round(d);};
  $('lgMark').onchange=()=>{const m=allMarks().find(x=>x.id===$('lgMark').value);if(m){fillSst(m.lat,m.lon);if(m.depth)$('lgDepth').value=m.depth;}};
  $('lgGps').onclick=()=>navigator.geolocation&&navigator.geolocation.getCurrentPosition(p=>{$('lgGps').dataset.lat=p.coords.latitude;$('lgGps').dataset.lon=p.coords.longitude;$('lgGps').textContent='📍 '+p.coords.latitude.toFixed(3)+', '+p.coords.longitude.toFixed(3);fillSst(p.coords.latitude,p.coords.longitude);},e=>alert('GPS: '+e.message),{enableHighAccuracy:true});
  $('lgAdd').onclick=()=>{const m=allMarks().find(x=>x.id===$('lgMark').value);const g=$('lgGps').dataset;const lat=m?m.lat:(g.lat?+g.lat:null),lon=m?m.lon:(g.lon?+g.lon:null);
    const w=$('lgWhen').value;const t=w?parseLocalIso(w,TZ):Date.now();
    CATCH.unshift({id:'c'+Date.now(),time:new Date(t).toISOString(),species:$('lgSp').value,outcome:$('lgOut').value,tag:$('lgTag').value.trim(),size:$('lgSize').value.trim(),lure:$('lgLure').value.trim(),mark:m?m.name:'',lat,lon,sst:parseFloat($('lgSst').value)||null,depth:parseInt($('lgDepth').value)||null,notes:$('lgNotes').value.trim(),score:lat!=null?Math.round(scoreAt(lat,lon,t,null).score||0)||null:null});
    LS.set('catches',CATCH);['lgTag','lgSize','lgNotes'].forEach(id=>$(id).value='');renderLog();};
  $('lgJson').onclick=()=>download('macs-marlin-catches.json',JSON.stringify(CATCH,null,1),'application/json');
  $('lgCsv').onclick=()=>{const cols=['time','species','outcome','tag','size','lure','mark','lat','lon','sst','depth','score','notes'];const q=v=>v==null?'':/[",\n]/.test(String(v))?'"'+String(v).replace(/"/g,'""')+'"':String(v);
    download('macs-marlin-catches.csv',cols.join(',')+'\n'+CATCH.map(c=>cols.map(k=>q(k==='time'?localInput(Date.parse(c.time)):c[k])).join(',')).join('\n'),'text/csv');};
  $('lgImport').onchange=e=>readJson(e,a=>{if(!Array.isArray(a))throw Error('not a list');for(const c of a)if(c.time&&!CATCH.some(x=>x.id===c.id))CATCH.push(c);CATCH.sort((x,y)=>y.time<x.time?-1:1);LS.set('catches',CATCH);renderLog();});}
window.delCatch=i=>{if(confirm('Delete this catch?')){CATCH.splice(i,1);LS.set('catches',CATCH);renderLog();}};
function renderLog(){const by={};CATCH.forEach(c=>by[c.species]=(by[c.species]||0)+1);const tagged=CATCH.filter(c=>/tag/.test(c.outcome)).length;
  const ss=CATCH.map(c=>c.sst).filter(x=>x!=null);
  $('lgStats').innerHTML=CATCH.length?`<b>${CATCH.length}</b> fish · ${Object.entries(by).map(([k,v])=>v+' '+esc(k)).join(', ')} · ${tagged} tagged${ss.length?` · SST ${Math.min(...ss).toFixed(1)}–${Math.max(...ss).toFixed(1)} °C`:''}`:'<span class="mut">No catches logged yet.</span>';
  $('lgList').innerHTML=CATCH.map((c,i)=>`<li><details><summary><div class="grow"><div class="nm">${esc(c.species)} · ${esc(c.outcome)}</div><div class="mut small">${fmtD(Date.parse(c.time))} ${fmtT(Date.parse(c.time))}${c.mark?' · '+esc(c.mark):''}${c.sst?' · '+c.sst+'°C':''}</div></div></summary>
    <p class="small">${c.size?'Size: '+esc(c.size)+'<br>':''}${c.lure?'Lure/bait: '+esc(c.lure)+'<br>':''}${c.tag?'Tag: '+esc(c.tag)+'<br>':''}${c.lat!=null?'Pos: '+c.lat.toFixed(4)+', '+c.lon.toFixed(4)+'<br>':''}${c.depth?'Depth: '+c.depth+' m<br>':''}${c.score?'Bite score then: '+c.score+'<br>':''}${c.notes?esc(c.notes):''}</p><button onclick="delCatch(${i})">🗑 Delete</button></details></li>`).join('');}

/* ---------------- boot ---------------- */
function srcList(){const s=OC?OC.meta.sources:{},e=OC?OC.meta.errors:{};const a=(u,t)=>`<a href="${u}" target="_blank" rel="noopener">${t}</a>`;
  $('srcList').innerHTML=`<ul class="small">
  <li><b>Sea surface temperature:</b> NASA JPL MUR SST v4.1 (GHRSST L4, ~1 km, daily), served by ${a('https://coastwatch.pfeg.noaa.gov/erddap/griddap/jplMURSST41.html','NOAA CoastWatch ERDDAP')}. ${s.sst?'Analysis '+esc(s.sst.time.slice(0,10)):'<span class="no">unavailable</span>'}${s.sst&&s.sst.stale?' (stale copy)':''}.</li>
  <li><b>Temperature breaks:</b> computed here from the MUR SST gradient (≥ 0.03 °C/km).</li>
  <li><b>Currents and eddies:</b> ${a('https://oceancurrent.aodn.org.au/','IMOS OceanCurrent')} gridded sea level anomaly (GSLA NRT) and geostrophic currents, via ${a('https://thredds.aodn.org.au/thredds/catalog/IMOS/OceanCurrent/GSLA/NRT/catalog.html','AODN THREDDS')}. IMOS is supported by the Australian Government through NCRIS (CC BY 4.0). ${s.cur?esc(s.cur.time):'<span class="no">unavailable</span>'}.</li>
  <li><b>Chlorophyll / ocean colour:</b> ${s.chl?esc(s.chl.url.replace(/^.*griddap\//,'')):'unavailable'}, via ${a('https://coastwatch.pfeg.noaa.gov/erddap/','NOAA CoastWatch ERDDAP')}. ${s.chl?esc(s.chl.time.slice(0,10)):''}</li>
  <li><b>Bathymetry:</b> NOAA NCEI ETOPO1 (1 arc-minute), via ${a('https://coastwatch.pfeg.noaa.gov/erddap/griddap/etopo180.html','ERDDAP etopo180')}. Contours computed here. Not for navigation.</li>
  <li><b>Public FADs:</b> ${a(window.FADS.url,'Queensland Government FAD list')}.</li>
  <li><b>Weather, waves and model sea level:</b> ${a('https://open-meteo.com/','Open-Meteo')} (CC BY 4.0).</li>
  <li><b>Basemap:</b> Esri World Ocean Base. <b>Map library:</b> Leaflet.</li>
  <li><b>Skipped:</b> Copernicus Marine (needs a login).</li></ul>
  ${Object.keys(e).length?'<p class="no small">Last refresh errors: '+esc(JSON.stringify(e))+'</p>':''}<p class="small mut">Ocean data refreshed by a GitHub Action twice daily. Built ${esc(OC?OC.meta.built:'')} UTC · app ${window.BUILD}</p>`;}
async function boot(){
  fillDays($('scDay'));fillDays($('plDay'));$('scDay').onchange=renderScore;$('scWhich').onchange=renderScore;
  $('plPort').innerHTML=PORTS.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('');$('plPort').value=LS.get('port','bh');$('plPort').onchange=renderPlan;$('plDay').onchange=renderPlan;
  initLimits();initMarks();renderMethod();initMap();drawMarks();
  try{const [o,b]=await Promise.all([fetch('data/ocean.json').then(r=>r.json()),fetch('data/bathy.json').then(r=>r.json())]);OC=o;G=o.meta.grid;drawBathy(b);}catch(e){$('dataAge').textContent='Ocean data unavailable';console.warn(e);}
  if(OC){$('dataAge').textContent='SST '+ageTxt('sst');drawVectors();drawShade();}
  srcList();initLog();renderLog();
  const h=location.hash.slice(1);if(['score','plan','marks','log'].includes(h))show(h);
}
boot();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('sw.js',{scope:'./'}).catch(()=>{});
