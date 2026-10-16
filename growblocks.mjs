#!/usr/bin/env node
// GrowBlocks CLI and MCP server: build, check and ship a Dev Kit game from the terminal or from an AI assistant.
// One file, no dependencies, Node 18+. It lives in the starter kit; the latest is https://growblocks.xyz/devkit/starter/growblocks.mjs
//
//   node growblocks.mjs login            sign in (opens the browser; you confirm a code)
//   node growblocks.mjs new my-game      a new game folder from the starter kit
//   node growblocks.mjs dev              serve this folder; play at http://localhost:5173/play.html
//   node growblocks.mjs check [--play]   the checker (check.mjs): static checks, then a headless play with a screenshot
//   node growblocks.mjs create <address> --name "My Game"    make the game on GrowBlocks and link this folder to it
//   node growblocks.mjs push             check, then upload this folder as a test build; prints its test link
//   node growblocks.mjs submit           send the test build to GrowBlocks for review
//   node growblocks.mjs mcp              the same, as an MCP server for Claude Code, Cursor and other assistants
//
// Money never goes through here: collections, coins, earnings and claims stay on growblocks.xyz/devkit.html.
import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import os from 'node:os';import {spawn} from 'node:child_process';import {fileURLToPath} from 'node:url';

const VERSION='1.2.0',DEFAULT_SITE='https://growblocks.xyz';
const CRED_FILE=path.join(os.homedir(),'.growblocks','credentials.json');
// The same rules as check.mjs and the server (server/devkit.cjs): what a build may hold, and what stays on your machine.
const TYPES=['js','mjs','json','css','txt','png','jpg','jpeg','webp','gif','svg','glb','gltf','bin','mp3','ogg','wav','woff2'];
const SKIP=/^(node_modules|\.git|\.vscode|\.idea|check-screenshot\.png|package-lock\.json)$/;
const LOCAL_ONLY=new Set(['play.html','check.mjs','package.json','jsconfig.json','gb.d.ts','AGENTS.md','CLAUDE.md','README.md','TERMS.md','llms.txt','growblocks.mjs','growblocks.json','growblocks.key']);
const LIMITS={files:200,fileBytes:3000000,buildBytes:30000000};
// The starter kit: [file in your folder, file on the GrowBlocks site]. Keep in step with src/devkit-portal.js.
const STARTER=[['game.js','devkit/starter/game.js'],['.gitignore','devkit/starter/gitignore'],['play.html','devkit/starter/play.html'],['AGENTS.md','devkit/starter/AGENTS.md'],['CLAUDE.md','devkit/starter/CLAUDE.md'],
 ['README.md','devkit/starter/README.md'],['TERMS.md','devkit/starter/TERMS.md'],['check.mjs','devkit/starter/check.mjs'],['package.json','devkit/starter/package.json'],['jsconfig.json','devkit/starter/jsconfig.json'],
 ['llms.txt','devkit/llms.txt'],['gb.d.ts','devkit/gb.d.ts'],['growblocks.mjs','devkit/starter/growblocks.mjs'],['.mcp.json','devkit/starter/mcp.json']];
const MIME={html:'text/html; charset=utf-8',js:'text/javascript; charset=utf-8',mjs:'text/javascript; charset=utf-8',json:'application/json',css:'text/css; charset=utf-8',txt:'text/plain; charset=utf-8',md:'text/plain; charset=utf-8',
 png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',svg:'image/svg+xml',glb:'model/gltf-binary',gltf:'model/gltf+json',bin:'application/octet-stream',mp3:'audio/mpeg',ogg:'audio/ogg',wav:'audio/wav',woff2:'font/woff2',key:'text/plain; charset=utf-8'};
const STATUS={draft:'DRAFT (not submitted)',review:'IN REVIEW',live:'LIVE',rejected:'CHANGES NEEDED',suspended:'TAKEN DOWN'};

const fail=(message,code)=>Object.assign(Error(message),{code,user:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

// ---- options, site, sign-in ----
function parseArgs(argv){
 const o={_:[]};
 for(let i=0;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--')){o._.push(a);continue;}const k=a.slice(2),n=argv[i+1];
  if(k.includes('=')){const [kk,...v]=k.split('=');o[kk]=v.join('=');}else if(n!==undefined&&!n.startsWith('--')){o[k]=n;i++;}else o[k]=true;}
 return o;
}
const projectDir=o=>path.resolve(String(o.dir||process.cwd()));
function readJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch{return null;}}
const projectConfig=dir=>readJson(path.join(dir,'growblocks.json'))||{};
function siteOf(o,dir){return String(o.site||process.env.GROWBLOCKS_SITE||projectConfig(dir).site||DEFAULT_SITE).replace(/\/+$/,'');}
function readCreds(){return readJson(CRED_FILE)||{sites:{}};}
function saveCreds(c){fs.mkdirSync(path.dirname(CRED_FILE),{recursive:true});fs.writeFileSync(CRED_FILE,JSON.stringify(c,null,1),{mode:0o600});try{fs.chmodSync(CRED_FILE,0o600);}catch{}}
function tokenFor(site){
 if(process.env.GROWBLOCKS_TOKEN)return process.env.GROWBLOCKS_TOKEN.trim();
 const s=readCreds().sites?.[site];return s&&s.expiresAt>Date.now()?s.token:null;
}
async function api(site,op,body={},{auth=true}={}){
 const headers={'Content-Type':'application/json','User-Agent':'growblocks-cli/'+VERSION};
 if(auth){const t=tokenFor(site);if(!t)throw fail('Not signed in to '+site+'. Run: node growblocks.mjs login','signin');headers.Authorization='Bearer '+t;}
 let r;
 for(let attempt=0;;attempt++){
  try{r=await fetch(site+'/api/devkit',{method:'POST',headers,body:JSON.stringify({op,...body}),signal:AbortSignal.timeout(60000)});}
  catch(e){if(attempt<2){await sleep(1500*(attempt+1));continue;}throw fail('Could not reach '+site+' ('+(e.cause?.code||e.message)+').','network');}
  if(r.status>=500&&attempt<2){await sleep(1500*(attempt+1));continue;}break;
 }
 const d=await r.json().catch(()=>({}));
 if(!r.ok)throw fail((d.error||'Request failed ('+r.status+')')+(r.status===401&&auth?' Run: node growblocks.mjs login':''),d.code||(r.status===401?'signin':'http-'+r.status));
 return d;
}
function openBrowser(url){
 try{const p=process.platform==='win32'?spawn('rundll32',['url.dll,FileProtocolHandler',url],{stdio:'ignore',detached:true})
  :spawn(process.platform==='darwin'?'open':'xdg-open',[url],{stdio:'ignore',detached:true});p.on('error',()=>{});p.unref();return true;}catch{return false;}
}
const linked=(o,dir)=>{const g=String(o.game||projectConfig(dir).game||'');if(!g)throw fail('This folder is not linked to a game. Run: node growblocks.mjs create <address> --name "My Game"  (or: link <address>)','no-game');return g;};
function link(dir,game,site){const file=path.join(dir,'growblocks.json'),c=readJson(file)||{};c.game=game;if(site&&site!==DEFAULT_SITE)c.site=site;else delete c.site;fs.writeFileSync(file,JSON.stringify(c,null,1)+'\n');}

// ---- the commands. Each one writes lines through out(); the CLI prints them and the MCP server returns them. ----
const C={};
C.login=async(o,out,{wait=true}={})=>{
 const dir=projectDir(o),site=siteOf(o,dir);
 const s=await api(site,'cli.start',{label:o.label||(os.hostname()+' · '+(o.mcp?'MCP':'CLI'))},{auth:false});
 out('Open '+s.verifyUrl);out('and check the code '+s.userCode+' matches, sign in with Google and press Allow.');
 if(!o['no-browser'])openBrowser(s.verifyUrl);
 const finish=(async()=>{
  const until=Date.now()+s.expiresIn*1000;
  while(Date.now()<until){
   await sleep((s.interval||3)*1000);
   const p=await api(site,'cli.poll',{deviceCode:s.deviceCode},{auth:false}).catch(e=>e.code==='network'?{status:'pending'}:Promise.reject(e));
   if(p.status==='ok'){const c=readCreds();c.sites={...c.sites,[site]:{token:p.token,name:p.name,expiresAt:p.expiresAt}};saveCreds(c);return p;}
   if(p.status==='expired')break;
  }
  throw fail('The code expired. Run login again.','expired');
 })();
 if(!wait){finish.catch(()=>{});return {pending:finish,...s};}
 out('Waiting…');const p=await finish;out('Signed in as '+p.name+' on '+site+'. (Valid 90 days; logout ends it.)');return p;
};
C.logout=async(o,out)=>{
 const site=siteOf(o,projectDir(o)),t=tokenFor(site);
 if(t)await api(site,'cli.revoke',{}).catch(()=>{});
 const c=readCreds();if(c.sites)delete c.sites[site];saveCreds(c);out('Signed out of '+site+'.');
};
C.whoami=async(o,out)=>{
 const site=siteOf(o,projectDir(o)),me=await api(site,'me');
 out(me.name+' on '+site+(me.dev?' · developer '+me.dev.status:'')+' · '+me.games.length+' game'+(me.games.length===1?'':'s'));return me;
};
function describe(g,site){
 const lines=[g.name+'  ('+g.slug+')  '+(STATUS[g.status]||g.status)+'  by '+g.by];
 if(g.test)lines.push('  test build '+g.test.version+' · '+g.test.files+' files · '+new Date(g.test.at).toISOString().slice(0,16).replace('T',' ')+'  '+site+'/game.html?g='+g.slug+'&test=1');
 if(g.live)lines.push('  live build '+g.live.version+'  '+site+'/game.html?g='+g.slug);
 if(g.status==='review'||g.reviewVersion)lines.push('  in review: '+(g.reviewVersion||'yes'));
 if(g.reviewNote)lines.push('  GrowBlocks says: '+g.reviewNote);
 if(!g.logo)lines.push('  no logo yet (needed to submit): update --logo logo.webp');
 return lines;
}
C.games=async(o,out)=>{
 const site=siteOf(o,projectDir(o)),me=await api(site,'me');
 if(!me.games.length)out('No games yet. Make one: node growblocks.mjs create <address> --name "My Game"');
 for(const g of me.games)describe(g,site).forEach(l=>out(l));return me.games;
};
C.status=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=linked(o,dir),me=await api(site,'me'),g=me.games.find(x=>x.slug===slug);
 if(!g)throw fail('You have no game "'+slug+'" on '+site+'. Your games: '+(me.games.map(x=>x.slug).join(', ')||'none'),'no-game');
 describe(g,site).forEach(l=>out(l));
 if(!g.test)out('Next: node growblocks.mjs push');else if(g.status==='draft'||g.status==='rejected')out('Next: play the test link, then node growblocks.mjs submit');
 return g;
};
function logoData(file){
 const b=fs.readFileSync(file);if(!(b.slice(0,4).toString()==='RIFF'&&b.slice(8,12).toString()==='WEBP'))throw fail('The logo must be a WebP image (convert it first, e.g. at squoosh.app).','logo');
 const d='data:image/webp;base64,'+b.toString('base64');if(d.length>30000)throw fail('The logo is too big: keep it under about 22 KB (a 256x256 WebP).','logo');return d;
}
function meta(o,dir){
 const m={};for(const k of ['name','tagline','description','studio'])if(o[k]!==undefined&&o[k]!==true)m[k]=String(o[k]);
 if(o.players!==undefined)m.maxPlayers=Number(o.players);if(o.logo)m.logo=logoData(path.resolve(dir,String(o.logo)));return m;
}
C.create=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=String(o._[0]||o.game||'').toLowerCase();
 if(!slug)throw fail('Give the game an address: create <address> --name "My Game" [--tagline ... --description ... --players 8 --logo logo.webp]','usage');
 const m=meta(o,dir);if(!m.name)throw fail('Name it: --name "My Game"','usage');
 await api(site,'create',{slug,...m});link(dir,slug,site);
 out('Created '+m.name+' at '+site+'/game.html?g='+slug+' (not public until GrowBlocks approves it).');out('This folder is linked to it (growblocks.json). Next: node growblocks.mjs push');
 return {slug};
};
C.link=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=String(o._[0]||'');if(!slug)throw fail('link <address>','usage');
 const me=await api(site,'me');if(!me.games.some(g=>g.slug===slug))throw fail('You have no game "'+slug+'". Your games: '+(me.games.map(g=>g.slug).join(', ')||'none'),'no-game');
 link(dir,slug,site);out('This folder is linked to '+slug+'.');return {slug};
};
C.update=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=linked(o,dir),m=meta(o,dir);
 if(!Object.keys(m).length)throw fail('Nothing to change. Options: --name --tagline --description --studio --players --logo logo.webp','usage');
 await api(site,'update',{slug,...m});out('Updated '+slug+': '+Object.keys(m).join(', ')+'.');return {slug};
};
/** The files a build is made of: what check.mjs counts as shipped, minus the types GrowBlocks does not serve. */
function buildFiles(dir,{block=false}={}){
 const walk=(d,rel='')=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{if(SKIP.test(e.name)||e.name.startsWith('.'))return [];const r=rel?rel+'/'+e.name:e.name;
  return e.isDirectory()?walk(path.join(d,e.name),r):[r];});
 // A block keeps its block.json; a game ships the blocks it carries (that is how they are found), a block does not.
 const all=walk(dir).filter(f=>!(LOCAL_ONLY.has(f)&&!(block&&f==='block.json'))&&!(block&&f.startsWith('blocks/'))),skipped=all.filter(f=>!TYPES.includes(f.split('.').pop().toLowerCase())),files=all.filter(f=>!skipped.includes(f));
 return {files,skipped};
}
function runNode(dir,script,args,{onLine}={}){
 return new Promise(resolve=>{
  const p=spawn(process.execPath,[script,...args],{cwd:dir,stdio:['ignore','pipe','pipe']});let text='';
  const take=b=>{const s=b.toString();text+=s;if(onLine)s.split(/\r?\n/).filter(Boolean).forEach(onLine);};
  p.stdout.on('data',take);p.stderr.on('data',take);p.on('error',e=>{text+=e.message;resolve({code:1,text});});p.on('close',code=>resolve({code,text}));
 });
}
C.check=async(o,out)=>{
 const dir=projectDir(o);if(!fs.existsSync(path.join(dir,'check.mjs')))throw fail('No check.mjs in '+dir+'. Is this a GrowBlocks game folder? (node growblocks.mjs new <folder>)','no-checker');
 const args=[];if(o.play)args.push('--play');for(const k of ['seconds','port'])if(o[k]!==undefined)args.push('--'+k,String(o[k]));if(o.play&&(o.site||projectConfig(dir).site))args.push('--site',siteOf(o,dir));
 const started=Date.now(),r=await runNode(dir,'check.mjs',args,{onLine:out});
 const shot=path.join(dir,'check-screenshot.png'),fresh=o.play&&fs.existsSync(shot)&&fs.statSync(shot).mtimeMs>=started-1000;
 return {ok:r.code===0,screenshot:fresh?shot:null};
};
C.push=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=linked(o,dir);
 if(!fs.existsSync(path.join(dir,'game.js')))throw fail('No game.js in '+dir+': a build starts at game.js.','no-game-js');
 if(!o['no-check']&&fs.existsSync(path.join(dir,'check.mjs'))){out('Checking…');const c=await C.check({...o,play:false},()=>{});if(!c.ok){await C.check({...o,play:false},out);throw fail('The checker found problems: fix them, then push again (or --no-check).','check');}}
 const {files,skipped}=buildFiles(dir);
 for(const f of skipped)out('skip  '+f+' (.'+f.split('.').pop()+' is not uploaded)');
 if(files.length>LIMITS.files)throw fail(files.length+' files: a build is at most '+LIMITS.files+'.','limits');
 const sizes=files.map(f=>fs.statSync(path.join(dir,f)).size),big=files.filter((f,i)=>sizes[i]>LIMITS.fileBytes);
 if(big.length)throw fail('Over 3 MB: '+big.join(', '),'limits');if(sizes.reduce((a,b)=>a+b,0)>LIMITS.buildBytes)throw fail('A build is at most 30 MB.','limits');
 const {version}=await api(site,'build.start',{slug});out('Uploading '+files.length+' files as '+version+'…');
 const manifest={};
 for(const f of files){const r=await api(site,'build.file',{slug,version,path:f,data:fs.readFileSync(path.join(dir,f)).toString('base64')});manifest[r.path]=r.sha256;out('✓ '+r.path+' ('+Math.max(1,Math.round(r.size/1024))+' KB)');}
 const done=await api(site,'build.finish',{slug,version,files:manifest}),test=site+'/'+done.test;
 if(done.blocks?.length)out('Uses blocks: '+done.blocks.map(b=>b.slug+'@'+b.version).join(', ')+' (their authors earn a share of your game\'s fees, paid by GrowBlocks: yours stay 70%).');
 out('Uploaded '+version+'. Test link (unlisted, share it with testers): '+test);
 out(done.live?'It is live: your updates go live directly.':done.waiting?'Players keep the approved version until GrowBlocks reviews this one: node growblocks.mjs submit':'When it plays well: node growblocks.mjs submit');
 if(o.open)openBrowser(test);
 return {version,test,live:!!done.live};
};
C.submit=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),slug=linked(o,dir),r=await api(site,'submit',{slug});
 out(r.status==='review'?'Submitted. GrowBlocks will play it and approve it or send a note (see: node growblocks.mjs status).':'Update submitted. Players keep the current version until GrowBlocks approves it.');return r;
};
// ---- blocks: parts of games other developers published (a kart, a mode, an enemy brain); their authors earn when games ship them ----
async function getJson(site,q){const r=await fetch(site+'/api/devkit?'+q,{signal:AbortSignal.timeout(30000)}).catch(e=>{throw fail('Could not reach '+site+' ('+(e.cause?.code||e.message)+').','network');});
 const d=await r.json().catch(()=>({}));if(!r.ok)throw fail(d.error||'Request failed ('+r.status+')','http-'+r.status);return d;}
C.blocks=async(o,out)=>{
 const site=siteOf(o,projectDir(o)),q=o._.join(' '),{blocks}=await getJson(site,'blocks=1&q='+encodeURIComponent(q));
 if(!blocks.length)out('No blocks'+(q?' for "'+q+'"':'')+' yet. Publish one: node growblocks.mjs block publish');
 for(const b of blocks)out(b.slug+'  '+b.name+' by '+b.by+(b.tags.length?'  ['+b.tags.join(', ')+']':'')+(b.versions[0]?.forkOf?'  fork of '+b.versions[0].forkOf:'')+'\n  '+b.description);
 return blocks;
};
C.add=async(o,out)=>{
 const dir=projectDir(o),site=siteOf(o,dir),want=String(o._[0]||'');const [slug,ver]=want.split('@');
 if(!slug)throw fail('add <block>[@version]  (find one: node growblocks.mjs blocks <words>)','usage');
 const b=await getJson(site,'block='+encodeURIComponent(slug)),version=ver||b.latest,files=b.files[version];
 if(!files)throw fail(slug+' has no version '+version+'. Versions: '+b.versions.map(v=>v.version).join(', '),'no-version');
 const to=path.join(dir,'blocks',slug);fs.rmSync(to,{recursive:true,force:true});
 for(const p of Object.keys(files)){
  const r=await fetch(site+'/api/devkit?blockfile='+encodeURIComponent(slug+'/'+version+'/'+p),{signal:AbortSignal.timeout(30000)});if(!r.ok)throw fail('Could not download '+p+' ('+r.status+').','network');
  const f=path.join(to,p);fs.mkdirSync(path.dirname(f),{recursive:true});fs.writeFileSync(f,Buffer.from(await r.arrayBuffer()));
 }
 const cfgFile=path.join(dir,'growblocks.json'),cfg=readJson(cfgFile)||{};cfg.blocks={...(cfg.blocks||{}),[slug]:version};fs.writeFileSync(cfgFile,JSON.stringify(cfg,null,1)+'\n');
 const entry=b.versions.find(v=>v.version===version)?.entry||'index.js',name=slug.replace(/-([a-z0-9])/g,(_,c)=>c.toUpperCase()).replace(/^[0-9]/,'b$&');
 out('Added '+b.name+' ('+slug+'@'+version+') by '+b.by+' in blocks/'+slug+'/ ('+Object.keys(files).length+' files).');
 out("Use it: import * as "+name+" from './blocks/"+slug+'/'+entry+"';   (read blocks/"+slug+"/block.json and its code for how)");
 out('Keep its files unchanged: GrowBlocks recognises the block by them, and its author earns from your game (paid by GrowBlocks, not from your 70%). To change it, publish your own fork.');
 return {slug,version,entry};
};
C.block=async(o,out)=>{
 const sub=o._.shift(),dir=projectDir(o),site=siteOf(o,dir);
 if(sub==='info'){const b=await getJson(site,'block='+encodeURIComponent(o._[0]||''));
  out(b.name+' ('+b.slug+') by '+b.by+'\n  '+b.description);for(const v of b.versions)out('  '+v.version+'  '+v.files+' files'+(v.forkOf?'  fork of '+v.forkOf:'')+'  entry '+v.entry);
  out('  used live by: '+(b.usedBy.join(', ')||'no game yet'));return b;}
 if(sub==='init'){
  const slug=String(o._[0]||path.basename(dir)).toLowerCase().replace(/[^a-z0-9-]/g,'-'),f=path.join(dir,'block.json');if(fs.existsSync(f)&&!o.force)throw fail('block.json already exists (--force to replace).','exists');
  fs.writeFileSync(f,JSON.stringify({slug,name:o.name&&o.name!==true?String(o.name):'My Block',description:'What it does and how a game uses it.',entry:'index.js',tags:[],...(o.fork&&o.fork!==true?{forkOf:String(o.fork)}:{})},null,1)+'\n');
  if(!fs.existsSync(path.join(dir,'index.js')))fs.writeFileSync(path.join(dir,'index.js'),'// '+slug+': a GrowBlocks block. Export what games call; take gb as a parameter, never a global.\nexport function setup(gb, options = {}) {\n}\n');
  out('Wrote block.json and index.js. Edit them, then: node growblocks.mjs block publish');return {slug};}
 if(sub==='publish'){
  const meta=readJson(path.join(dir,'block.json'));if(!meta)throw fail('No block.json here. Start one: node growblocks.mjs block init <address>','no-block');
  const slug=String(o._[0]||meta.slug||'').toLowerCase();if(!slug)throw fail('Give the block an address: "slug" in block.json, or block publish <address>','usage');
  const {files,skipped}=buildFiles(dir,{block:true});for(const f of skipped)out('skip  '+f);
  const {version}=await api(site,'block.start',{slug});out('Publishing '+files.length+' files as '+slug+'@'+version+'…');
  for(const f of files){const r=await api(site,'block.file',{slug,version,path:f,data:fs.readFileSync(path.join(dir,f)).toString('base64')});out('✓ '+r.path);}
  const done=await api(site,'block.finish',{slug,version,...(o.studio&&o.studio!==true?{studio:String(o.studio)}:{})});
  out('Published '+slug+'@'+done.version+(done.forkOf?' (fork of '+done.forkOf+')':'')+'. Others add it with: npx growblocks add '+slug);
  out("You earn from every game whose live build ships it: 5% of that game's fees go to its blocks, paid by GrowBlocks. See devkit.html, Earnings.");
  return done;}
 if(sub==='status'||!sub){const mine=await api(site,'blocks.mine');if(!mine.length)out('No blocks yet. Start one: node growblocks.mjs block init <address>');
  for(const b of mine){const info=await getJson(site,'block='+b.slug).catch(()=>({usedBy:[]}));out(b.slug+'  '+b.name+'  latest '+b.latest+'  used live by: '+(info.usedBy.join(', ')||'none yet'));}
  return mine;}
 throw fail('block init | publish | status | info <block>','usage');
};
C.open=async(o,out)=>{const dir=projectDir(o),site=siteOf(o,dir),url=site+'/game.html?g='+linked(o,dir)+(o.live?'':'&test=1');out(url);openBrowser(url);return {url};};
C.new=async(o,out)=>{
 const dir=path.resolve(String(o._[0]||o.dir||'my-growblocks-game')),site=siteOf(o,process.cwd());
 if(fs.existsSync(dir)&&fs.readdirSync(dir).length&&!o.force)throw fail(dir+' is not empty (use --force to add the starter files anyway).','exists');
 fs.mkdirSync(dir,{recursive:true});
 for(const [file,src] of STARTER){
  const r=await fetch(site+'/'+src,{signal:AbortSignal.timeout(30000)}).catch(e=>({ok:false,status:e.message}));
  if(!r.ok){if(file==='.mcp.json'){fs.writeFileSync(path.join(dir,file),MCP_JSON);continue;}throw fail('Could not download '+src+' ('+r.status+').','network');}
  fs.writeFileSync(path.join(dir,file),Buffer.from(await r.arrayBuffer()));
 }
 out('New game in '+dir+' ('+STARTER.length+' files).');
 if(o.mcp){out('The other growblocks tools work on it when you pass dir: '+JSON.stringify(dir)+' (this server stays in '+process.cwd()+'). Next: growblocks_check with play=true and that dir.');return {dir};}
 const rel=path.relative(process.cwd(),dir);out('Next: cd '+(!rel||rel.startsWith('..')||path.isAbsolute(rel)?'"'+dir+'"':rel)+' && node growblocks.mjs dev   (then open http://localhost:5173/play.html)');
 out('Open the folder in Claude Code or Cursor: .mcp.json gives them the GrowBlocks tools.');
 return {dir};
};
const MCP_JSON=JSON.stringify({mcpServers:{growblocks:{command:'node',args:['growblocks.mjs','mcp']}}},null,1)+'\n';
C.dev=async(o,out)=>{
 const dir=projectDir(o),port=Number(o.port||5173),root=path.resolve(dir);
 const server=http.createServer((req,res)=>{
  let p;try{p=decodeURIComponent(new URL(req.url,'http://x').pathname);}catch{res.writeHead(400).end();return;}
  if(p==='/')p='/play.html';const file=path.resolve(root,'.'+p);
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Private-Network','true');res.setHeader('Cache-Control','no-store');
  if(req.method==='OPTIONS'){res.setHeader('Access-Control-Allow-Headers','*');res.writeHead(204).end();return;}
  if(!(file===root||file.startsWith(root+path.sep))||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404,{'Content-Type':'text/plain'}).end('Not found');return;}
  res.writeHead(200,{'Content-Type':MIME[file.split('.').pop().toLowerCase()]||'application/octet-stream'});fs.createReadStream(file).pipe(res);
 });
 await new Promise((resolve,reject)=>{server.once('error',e=>reject(fail(e.code==='EADDRINUSE'?'Port '+port+' is in use: --port 5174':e.message,'port')));server.listen(port,resolve);});
 out('Serving '+dir+' with CORS on.');out('Play:              http://localhost:'+port+'/play.html');
 out('Inside GrowBlocks: '+siteOf(o,dir)+'/game.html?dev=http://localhost:'+port+'/game.js');out('Ctrl+C to stop.');
 return {server,port};
};
C.docs=async(o,out)=>{
 const dir=projectDir(o),local=path.join(dir,'llms.txt');
 let text=fs.existsSync(local)?fs.readFileSync(local,'utf8'):null;
 if(!text){const r=await fetch(siteOf(o,dir)+'/devkit/llms.txt',{signal:AbortSignal.timeout(30000)});if(!r.ok)throw fail('Could not load llms.txt ('+r.status+').','network');text=await r.text();}
 const topic=o._[0]||o.topic;
 if(topic&&topic!==true){
  const parts=text.split(/\n(?=#{2,3} )/),want=String(topic).toLowerCase(),hit=parts.filter(p=>p.split('\n')[0].toLowerCase().includes(want));
  text=hit.length?hit.join('\n\n'):'No section about "'+topic+'". Sections:\n'+parts.map(p=>p.split('\n')[0]).filter(h=>/^#/.test(h)).join('\n');
 }
 out(text);return {length:text.length};
};

// ---- the MCP server (stdio, JSON-RPC 2.0, one message per line) ----
const S=(props={},required=[])=>({type:'object',properties:{dir:{type:'string',description:'The game folder (default: the folder the assistant runs in).'},...props},required});
const TOOLS=[
 {name:'growblocks_docs',cmd:'docs',description:'The GrowBlocks Dev Kit API for writing game.js (llms.txt): the contract, every gb.* call, patterns and pitfalls. Read it before writing game code. Pass topic (e.g. "gb.physics", "gb.net", "Pitfalls") to get one section.',inputSchema:S({topic:{type:'string'}})},
 {name:'growblocks_check',cmd:'check',description:'Run the Dev Kit checker on the game folder. play=false: static checks (syntax, unknown gb.* calls, blocked browser APIs, imports, file limits). play=true: also plays the game headless inside GrowBlocks for some seconds, reports every runtime error and returns a screenshot. Run it after every change; fix everything it reports.',inputSchema:S({play:{type:'boolean'},seconds:{type:'number'}})},
 {name:'growblocks_whoami',cmd:'whoami',description:'Who the GrowBlocks CLI is signed in as, and how many games they have. Fails with "Not signed in" if login is needed.',inputSchema:S()},
 {name:'growblocks_login',cmd:'login',description:'Start signing in to GrowBlocks. Returns a link and a code: give both to the human, who opens the link, checks the code, signs in with Google and presses Allow. The sign-in finishes in the background; check it with growblocks_whoami.',inputSchema:S()},
 {name:'growblocks_games',cmd:'games',description:"The signed-in developer's games: status (draft, in review, live, changes needed), test and live builds with their links, and GrowBlocks' review note.",inputSchema:S()},
 {name:'growblocks_status',cmd:'status',description:'The status of the game this folder is linked to (growblocks.json): builds, links, review state and note, and what to do next.',inputSchema:S()},
 {name:'growblocks_create_game',cmd:'create',description:'Create a new game on GrowBlocks and link the folder to it. address: 3-32 lowercase letters, numbers and dashes (its URL, game.html?g=<address>). Ask the human for the name and address first. A logo (WebP, under 22 KB) and a description are needed before submitting.',inputSchema:S({address:{type:'string'},name:{type:'string'},tagline:{type:'string'},description:{type:'string'},players:{type:'number',description:'Players per room, 1-16.'},logo:{type:'string',description:'Path to a WebP logo.'}},['address','name'])},
 {name:'growblocks_link_game',cmd:'link',description:'Link the folder to one of your existing games (writes growblocks.json).',inputSchema:S({address:{type:'string'}},['address'])},
 {name:'growblocks_update_game',cmd:'update',description:"Change the linked game's name, tagline, description, studio (the name shown after \"by\"; empty = the developer's account name), players per room or logo.",inputSchema:S({name:{type:'string'},studio:{type:'string'},tagline:{type:'string'},description:{type:'string'},players:{type:'number'},logo:{type:'string',description:'Path to a WebP logo.'}})},
 {name:'growblocks_push',cmd:'push',description:'Run the static checks, then upload the folder as a new test build of the linked game. Returns the unlisted test link to play and share. Does not make anything public. At most 20 uploads per game a day, so push when a change is worth testing.',inputSchema:S()},
 {name:'growblocks_submit',cmd:'submit',description:'Submit the latest test build to GrowBlocks for review (needs a logo and a description). Only do this when the human asks: GrowBlocks plays it and approves it or sends a note.',inputSchema:S()},
 {name:'growblocks_blocks',cmd:'blocks',description:'Search the GrowBlocks blocks: parts of games other developers published (vehicles, game modes, enemy brains, level kits) that a game can add instead of writing them. Look here before building something common. Pass words to search names, descriptions and tags.',inputSchema:S({query:{type:'string'}})},
 {name:'growblocks_block_info',cmd:'block',sub:'info',description:'One block: what it does, its versions (and what it forked), its entry file and which live games use it.',inputSchema:S({block:{type:'string'}},['block'])},
 {name:'growblocks_add_block',cmd:'add',description:'Add a block to the game: copies its files into blocks/<slug>/ and records it in growblocks.json. Then import it from ./blocks/<slug>/<entry> and read its code for how to use it. Do not edit the block files: GrowBlocks recognises the block by them and its author earns from the game (paid by GrowBlocks; the game keeps its 70%). To change one, publish a fork.',inputSchema:S({block:{type:'string',description:'slug or slug@version'}},['block'])},
 {name:'growblocks_publish_block',cmd:'block',sub:'publish',description:'Publish the folder as a block. It needs block.json (slug, name, description, entry, tags, and forkOf if it started from another block). Others can then add it, and its author earns from every live game that ships it. Only when the human asks.',inputSchema:S()},
 {name:'growblocks_new_game',cmd:'new',description:'Create a new game folder from the latest starter kit (game.js, play.html, check.mjs, llms.txt, gb.d.ts, this CLI and .mcp.json). Then pass that folder as dir to the other tools.',inputSchema:{type:'object',properties:{folder:{type:'string'}},required:['folder']}}
];
// What each tool does to the world, for the assistant's approval prompts and MCP directories: [title, readOnly, destructive, idempotent, openWorld].
const ANN={growblocks_docs:['Read the Dev Kit API',1,0,1,0],growblocks_check:['Check and play the game',1,0,1,0],growblocks_whoami:['Who is signed in',1,0,1,1],
 growblocks_login:['Sign in to GrowBlocks',0,0,1,1],growblocks_games:['List my games',1,0,1,1],growblocks_status:['Game status and review note',1,0,1,1],
 growblocks_create_game:['Create a game on GrowBlocks',0,0,0,1],growblocks_link_game:['Link folder to a game',0,0,1,1],growblocks_update_game:['Change game details',0,1,1,1],
 growblocks_push:['Upload a test build',0,0,0,1],growblocks_submit:['Submit for review',0,0,0,1],growblocks_blocks:['Search blocks',1,0,1,1],
 growblocks_block_info:['Block details',1,0,1,1],growblocks_add_block:['Add a block to the game',0,1,1,1],growblocks_publish_block:['Publish a block publicly',0,0,0,1],
 growblocks_new_game:['New game folder',0,0,0,1]};
for(const t of TOOLS){const [title,r,d,i,w]=ANN[t.name];t.annotations={title,readOnlyHint:!!r,destructiveHint:!!d,idempotentHint:!!i,openWorldHint:!!w};}
// The commands' hints name CLI commands; an assistant should call the tools instead.
const HINT={login:'growblocks_login',push:'growblocks_push',submit:'growblocks_submit',status:'growblocks_status',create:'growblocks_create_game',link:'growblocks_link_game',
 update:'growblocks_update_game',blocks:'growblocks_blocks',games:'growblocks_games',whoami:'growblocks_whoami',add:'growblocks_add_block',new:'growblocks_new_game','block publish':'growblocks_publish_block'};
const HINT_RE=/(?:node growblocks\.mjs|npx growblocks) (block publish|login|push|submit|status|create|link|update|blocks|games|whoami|add|new)(?: (?:<[^>\n]+>|\[[^\]\n]+\]|--[a-z-]+(?: "[^"\n]*"| [a-z0-9.@-]+)?|[a-z0-9][a-z0-9.@-]*(?=$|[\s).,])))*/gm;
const toolHints=t=>String(t).replace(HINT_RE,(_,c)=>'the '+HINT[c]+' tool').replace(/node check\.mjs --play/g,'growblocks_check with play=true').replace(/Run login again/g,'Call growblocks_login again')
 .replace(/\(or: link <address>\)/g,'(or growblocks_link_game)').replace(/: update --logo logo\.webp/g,': growblocks_update_game with logo');
// Resources: the API as files, for assistants that attach context instead of calling growblocks_docs.
const RESOURCES=[{uri:'growblocks://devkit/llms.txt',name:'llms.txt',title:'GrowBlocks Dev Kit API',description:'The whole gb API for game.js: the contract, every call, patterns and pitfalls.',mimeType:'text/plain',file:'llms.txt',src:'devkit/llms.txt'},
 {uri:'growblocks://devkit/gb.d.ts',name:'gb.d.ts',title:'GrowBlocks Dev Kit types',description:'The same API as TypeScript types.',mimeType:'text/plain',file:'gb.d.ts',src:'devkit/gb.d.ts'}];
async function readResource(uri){
 const r=RESOURCES.find(x=>x.uri===uri);if(!r)throw fail('Unknown resource '+uri,'resource');
 const local=path.join(process.cwd(),r.file);if(fs.existsSync(local))return {uri,mimeType:r.mimeType,text:fs.readFileSync(local,'utf8')};
 const res=await fetch(siteOf({},process.cwd())+'/'+r.src,{signal:AbortSignal.timeout(30000)}).catch(e=>{throw fail('Could not reach the site ('+(e.cause?.code||e.message)+').','network');});
 if(!res.ok)throw fail('Could not load '+r.src+' ('+res.status+').','network');
 return {uri,mimeType:r.mimeType,text:await res.text()};
}
// Prompts: the two jobs people bring to the kit; Claude Code shows them as /mcp__growblocks__make_game and /mcp__growblocks__ship_game.
const PROMPTS=[{name:'make_game',title:'Make a GrowBlocks game',description:'Build a browser game on GrowBlocks from an idea, checking it with a screenshot until it plays well.',arguments:[{name:'idea',description:'What the game is, in a sentence or two.',required:true},{name:'folder',description:'Folder to make it in (default: a new one named after the idea).'}]},
 {name:'ship_game',title:'Ship to GrowBlocks',description:'Check the game in this folder, upload a test build and say how to get it reviewed.',arguments:[]}];
function getPrompt(name,a={}){
 const text=name==='make_game'?'Make a GrowBlocks Dev Kit game: '+(a.idea||'(ask me for the idea)')+'\n\n'
  +'1. '+(a.folder?'Create the folder "'+a.folder+'"':'Create a new game folder named after the idea')+' with growblocks_new_game (skip this if the current folder already has game.js), and pass it as dir to every other tool.\n'
  +'2. Read growblocks_docs, and search growblocks_blocks before writing anything common.\n'
  +'3. Write game.js. After every change run growblocks_check with play=true, look at the screenshot and fix everything it reports.\n'
  +'4. When it plays well, tell me how to play it locally. Do not push or submit unless I ask.'
  :name==='ship_game'?'Ship the GrowBlocks game in this folder: run growblocks_check with play=true and fix what it reports; check growblocks_status (not signed in: growblocks_login, then give me the link and code; not linked: ask me for a name and address, then growblocks_create_game); then growblocks_push and give me the test link. Do not submit until I have played it and say so.'
  :null;
 if(!text)throw fail('Unknown prompt '+name,'prompt');
 return {description:PROMPTS.find(p=>p.name===name).description,messages:[{role:'user',content:{type:'text',text}}]};
}
async function mcp(){
 let pendingLogin=null;const send=m=>process.stdout.write(JSON.stringify(m)+'\n');
 const log=(...a)=>process.stderr.write('[growblocks] '+a.join(' ')+'\n');
 const call=async(name,args={})=>{
  const tool=TOOLS.find(t=>t.name===name);if(!tool)throw fail('Unknown tool '+name,'tool');
  const o={_:[],mcp:true,...args};if(args.address)o._=[args.address];if(args.block)o._=[args.block];if(args.query)o._=[args.query];if(tool.sub)o._=[tool.sub,...o._];if(args.folder)o._=[path.resolve(process.cwd(),args.folder)];if(args.topic)o._=[args.topic];
  const lines=[],out=l=>lines.push(String(l));const content=[];
  if(tool.cmd==='login'){
   const site=siteOf(o,projectDir(o));if(tokenFor(site)){const me=await api(site,'me').catch(()=>null);if(me)return [{type:'text',text:'Already signed in as '+me.name+' on '+site+'.'}];}
   const s=await C.login(o,out,{wait:false});pendingLogin=s.pending;pendingLogin.then(p=>log('signed in as',p.name),e=>log('login:',e.message));
   return [{type:'text',text:lines.join('\n')+'\nGive the human this link and code. Then call growblocks_whoami to see when it is done (the code lasts 10 minutes).'}];
  }
  const r=await C[tool.cmd](o,out);
  content.push({type:'text',text:toolHints(lines.join('\n'))||'Done.'});
  if(tool.cmd==='check'){content[0].text=(r.ok?'PASSED\n':'FAILED\n')+content[0].text;if(r.screenshot)content.push({type:'image',data:fs.readFileSync(r.screenshot).toString('base64'),mimeType:'image/png'});}
  return content;
 };
 let buf='';
 process.stdin.on('data',async chunk=>{
  buf+=chunk;let i;
  while((i=buf.indexOf('\n'))>=0){
   const line=buf.slice(0,i).trim();buf=buf.slice(i+1);if(!line)continue;
   let m;try{m=JSON.parse(line);}catch{send({jsonrpc:'2.0',id:null,error:{code:-32700,message:'Parse error'}});continue;}
   handle(m);
  }
 });
 process.stdin.on('end',()=>process.exit(0));
 async function handle(m){
  const reply=result=>m.id!==undefined&&send({jsonrpc:'2.0',id:m.id,result}),error=(code,message)=>m.id!==undefined&&send({jsonrpc:'2.0',id:m.id,error:{code,message}});
  try{
   switch(m.method){
    case 'initialize':{const want=m.params?.protocolVersion,known=['2025-06-18','2025-03-26','2024-11-05'];
     return reply({protocolVersion:known.includes(want)?want:known[0],capabilities:{tools:{},resources:{},prompts:{}},serverInfo:{name:'growblocks',version:VERSION},
      instructions:'GrowBlocks Dev Kit tools. Every tool takes dir, the game folder (default: where this server runs). Workflow: growblocks_docs before writing game.js; growblocks_check (play=true) after every change and look at the screenshot; growblocks_push uploads an unlisted test build and returns its link; growblocks_submit only when the human asks. If a tool says "Not signed in", call growblocks_login and give the human the link and code.'});}
    case 'notifications/initialized':case 'notifications/cancelled':return;
    case 'ping':return reply({});
    case 'tools/list':return reply({tools:TOOLS.map(({name,description,inputSchema,annotations})=>({name,title:annotations.title,description,inputSchema,annotations}))});
    case 'resources/list':return reply({resources:RESOURCES.map(({uri,name,title,description,mimeType})=>({uri,name,title,description,mimeType}))});
    case 'resources/templates/list':return reply({resourceTemplates:[]});
    case 'resources/read':try{return reply({contents:[await readResource(m.params?.uri)]});}catch(e){return error(-32002,e.message);}
    case 'prompts/list':return reply({prompts:PROMPTS});
    case 'prompts/get':try{return reply(getPrompt(m.params?.name,m.params?.arguments||{}));}catch(e){return error(-32602,e.message);}
    case 'tools/call':{
     try{return reply({content:await call(m.params?.name,m.params?.arguments||{})});}
     catch(e){return reply({content:[{type:'text',text:toolHints(e.message)}],isError:true});}
    }
    default:if(m.id!==undefined)return error(-32601,'Method not found: '+m.method);
   }
  }catch(e){error(-32603,e.message);}
 }
 log('GrowBlocks MCP server '+VERSION+' ready in '+process.cwd());
}

// ---- the CLI ----
const HELP=`GrowBlocks CLI ${VERSION}: build, check and ship Dev Kit games.

  login                     sign in (opens the browser; you confirm a code)
  logout | whoami
  new <folder>              a new game folder from the starter kit
  dev [--port 5173]         serve this folder; play at http://localhost:5173/play.html
  check [--play]            run the checker; --play plays it headless and saves check-screenshot.png
  docs [topic]              the API (llms.txt), or one section of it: docs gb.net
  games                     your games and their status
  create <address> --name "My Game" [--tagline ..] [--description ..] [--players 8] [--logo logo.webp]
  link <address>            link this folder to one of your games
  update [--name ..] [--tagline ..] [--description ..] [--studio ..] [--players ..] [--logo logo.webp]
  push [--no-check] [--open]  upload this folder as a test build; prints the test link
  submit                    send the test build to GrowBlocks for review
  status | open [--live]    this game's status | open its test (or live) link
  blocks [words]            search blocks: parts of games others published (a kart, a mode, an enemy brain)
  add <block>[@version]     add a block to this game (into blocks/<block>/); its author earns from your game
  block init <address> [--fork slug@version] | block publish | block status | block info <block>
  mcp                       run as an MCP server (Claude Code, Cursor...): see .mcp.json

Options: --dir <folder>  --site <url>   Env: GROWBLOCKS_SITE, GROWBLOCKS_TOKEN
Docs: ${DEFAULT_SITE}/devkit.html`;
async function main(){
 const [cmd,...rest]=process.argv.slice(2),o=parseArgs(rest);
 if(!cmd||cmd==='help'||cmd==='--help'||cmd==='-h'){console.log(HELP);return;}
 if(cmd==='--version'||cmd==='version'){console.log(VERSION);return;}
 if(cmd==='mcp')return mcp();
 if(!C[cmd]){console.error('Unknown command: '+cmd+'\n\n'+HELP);process.exit(2);}
 try{const r=await C[cmd](o,l=>console.log(l));if(cmd==='check'&&!r.ok)process.exit(1);}
 catch(e){console.error((e.user?'':'Error: ')+e.message);process.exit(1);}
}
// Run as a command (node growblocks.mjs ...), not when a test imports it.
// npx runs it through a symlink (node_modules/.bin/growblocks), so compare real paths.
const real=p=>{try{return fs.realpathSync(p).toLowerCase();}catch{return path.resolve(p).toLowerCase();}};
const self=!!process.argv[1]&&real(process.argv[1])===real(fileURLToPath(import.meta.url));
if(self)main();
export {C as commands,TOOLS,buildFiles,parseArgs,VERSION};
