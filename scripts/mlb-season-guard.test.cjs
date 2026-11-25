'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{check,guard}=require('./mlb-season-guard.cjs');
const now=new Date('2026-11-25T10:00:00Z');
const fake=d=>async()=>new Response(JSON.stringify(d));
test('no upcoming games or failure never calls live provider',async()=>{
 let calls=0;
 for(const client of [fake({totalGames:0,dates:[]}),async()=>{throw Error('timeout')},fake({totalGames:1,dates:[]})]){
 const r=await guard({now,client},()=>{calls++});assert.equal(r.providerCalls,0);
 }assert.equal(calls,0);
});
test('scheduled competition automatically resumes, with separate phase',async()=>{
 let calls=0;const r=await guard({now,client:fake({totalGames:1,dates:[{games:[{gamePk:1,gameDate:'2026-11-25T19:00:00Z',gameType:'S',status:{abstractGameState:'Preview'}}]}]})},()=>{calls++});
 assert.equal(calls,1);assert.equal(r.status,'Active');assert.deepEqual(r.phases,['preseason']);assert.equal(r.modelPromotionAllowed,false);
});
