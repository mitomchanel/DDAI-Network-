/**
 * ddai_bot.js
 * Multi-Account DDAI Bot
 */

if (process.platform === 'win32') {
  const { spawnSync } = require('child_process');
  spawnSync('chcp', ['65001'], { stdio: 'inherit' });
  process.stdin.setEncoding('utf8');
  process.stdout.setEncoding('utf8');
  process.stderr.setEncoding('utf8');
}

require('dotenv').config();
const fs        = require('fs');
const axios     = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { SocksProxyAgent } = require('socks-proxy-agent');
const chalk     = require('chalk');
const readline  = require('readline-sync');

const ACCOUNTS_FILE      = 'accounts.json';
const PROXIES_FILE       = 'proxies.txt';
const TOKEN_DIR          = 'tokens';
const AXIOS_TIMEOUT      = 120_000;
const CYCLE_DELAY        = 60_000;
const MAX_PROXY_ATTEMPTS = 5;

let AUTO_REFERRALS = false;

const allProxies = fs.existsSync(PROXIES_FILE)
  ? fs.readFileSync(PROXIES_FILE, 'utf8').split('\n').map(l=>l.trim()).filter(Boolean)
  : [];

function ensureDir(d)    { if (!fs.existsSync(d)) fs.mkdirSync(d); }
function ensureFile(f,c) { if (!fs.existsSync(f)) fs.writeFileSync(f,c); }
function loadJSON(f)     { try { return JSON.parse(fs.readFileSync(f,'utf8')); } catch { console.error(chalk.red(`Lỗi ${f}`)); process.exit(1);} }
function saveJSON(f,o)   { fs.writeFileSync(f, JSON.stringify(o,null,2)); }
function tokenPath(u)    { return `${TOKEN_DIR}/${u}.token`; }
function readToken(u)    { return fs.existsSync(tokenPath(u)) ? fs.readFileSync(tokenPath(u),'utf8').trim() : ''; }
function writeToken(u,t) { fs.writeFileSync(tokenPath(u),t); }
const delay = ms => new Promise(r=>setTimeout(r,ms));

const logger = {
  info:    (u,m)=>console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`)+' '+chalk.bgBlue.black(` ${u} `)+' '+chalk.white(m)),
  success: (u,m)=>console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`)+' '+chalk.bgGreen.black(` ${u} `)+' '+chalk.green(m)),
  warn:    (u,m)=>console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`)+' '+chalk.bgYellow.black(` ${u} `)+' '+chalk.yellow(m)),
  error:   (u,m)=>console.log(chalk.gray(`[${new Date().toLocaleTimeString()}]`)+' '+chalk.bgRed.black(` ${u} `)+' '+chalk.red(m)),
};

function showBanner(){
  console.clear();
  console.log(chalk.cyan.bold(`
    DDAI Network Bot - https://t.me/mitomchanel
  `));
}

function manageAccounts(){
  ensureFile(ACCOUNTS_FILE,'[]');
  let accounts = loadJSON(ACCOUNTS_FILE);

  while(true){
    console.log(chalk.blue('\nAccounts:'));
    if(!accounts.length) console.log(chalk.yellow('  (empty list)'));
    else accounts.forEach((a,i)=>console.log(`  ${i+1}. ${a.username}`));

    console.log('\n1. Thêm Account');
    console.log('2. Xóa Bớt Account');
    console.log('3. Bắt Đầu Farming');
    const c = readline.question('> ');

    if(c==='1'){
      const u = readline.question('Username: ');
      const p = readline.question('Password: ', { hideEchoBack:true });
      accounts.push({ username:u, password:p });
      saveJSON(ACCOUNTS_FILE, accounts);
      console.log(chalk.green(`✓ ${u} added`));

    } else if(c==='2'){
      const i = +readline.question('Delete #: ')-1;
      if(accounts[i]){
        console.log(chalk.green(`✓ ${accounts[i].username} deleted`));
        accounts.splice(i,1);
        saveJSON(ACCOUNTS_FILE, accounts);
      } else {
        console.log(chalk.red('✗ Invalid number'));
      }

    } else if(c==='4'){
      AUTO_REFERRALS = !AUTO_REFERRALS;
      console.log(chalk.green(`Auto-referrals ${AUTO_REFERRALS ? 'enabled' : 'disabled'}`));

    } else if(c==='3' && accounts.length){

      console.log(chalk.yellow('\nNhập số lượng Account muốn chạy,Nhập "all" để chạy tất cả:'));
      const sel = readline.question('> ').trim().toLowerCase();
      let indices;
      if(sel === 'all'){
        indices = accounts.map((_,i)=>i);
      } else {
        indices = sel.split(',')
          .map(s=>parseInt(s,10)-1)
          .filter(i=>i>=0 && i<accounts.length);
      }
      if(indices.length === 0){
        console.log(chalk.red('✗ No valid numbers, try again'));
      } else {
        return indices.map(i=>accounts[i]);
      }

    } else {
      console.log(chalk.red('✗ Invalid choice'));
    }
  }
}

function makeClientByIndex(idx){
  const cfg = { timeout: AXIOS_TIMEOUT, proxy:false };
  if(allProxies.length === 0) return axios.create(cfg);

  const raw = allProxies[idx];
  let agent;
  if(raw.startsWith('socks5://')){
    agent = new SocksProxyAgent(raw);
    logger.info('Proxy', `using SOCKS5 [${idx+1}/${allProxies.length}] ${raw}`);
  } else {
    const url = raw.startsWith('http')? raw : `http://${raw}`;
    agent = new HttpsProxyAgent(url);
    logger.info('Proxy', `using HTTP [${idx+1}/${allProxies.length}] ${url}`);
  }
  cfg.httpAgent = cfg.httpsAgent = agent;
  return axios.create(cfg);
}

function makeHeaders(token=''){
  return {
    Accept:        'application/json',
    Authorization: token? `Bearer ${token}` : '',
    Referer:       'https://app.ddai.network/'
  };
}


function rotateProxy(session){
  if(allProxies.length === 0) return;
  session.proxyIndex = (session.proxyIndex + 1) % allProxies.length;
  session.client     = makeClientByIndex(session.proxyIndex);
}


async function login(session){
  for(let i=1; i<=MAX_PROXY_ATTEMPTS; i++){
    logger.info(session.username, `Login via proxy attempt ${i}/${MAX_PROXY_ATTEMPTS}`);
    try {
      const res = await session.client.post(
        'https://auth.ddai.network/login',
        { username: session.username, password: session.password },
        { headers: makeHeaders(), timeout: AXIOS_TIMEOUT }
      );
      session.token = res.data.data.accessToken;
      writeToken(session.username, session.token);
      logger.success(session.username, 'Login successful');
      return;
    } catch(err){
      logger.warn(session.username, `Proxy login err: ${err.code||err.message}`);
      rotateProxy(session);
      await delay(1000);
    }
  }

  session.client = axios.create({ timeout: AXIOS_TIMEOUT, proxy:false });
  for(let i=1; i<=2; i++){
    logger.info(session.username, `Login via direct attempt ${i}/2`);
    try {
      const res = await session.client.post(
        'https://auth.ddai.network/login',
        { username: session.username, password: session.password },
        { headers: makeHeaders(), timeout: AXIOS_TIMEOUT }
      );
      session.token = res.data.data.accessToken;
      writeToken(session.username, session.token);
      logger.success(session.username, 'Login successful (direct)');
      return;
    } catch(err){
      logger.warn(session.username, `Direct login err: ${err.code||err.message}`);
      await delay(1000);
    }
  }
  logger.error(session.username, 'Login failed');
}

// === Fetch missions ===
async function fetchMissions(session){
  for(let i=1; i<=MAX_PROXY_ATTEMPTS; i++){
    try {
      const res = await session.client.get(
        'https://auth.ddai.network/missions',
        { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
      );
      return res.data.data.missions;
    } catch(err){
      if(err.code==='ECONNRESET' || err.message.includes('Proxy')){
        logger.warn(session.username, `fetchMissions proxy err, rotate (${i}/${MAX_PROXY_ATTEMPTS})`);
        rotateProxy(session);
        continue;
      }
      if(err.response?.status===401) return 'expired';
      logger.error(session.username, `fetchMissions err: ${err.code||err.message}`);
      return null;
    }
  }
  // direct fallback once
  session.client = axios.create({ timeout: AXIOS_TIMEOUT, proxy:false });
  try {
    const res = await session.client.get(
      'https://auth.ddai.network/missions',
      { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
    );
    return res.data.data.missions;
  } catch(err){
    if(err.response?.status===401) return 'expired';
    logger.error(session.username, `fetchMissions direct err: ${err.code||err.message}`);
    return null;
  }
}

// === Claim mission ===
async function claimMission(session, m){
  for(let i=1; i<=MAX_PROXY_ATTEMPTS; i++){
    try {
      const res = await session.client.post(
        `https://auth.ddai.network/missions/claim/${m._id}`,
        null,
        { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
      );
      logger.success(session.username, `+${res.data.data.rewards.requests} req`);
      return;
    } catch(err){
      if(err.response){
        logger.error(session.username,
          `claim HTTP ${err.response.status} — ${JSON.stringify(err.response.data)}`);
        if(err.response.status===401) return 'expired';
        return;
      }
      if(err.code==='ECONNRESET' || err.message.includes('Proxy')){
        logger.warn(session.username, `claim proxy err, rotate (${i}/${MAX_PROXY_ATTEMPTS})`);
        rotateProxy(session);
        continue;
      }
      logger.error(session.username, `claim err: ${err.code||err.message}`);
      return;
    }
  }
  // direct fallback once
  session.client = axios.create({ timeout: AXIOS_TIMEOUT, proxy:false });
  try {
    const res = await session.client.post(
      `https://auth.ddai.network/missions/claim/${m._id}`,
      null,
      { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
    );
    logger.success(session.username, `+${res.data.data.rewards.requests} req (direct)`);
  } catch(err){
    if(err.response?.status===401) return 'expired';
    logger.error(session.username, `claim direct err: ${err.code||err.message}`);
  }
}

// === Handle missions + подсчёт ===
async function handleMissions(session){
  let missions = await fetchMissions(session);
  if(missions==='expired'){
    await login(session);
    missions = await fetchMissions(session);
  }
  if(!Array.isArray(missions)) return true;

  const total   = missions.length;
  const pending = missions.filter(x=>x.status==='PENDING');
  const done    = total - pending.length;

  let toDo = pending;
  if(!AUTO_REFERRALS){
    toDo = pending.filter(m=>
      !/invite/i.test(m.title) &&
      !/referral/i.test(m.title)
    );
  }
  const afterFilter = toDo.length;

  logger.info(session.username,
    `Total: ${total}, Completed: ${done}, Pending: ${pending.length}, After filter: ${afterFilter}`);

  if(afterFilter === 0){
    logger.info(session.username, 'All tasks (after filter) completed — ending session');
    return false;
  }

  for(const m of toDo){
    const r = await claimMission(session, m);
    if(r==='expired'){
      await login(session);
      await claimMission(session, m);
    }
    await delay(2000);
  }
  return true;
}

// === Model & Onchain ===
async function doModel(session){
  try {
    const res = await session.client.get(
      'https://auth.ddai.network/modelResponse',
      { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
    );
    logger.info(session.username, `throughput ${res.data.data.throughput}`);
  } catch{}
}
async function doOnchain(session){
  try {
    const res = await session.client.post(
      'https://auth.ddai.network/onchainTrigger',
      null,
      { headers: makeHeaders(session.token), timeout: AXIOS_TIMEOUT }
    );
    logger.info(session.username, `total ${res.data.data.requestsTotal}`);
  } catch{}
}

// === Farm loop ===
async function farmSession(sess){
  sess.proxyIndex = sess.initialProxyIndex || 0;
  sess.client     = makeClientByIndex(sess.proxyIndex);
  sess.token      = readToken(sess.username) || '';

  logger.info(sess.username, `start (proxyIdx: ${sess.proxyIndex+1}/${allProxies.length||1})`);
  if(!sess.token) await login(sess);

  while(true){
    const ok = await handleMissions(sess);
    if(!ok) break;
    await doModel(sess);
    await doOnchain(sess);
    await delay(CYCLE_DELAY);
  }
  logger.info(sess.username, 'Session ended');
}

// === MAIN ===
(async()=>{
  showBanner();
  ensureDir(TOKEN_DIR);
  ensureFile(ACCOUNTS_FILE,'[]');
  ensureFile(PROXIES_FILE,'');

  const selectedAccounts = manageAccounts();
  const sessions = selectedAccounts.map((a,i)=>({
    username: a.username,
    password: a.password,
    initialProxyIndex: i % (allProxies.length || 1)
  }));

  await Promise.all(sessions.map(farmSession));
})();
