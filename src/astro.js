/* Sun/moon/solunar + time helpers: copied from Mac's Jacks (JonathanAgronica/fishing-apps, mangrove-jack core). */
const PI=Math.PI, sin=Math.sin, cos=Math.cos, tan=Math.tan, asin=Math.asin, atan=Math.atan2, acos=Math.acos, rad=PI/180;
const dayMs=864e5, J1970=2440588, J2000=2451545, e=rad*23.4397;
const toDays=ms=>ms/dayMs-0.5+J1970-J2000;
const ra_=(l,b)=>atan(sin(l)*cos(e)-tan(b)*sin(e),cos(l));
const dec_=(l,b)=>asin(sin(b)*cos(e)+cos(b)*sin(e)*sin(l));
const alt_=(H,phi,dec)=>asin(sin(phi)*sin(dec)+cos(phi)*cos(dec)*cos(H));
const sidereal=(d,lw)=>rad*(280.16+360.9856235*d)-lw;
function refraction(h){if(h<0)h=0;return 0.0002967/tan(h+0.00312536/(h+0.08901179));}
function sunCoords(d){const M=rad*(357.5291+0.98560028*d);const C=rad*(1.9148*sin(M)+0.02*sin(2*M)+0.0003*sin(3*M));const L=M+C+rad*102.9372+PI;return{dec:dec_(L,0),ra:ra_(L,0)};}
function moonCoords(d){const L=rad*(218.316+13.176396*d),M=rad*(134.963+13.064993*d),F=rad*(93.272+13.229350*d);const l=L+rad*6.289*sin(M),b=rad*5.128*sin(F),dt=385001-20905*cos(M);return{ra:ra_(l,b),dec:dec_(l,b),dist:dt};}
function sunAlt(ms,lat,lng){const d=toDays(ms),c=sunCoords(d);return alt_(sidereal(d,rad*-lng)-c.ra,rad*lat,c.dec)/rad;}
function moonPos(ms,lat,lng){const d=toDays(ms),c=moonCoords(d);const H=sidereal(d,rad*-lng)-c.ra;let h=alt_(H,rad*lat,c.dec);h+=refraction(h);return{alt:h/rad,H:Math.atan2(sin(H),cos(H))};}
function moonIllum(ms){const d=toDays(ms),s=sunCoords(d),m=moonCoords(d),sd=149598000;const phi=acos(sin(s.dec)*sin(m.dec)+cos(s.dec)*cos(m.dec)*cos(s.ra-m.ra));const inc=atan(sd*sin(phi),m.dist-sd*cos(phi));const ang=atan(cos(s.dec)*sin(s.ra-m.ra),sin(s.dec)*cos(m.dec)-cos(s.dec)*sin(m.dec)*cos(s.ra-m.ra));return{fraction:(1+cos(inc))/2,phase:0.5+0.5*inc*(ang<0?-1:1)/PI};}

/* --- timezone helpers (Intl based, DST-safe) --- */
const dtfCache={};
function tzParts(ms,tz){let f=dtfCache[tz];if(!f)f=dtfCache[tz]=new Intl.DateTimeFormat('en-US',{timeZone:tz,hourCycle:'h23',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit'});const p={};for(const x of f.formatToParts(new Date(ms)))p[x.type]=x.value;return{y:+p.year,mo:+p.month,d:+p.day,h:+p.hour%24,mi:+p.minute,s:+p.second};}
function tzOffsetMs(ms,tz){const p=tzParts(ms,tz);return Date.UTC(p.y,p.mo-1,p.d,p.h,p.mi,p.s)-Math.floor(ms/1000)*1000;}
/* UTC ms for local wall time y-m-d h:mi in tz */
function localToUtc(y,mo,d,h,mi,tz){const guess=Date.UTC(y,mo-1,d,h,mi||0);let o=tzOffsetMs(guess,tz);let t=guess-o;const o2=tzOffsetMs(t,tz);if(o2!==o)t=guess-o2;return t;}
function parseLocalIso(s,tz){const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)/.exec(s);return localToUtc(+m[1],+m[2],+m[3],+m[4],+m[5],tz);}
function ymd(ms,tz){const p=tzParts(ms,tz);return p.y+'-'+String(p.mo).padStart(2,'0')+'-'+String(p.d).padStart(2,'0');}
function addDays(dateStr,n){const [y,m,d]=dateStr.split('-').map(Number);const t=new Date(Date.UTC(y,m-1,d+n));return t.toISOString().slice(0,10);}
function dayStart(dateStr,tz){const [y,m,d]=dateStr.split('-').map(Number);return localToUtc(y,m,d,0,0,tz);}

/* --- sun/moon events by sampling (robust for any timezone) --- */
function crossings(fn,t0,t1,step,level){const out=[];let pt=t0,pv=fn(t0)-level;for(let t=t0+step;t<=t1;t+=step){const v=fn(t)-level;if((pv<0)!==(v<0)){let a=pt,b=t,fa=pv;for(let i=0;i<20;i++){const m=(a+b)/2,fm=fn(m)-level;if((fa<0)===(fm<0)){a=m;fa=fm}else b=m;}out.push({t:(a+b)/2,rising:v>pv});}pt=t;pv=v;}return out;}
function sunMoonEvents(t0,t1,lat,lng){
  const step=10*60e3;
  const sa=t=>sunAlt(t,lat,lng);
  const ev={sun:{},moon:{}};
  ev.sunRiseSet=crossings(sa,t0,t1,step,-0.833);
  ev.civil=crossings(sa,t0,t1,step,-6);
  ev.nautical=crossings(sa,t0,t1,step,-12);
  const ma=t=>moonPos(t,lat,lng).alt;
  ev.moonRiseSet=crossings(ma,t0,t1,step,0.133);
  // transits: hour angle crosses 0 (overhead) or ±pi (underfoot)
  ev.transits=[];
  const hs=t=>Math.sin(moonPos(t,lat,lng).H);
  for(const c of crossings(hs,t0,t1,step,0)){const H=moonPos(c.t,lat,lng).H;ev.transits.push({t:c.t,over:Math.abs(H)<PI/2,alt:moonPos(c.t,lat,lng).alt});}
  return ev;
}

/* --- interpolation of hourly series --- */
function makeSeries(times,vals){ // times ms sorted, vals may contain null
  return function(t){const n=times.length;if(!n||t<times[0]-3600e3||t>times[n-1]+3600e3)return null;
    let i=Math.floor((t-times[0])/3600e3);i=Math.max(0,Math.min(n-2,i));
    while(i>0&&times[i]>t)i--;while(i<n-2&&times[i+1]<t)i++;
    const p0=vals[Math.max(0,i-1)],p1=vals[i],p2=vals[i+1],p3=vals[Math.min(n-1,i+2)];
    if(p1==null&&p2==null)return null;if(p1==null)return p2;if(p2==null)return p1;
    const u=Math.max(0,Math.min(1,(t-times[i])/(times[i+1]-times[i])));
    if(p0==null||p3==null)return p1+(p2-p1)*u;
    return 0.5*((2*p1)+(-p0+p2)*u+(2*p0-5*p1+4*p2-p3)*u*u+(-p0+3*p1-3*p2+p3)*u*u*u);};
}
function tideExtremes(tideFn,t0,t1){const step=6*60e3,out=[];let a=tideFn(t0),b=tideFn(t0+step);for(let t=t0+2*step;t<=t1;t+=step){const c=tideFn(t);if(a==null||b==null||c==null){a=b;b=c;continue;}
  if((b>a&&b>=c)||(b<a&&b<=c)){const den=a-2*b+c;const off=den!==0?0.5*(a-c)/den:0;const tm=t-step+off*step;out.push({t:tm,h:tideFn(tm),high:b>a});}a=b;b=c;}
  // drop tiny wiggles
  const f=[];for(const x of out){const l=f[f.length-1];if(l&&l.high===x.high){if((x.high&&x.h>l.h)||(!x.high&&x.h<l.h))f[f.length-1]=x;}else if(l&&Math.abs(l.h-x.h)<0.08){f.pop();}else f.push(x);}return f;}

const clamp=(x,a=0,b=1)=>Math.max(a,Math.min(b,x));
const lerp=(x,x0,x1,y0,y1)=>y0+(y1-y0)*clamp((x-x0)/(x1-x0));
function solunarFactor(t,ev){let best={v:0,label:''};
  for(const x of ev.transits){const dh=Math.abs(t-x.t)/3600e3;const v=dh<=1?1:dh<1.6?lerp(dh,1,1.6,1,0):0;if(v>best.v)best={v,label:'Major solunar (moon '+(x.over?'overhead':'underfoot')+')',ev:x,major:true};}
  for(const x of ev.moonRiseSet){const dh=Math.abs(t-x.t)/3600e3;const v=dh<=0.5?0.7:dh<0.9?lerp(dh,0.5,0.9,0.7,0):0;if(v>best.v)best={v,label:'Minor solunar ('+(x.rising?'moonrise':'moonset')+')',ev:x,major:false};}
  return best;}
function moonPhaseFactor(phase){const d=Math.min(phase,Math.abs(phase-0.5),1-phase);return clamp(1-d/0.25);} // 1 at new/full, 0 at quarters
function phaseName(p){const n=['New moon','Waxing crescent','First quarter','Waxing gibbous','Full moon','Waning gibbous','Last quarter','Waning crescent'];return n[Math.floor(((p+1/16)%1)*8)];}
function phaseEmoji(p,lat){const e=['🌑','🌒','🌓','🌔','🌕','🌖','🌗','🌘'];let i=Math.floor(((p+1/16)%1)*8);if(lat<0&&i%4)i=8-i;return e[i];}
