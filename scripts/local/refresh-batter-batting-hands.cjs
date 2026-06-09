const fs = require("fs");
const path = require("path");

const CACHE_FILE = "data/context/player-batting-hands.json";

function read(file, fallback=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return fallback;} }
function writeJson(file,data){ fs.mkdirSync(path.dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function s(v){ return String(v ?? "").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function norm(v){
  return s(v)
    .normalize("NFD").replace(/[\u0300-\u036f]/g,"")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g,"")
    .trim();
}
function hand(v){
  const x=s(v).toUpperCase();
  if(x==="L"||x==="LEFT") return "L";
  if(x==="R"||x==="RIGHT") return "R";
  if(x==="S"||x==="SWITCH") return "S";
  return "";
}
function idOf(r){
  return n(
    r?.mlbId ??
    r?.mlbID ??
    r?.playerId ??
    r?.playerID ??
    r?.id ??
    r?.personId ??
    r?.mlb_player_id
  );
}
function playerOf(r){
  return s(r?.player || r?.playerName || r?.name || r?.fullName || r?.person?.fullName);
}
function teamOf(r, fallback=""){
  return s(r?.team || r?.teamAbbr || r?.playerTeam || r?.abbr || fallback).toUpperCase();
}
function addCandidate(map, r, fallbackTeam=""){
  const id=idOf(r);
  const player=playerOf(r);
  const team=teamOf(r, fallbackTeam);
  if(!id && !player) return;
  const key=id ? `id:${id}` : `name:${norm(player)}|${team}`;
  if(!map.has(key)) map.set(key,{id,player,team,sources:new Set()});
  const c=map.get(key);
  if(id && !c.id) c.id=id;
  if(player && !c.player) c.player=player;
  if(team && !c.team) c.team=team;
}

function collectCandidates(){
  const map=new Map();

  const lineup=read("data/context/lineups.json");
  if(lineup?.players && typeof lineup.players==="object"){
    for(const r of Object.values(lineup.players)) addCandidate(map,r);
  }
  if(Array.isArray(lineup?.rows)){
    for(const r of lineup.rows) addCandidate(map,r);
  }

  const pf=read("data/context/pickfinder-lineups.json");
  if(Array.isArray(pf?.rows)){
    for(const r of pf.rows) addCandidate(map,r);
  }
  if(Array.isArray(pf)){
    for(const r of pf) addCandidate(map,r);
  }

  const depth=read("data/context/confirmed-lineups-depth.json");
  if(depth?.teams && typeof depth.teams==="object"){
    for(const [team,obj] of Object.entries(depth.teams)){
      for(const group of ["starters","bench","players","lineup"]){
        if(Array.isArray(obj?.[group])){
          for(const r of obj[group]) addCandidate(map,r,team);
        }
      }
    }
  }

  const enriched=read("outputs/manual/pickfinder-current-context-enriched.json");
  if(Array.isArray(enriched?.rows)){
    for(const r of enriched.rows) addCandidate(map,r);
  }

  const board=read("outputs/priced-board.json",[]);
  if(Array.isArray(board)){
    for(const r of board) addCandidate(map,r);
  }

  return [...map.values()].filter(c=>c.id || c.player);
}

async function fetchPeople(ids){
  const byId={};
  const chunks=[];
  for(let i=0;i<ids.length;i+=100) chunks.push(ids.slice(i,i+100));

  for(const chunk of chunks){
    const url=`https://statsapi.mlb.com/api/v1/people?personIds=${chunk.join(",")}`;
    const res=await fetch(url);
    if(!res.ok) throw new Error(`MLB people fetch failed ${res.status}: ${url}`);
    const json=await res.json();
    for(const p of json.people||[]){
      const id=n(p.id);
      if(!id) continue;
      const battingHand=hand(p.batSide?.code || p.batSide?.description);
      const throwingHand=hand(p.pitchHand?.code || p.pitchHand?.description);
      byId[id]={
        mlbId:id,
        player:s(p.fullName),
        battingHand,
        throwingHand,
        batSide:p.batSide||null,
        pitchHand:p.pitchHand||null,
        source:"mlb_stats_people"
      };
    }
  }
  return byId;
}

function buildIndexes(cache){
  const byId=cache.playersById || {};
  const byNameTeam=cache.playersByNameTeam || {};
  const nameOnly={};
  const counts={};

  for(const [k,v] of Object.entries(byNameTeam)){
    const name=k.split("|")[0];
    counts[name]=(counts[name]||0)+1;
  }
  for(const [k,v] of Object.entries(byNameTeam)){
    const name=k.split("|")[0];
    if(counts[name]===1) nameOnly[name]=v;
  }
  for(const v of Object.values(byId)){
    const name=norm(v.player);
    if(name && !nameOnly[name]) nameOnly[name]=v;
  }
  return {byId,byNameTeam,nameOnly};
}

function lookup(r, idx, fallbackTeam=""){
  const id=idOf(r);
  if(id && idx.byId[String(id)]) return idx.byId[String(id)];

  const name=norm(playerOf(r));
  const team=teamOf(r, fallbackTeam);
  if(name && team && idx.byNameTeam[`${name}|${team}`]) return idx.byNameTeam[`${name}|${team}`];

  if(name && idx.nameOnly[name]) return idx.nameOnly[name];
  return null;
}

function applyHand(r, rec){
  if(!r || !rec || !rec.battingHand) return false;
  r.battingHand = rec.battingHand;
  r.hitterHand = rec.battingHand;
  r.hand = rec.battingHand;
  r.battingHandSource = rec.source || "player_batting_hands_cache";
  if(rec.throwingHand) r.throwingHand = rec.throwingHand;
  if(rec.mlbId && !idOf(r)) r.mlbId = rec.mlbId;
  return true;
}

function applyToFiles(cache){
  const idx=buildIndexes(cache);
  const touched={};

  function saveIfChanged(file, data, changed){
    if(changed>0){
      writeJson(file,data);
      touched[file]=changed;
    }
  }

  let file="data/context/lineups.json";
  let data=read(file);
  let changed=0;
  if(data?.players && typeof data.players==="object"){
    for(const r of Object.values(data.players)){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  }
  if(Array.isArray(data?.rows)){
    for(const r of data.rows){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  }
  if(data) saveIfChanged(file,data,changed);

  file="data/context/pickfinder-lineups.json";
  data=read(file);
  changed=0;
  if(Array.isArray(data?.rows)){
    for(const r of data.rows){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  } else if(Array.isArray(data)){
    for(const r of data){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  }
  if(data) saveIfChanged(file,data,changed);

  file="data/context/confirmed-lineups-depth.json";
  data=read(file);
  changed=0;
  if(data?.teams && typeof data.teams==="object"){
    for(const [team,obj] of Object.entries(data.teams)){
      for(const group of ["starters","bench","players","lineup"]){
        if(Array.isArray(obj?.[group])){
          for(const r of obj[group]){
            if(applyHand(r, lookup(r,idx,team))) changed++;
          }
        }
      }
    }
  }
  if(data) saveIfChanged(file,data,changed);

  file="outputs/manual/pickfinder-current-context-enriched.json";
  data=read(file);
  changed=0;
  if(Array.isArray(data?.rows)){
    for(const r of data.rows){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  }
  if(data) saveIfChanged(file,data,changed);

  file="outputs/priced-board.json";
  data=read(file);
  changed=0;
  if(Array.isArray(data)){
    for(const r of data){
      if(applyHand(r, lookup(r,idx))) changed++;
    }
  }
  if(data) saveIfChanged(file,data,changed);

  return touched;
}

async function main(){
  const candidates=collectCandidates();
  const ids=[...new Set(candidates.map(c=>c.id).filter(Boolean))];

  const oldCache=read(CACHE_FILE,{playersById:{},playersByNameTeam:{}});
  oldCache.playersById ||= {};
  oldCache.playersByNameTeam ||= {};

  const missingIds=ids.filter(id=>!oldCache.playersById[String(id)] || !oldCache.playersById[String(id)].battingHand);

  let fetched={};
  if(missingIds.length){
    fetched=await fetchPeople(missingIds);
  }

  const playersById={...oldCache.playersById};
  for(const [id,rec] of Object.entries(fetched)){
    playersById[String(id)]=rec;
  }

  const playersByNameTeam={...oldCache.playersByNameTeam};
  for(const c of candidates){
    let rec=null;
    if(c.id && playersById[String(c.id)]) rec=playersById[String(c.id)];
    if(!rec || !rec.battingHand) continue;
    const name=norm(c.player || rec.player);
    const team=s(c.team).toUpperCase();
    if(name && team) playersByNameTeam[`${name}|${team}`]=rec;
  }

  const cache={
    generatedAt:new Date().toISOString(),
    source:"MLB Stats API people endpoint + local lineup/player ids",
    candidateCount:candidates.length,
    idCount:ids.length,
    fetchedMissingIds:missingIds.length,
    playerCount:Object.keys(playersById).length,
    nameTeamCount:Object.keys(playersByNameTeam).length,
    playersById,
    playersByNameTeam
  };

  writeJson(CACHE_FILE,cache);
  const touched=applyToFiles(cache);

  console.log({
    candidateCount:candidates.length,
    idCount:ids.length,
    fetchedMissingIds:missingIds.length,
    playerCount:cache.playerCount,
    nameTeamCount:cache.nameTeamCount,
    touched
  });
}

main().catch(e=>{console.error(e);process.exit(1);});
