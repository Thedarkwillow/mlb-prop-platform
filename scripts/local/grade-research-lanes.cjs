const fs = require("fs");

const DATE=process.env.npm_config_date||process.env.DATE||new Date().toISOString().slice(0,10);

function read(file,f=null){ try{return JSON.parse(fs.readFileSync(file,"utf8"));}catch{return f;} }
function write(file,data){ fs.mkdirSync(require("path").dirname(file),{recursive:true}); fs.writeFileSync(file,JSON.stringify(data,null,2)+"\n"); }
function text(file,data){ fs.mkdirSync(require("path").dirname(file),{recursive:true}); fs.writeFileSync(file,data); }
function s(v){ return String(v??"").trim(); }
function n(v){ const x=Number(v); return Number.isFinite(x)?x:null; }
function norm(v){ return s(v).normalize("NFD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim().replace(/\s+/g," "); }

function scoreBatting(b){
  const hits=n(b.hits)||0, doubles=n(b.doubles)||0, triples=n(b.triples)||0, hr=n(b.homeRuns)||0;
  const singles=Math.max(0,hits-doubles-triples-hr);
  const runs=n(b.runs)||0, rbi=n(b.rbi)||0, walks=n(b.baseOnBalls)||0, hbp=n(b.hitByPitch)||0, sb=n(b.stolenBases)||0;
  return {
    singles,doubles,triples,hr,runs,rbi,walks,hbp,sb,
    hrr:hits+runs+rbi,
    hitter_fantasy_score:singles*3+doubles*5+triples*8+hr*10+runs*2+rbi*2+walks*2+hbp*2+sb*5
  };
}

async function getJson(url){
  const res=await fetch(url);
  if(!res.ok) throw new Error(`${res.status} ${url}`);
  return await res.json();
}

function grade(row, actual){
  const ln=n(row.line);
  const sd=s(row.side).toUpperCase();
  if(actual===null||actual===undefined||ln===null) return "UNMATCHED";
  if(sd==="MORE") return actual>ln?"HIT":actual<ln?"MISS":"PUSH";
  if(sd==="LESS") return actual<ln?"HIT":actual>ln?"MISS":"PUSH";
  return "UNMATCHED";
}

async function main(){
  const snapshot=read(`outputs/history/${DATE}-research-lanes-snapshot.json`);
  if(!snapshot) throw new Error(`missing snapshot outputs/history/${DATE}-research-lanes-snapshot.json`);

  const targets=[];
  for(const [lane,obj] of Object.entries(snapshot.lanes||{})){
    for(const r of obj.rows||[]) targets.push({...r,lane});
  }

  const schedule=await getJson(`https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=${DATE}`);
  const games=(schedule.dates||[]).flatMap(d=>d.games||[]);
  const playerStats=new Map();

  for(const g of games){
    const box=await getJson(`https://statsapi.mlb.com/api/v1/game/${g.gamePk}/boxscore`);
    for(const side of ["home","away"]){
      const players=box.teams?.[side]?.players||{};
      for(const p of Object.values(players)){
        const name=p.person?.fullName||"";
        if(!name) continue;
        playerStats.set(norm(name),{gamePk:g.gamePk,team:box.teams?.[side]?.team?.abbreviation||"",batting:p.stats?.batting||{},score:scoreBatting(p.stats?.batting||{})});
      }
    }
  }

  const graded=targets.map(r=>{
    const st=playerStats.get(norm(r.player));
    const m=r.market;
    const actual=st ? st.score[m] : null;
    return {...r,actual,result:grade(r,actual),gamePk:st?.gamePk||null,mlbTeam:st?.team||"",scoring:st?.score||null};
  });

  const byLane={};
  for(const r of graded){
    byLane[r.lane] ||= {count:0,hit:0,miss:0,push:0,unmatched:0,rows:[]};
    const x=byLane[r.lane];
    x.count++;
    if(r.result==="HIT") x.hit++;
    else if(r.result==="MISS") x.miss++;
    else if(r.result==="PUSH") x.push++;
    else x.unmatched++;
    x.rows.push(r);
  }

  const out={date:DATE,gradedAt:new Date().toISOString(),byLane,rows:graded};
  write(`outputs/history/${DATE}-research-lanes-graded.json`,out);

  const lines=[];
  lines.push(`RESEARCH LANES GRADED ${DATE}`);
  lines.push("==============================");
  for(const [lane,x] of Object.entries(byLane)){
    lines.push("");
    lines.push(`${lane}: count=${x.count} hit=${x.hit} miss=${x.miss} push=${x.push} unmatched=${x.unmatched}`);
    for(const r of x.rows.slice(0,50)){
      lines.push(`${r.player} | ${r.team} | ${r.market} ${r.side} ${r.line} | actual=${r.actual} | ${r.result}`);
    }
  }
  text(`outputs/history/${DATE}-research-lanes-graded.txt`,lines.join("\n")+"\n");
  text("outputs/research-lanes-graded-latest.txt",lines.join("\n")+"\n");
  console.log({date:DATE,lanes:Object.fromEntries(Object.entries(byLane).map(([k,v])=>[k,{count:v.count,hit:v.hit,miss:v.miss,push:v.push,unmatched:v.unmatched}]))});
}

main().catch(e=>{console.error(e);process.exit(1);});
