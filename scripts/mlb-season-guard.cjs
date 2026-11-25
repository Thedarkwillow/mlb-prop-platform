'use strict';
const phases={S:'preseason',R:'regular',F:'playoffs',D:'playoffs',L:'playoffs',W:'playoffs',P:'playoffs'};
async function check({now=new Date(),client=fetch}={}){
 const day=t=>t.toISOString().slice(0,10),end=new Date(+now+48*3600000);
 const startDate=day(now),endDate=day(end);
 try{
  const res=await client('https://statsapi.mlb.com/api/v1/schedule?sportId=1&startDate='+startDate+'&endDate='+endDate,{signal:AbortSignal.timeout(10000),redirect:'error'});
  if(!res.ok)throw Error('schedule unavailable');
  const d=await res.json();
  if(!Array.isArray(d.dates)||!Number.isInteger(d.totalGames)||d.dates.some(x=>!Array.isArray(x.games)))throw Error('invalid schedule');
  const games=d.dates.flatMap(x=>x.games);
  if(games.length!==d.totalGames||games.some(g=>!Number.isSafeInteger(g.gamePk)||!Number.isFinite(Date.parse(g.gameDate))||typeof g.status?.abstractGameState!=='string'))throw Error('incomplete schedule');
  const upcoming=games.filter(g=>['Preview','Live'].includes(g.status.abstractGameState)&&Date.parse(g.gameDate)<=+end&&(Date.parse(g.gameDate)>=+now||g.status.abstractGameState==='Live'));
  const phasesSeen=[...new Set(upcoming.map(g=>phases[g.gameType]||'unknown'))];
  return {source:'mlb_official_schedule',observedAt:now.toISOString(),coverageUntil:end.toISOString(),status:upcoming.length?'Active':'No Upcoming Games',upcoming:upcoming.length,phases:phasesSeen,allowLive:upcoming.length>0,paidDiscoveryRequests:0,modelPromotionAllowed:false};
 }catch{return {source:'mlb_official_schedule',observedAt:now.toISOString(),status:'Schedule Unknown',upcoming:null,allowLive:false,paidDiscoveryRequests:0,modelPromotionAllowed:false};}
}
async function guard(options,run){const result=await check(options);if(!result.allowLive)return {...result,providerCalls:0};await run();return {...result,executed:true};}
module.exports={check,guard};
if(require.main===module)check().then(r=>{console.log(JSON.stringify(r));if(process.env.GITHUB_OUTPUT)require('node:fs').appendFileSync(process.env.GITHUB_OUTPUT,'allow_live='+r.allowLive+'\n');});
