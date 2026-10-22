import { chromium } from "playwright";
import { createServer, preview } from "vite";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const base = process.env.APP_URL || "http://127.0.0.1:4174";
const dev = process.env.DEV_URL || "http://127.0.0.1:5173";
const launch = { headless: true };
if (process.env.PLAYWRIGHT_EXECUTABLE_PATH) {
  launch.executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH;
  launch.args = [
    "--no-sandbox",
    "--font-render-hinting=none",
    "--disable-gpu",
    "--disable-software-rasterizer",
    "--single-process",
    "--no-zygote",
  ];
}
const devServer = process.env.DEV_URL
  ? null
  : await createServer({
      server: { host: "127.0.0.1", port: 5173, strictPort: true },
    });
await devServer?.listen();
const previewServer = process.env.APP_URL
  ? null
  : await preview({
      preview: { host: "127.0.0.1", port: 4174, strictPort: true },
    });
const browser = await chromium.launch(launch);
const errors = [];
try {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1100 },
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base);
  await page.locator("h1").waitFor();
  assert.equal(await page.locator(".cost").count(), 2);
  assert.equal(await page.locator("#register button").isDisabled(), true);
  await page.locator("#reserve [name=source]").fill("Local sponsor");
  await page.locator("#reserve [name=amount]").fill("500.00");
  await page.locator("#reserve [name=reference]").fill("LOCAL-001");
  await page.locator("#reserve button").click();
  await page
    .getByText("Expense 1 · LOCAL-001 · Reserved", { exact: true })
    .waitFor();
  await page.locator("#reserve [name=amount]").fill("0.01");
  await page.locator("#reserve [name=reference]").fill("OVER-CAP");
  await page.locator("#reserve button").click();
  await page.getByText("Expense capacity exceeded", { exact: true }).waitFor();
  await page.locator(".release").first().click();
  await page
    .getByText("Expense 1 · SCI-001 · Released", { exact: true })
    .waitFor();
  const downloadEvent = page.waitForEvent("download");
  await page.locator("#export").click();
  const download = await downloadEvent;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.mode, "demo");
  assert.equal(exported.contract, null);
  assert.equal(exported.ledger.reservations.length, 2);
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.SCREENSHOT_DIR + "/desktop.png",
      fullPage: true,
    });
  await page.locator("#mode").click();
  await page
    .getByRole("heading", { name: "Read a project contract" })
    .waitFor();
  assert.equal(await page.locator(".cost").count(), 0);
  assert.ok(await page.locator("#export").isDisabled());
  await page.locator("#mode").click();
  await page.locator(".cost").first().waitFor();
  for (const width of [320, 390, 768]) {
    await page.setViewportSize({ width, height: 844 });
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `Overflow at ${width}px`,
    );
  }
  if (process.env.SCREENSHOT_DIR)
    await page.screenshot({
      path: process.env.SCREENSHOT_DIR + "/mobile.png",
      fullPage: true,
    });
  // Keep the first context alive for single-process browser runners.
  console.log(
    "Production UI: reserve, over-cap rejection, release, JSON download, mode isolation, disabled semantic demo, responsive 320/390/768px passed.",
  );

  // Live UI tests replace only the adapter module on the local development server.
  // They simulate wallet/RPC behavior and never constitute blockchain evidence.
  const live = await browser.newContext({
    viewport: { width: 1280, height: 1000 },
  });
  await live.addInitScript(() => {
    const owner = "0x" + "1".repeat(40);
    window.__fixture = {
      owner,
      account: owner,
      chain: 61999,
      failRead: false,
      failWait: false,
      decline: false,
      writes: 0,
      status: "FINALIZED",
      execution: "FINISHED_WITH_RETURN",
      result: "MAJORITY_AGREE",
      listeners: {},
    };
    window.ethereum = {
      on: (name, fn) => (window.__fixture.listeners[name] = fn),
    };
  });
  await live.route("**/src/network.js", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
 import {reserveDemo} from '/src/model.js';
 export function createAdapter(){
 const f=window.__fixture, hash='0x'+'f'.repeat(64);
 const initial={schema:1,project:'Simulated live project',currency:'USD',owner:f.owner,costs:[{id:1,description:'Microscope',evidence:'Invoice LAB-104, one unit',cap:120000}],reservations:[]};
 let state=JSON.parse(localStorage.getItem('fixture-ledger')||'null')||initial;
 return {chainId:61999,connect:async()=>{if(f.decline)throw Object.assign(Error('Declined'),{code:4001});return f.account;},accounts:async()=>[f.account],chain:async()=>f.chain,
 read:async()=>{if(f.failRead)throw Error('Simulated RPC outage');return JSON.stringify(state);},
 transaction:async()=>({recipient:'0x'+'a'.repeat(40)}),
 wait:async()=>{if(f.failWait)throw Error('Timeout');return {statusName:f.status,txExecutionResultName:f.execution,resultName:f.result};},
 write:async(address,account,name,args)=>{f.writes++;if(f.execution==='FINISHED_WITH_RETURN'&&f.result==='MAJORITY_AGREE'){if(name==='reserve')reserveDemo(state,...args);else if(name==='release')state.reservations.find(r=>r.id===args[0]).active=false;}localStorage.setItem('fixture-ledger',JSON.stringify(state));return hash;}};}
 `,
    }),
  );
  const p = await live.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  await p.goto(dev);
  await p.locator("#mode").click();
  await p.locator("#address").fill("0x" + "a".repeat(40));
  await p.locator("#load").click();
  await p.getByRole("heading", { name: "Simulated live project" }).waitFor();
  await p
    .locator("#reserve [name=source]")
    .fill('<img src=x onerror="window.xss=1">');
  await p.locator("#reserve [name=amount]").fill("100.00");
  await p.locator("#reserve [name=reference]").fill("TEST-001");
  await p.evaluate(() => (window.__fixture.decline = true));
  await p.locator("#reserve button").click();
  await p
    .getByText("Wallet request declined. No new transaction was submitted.", {
      exact: true,
    })
    .waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 0);
  await p.evaluate(() => {
    window.__fixture.decline = false;
    window.__fixture.chain = 1;
  });
  await p.locator("#reserve button").click();
  await p
    .getByText("Switch wallet to Studionet before writing", { exact: true })
    .waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 0);
  await p.evaluate(() => {
    window.__fixture.chain = 61999;
    window.__fixture.failWait = true;
  });
  await p.locator("#reserve button").click();
  await p.locator("#notice").filter({ hasText: "Tracking paused" }).waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 1);
  await p.locator("#reserve button").click();
  await p
    .getByText("Resume the existing transaction before another write", {
      exact: true,
    })
    .waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 1);
  await p.reload();
  await p.locator("#mode").click();
  await p.locator("#load").click();
  await p.getByRole("heading", { name: "Simulated live project" }).waitFor();
  await p.locator("#recover").click();
  await p
    .locator("#notice")
    .filter({ hasText: "Finalized successfully" })
    .waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 0);
  assert.equal(await p.evaluate(() => window.xss), undefined);
  assert.equal(await p.locator("#history img").count(), 0);
  await p.evaluate(() => {
    window.__fixture.account = "0x" + "2".repeat(40);
    window.__fixture.listeners.accountsChanged();
  });
  await p.locator("#reserve [name=source]").fill("Local sponsor");
  await p.locator("#reserve [name=amount]").fill("1.00");
  await p.locator("#reserve [name=reference]").fill("TEST-002");
  await p.locator("#reserve button").click();
  await p.locator("#notice").filter({ hasText: "read-only access" }).waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 0);
  await p.evaluate(() => {
    window.__fixture.account = window.__fixture.owner;
    window.__fixture.execution = 'FINISHED_WITH_ERROR';
    window.__fixture.listeners.accountsChanged();
  });
  await p.locator('#reserve button').click();
  await p.locator('#notice').filter({hasText:'Transaction ended without success'}).waitFor();
  assert.equal(await p.evaluate(() => window.__fixture.writes), 1);
  assert.equal(await p.evaluate(() => Object.keys(localStorage).filter(k=>k.startsWith('grantweave-pending-')).length), 0);
  await p.evaluate(() => {window.__fixture.execution='FINISHED_WITH_RETURN';window.__fixture.result='MAJORITY_DISAGREE';});
  await p.locator('#reserve button').click();
  await p.locator('#notice').filter({hasText:'MAJORITY_DISAGREE'}).waitFor();
  assert.equal(await p.locator('#history').getByText('Expense 1 · TEST-002 · Reserved',{exact:true}).count(),0);
  await p.evaluate(() => (window.__fixture.failRead = true));
  await p.locator("#address").fill("0x" + "b".repeat(40));
  await p.locator("#load").click();
  await p.getByText("Simulated RPC outage", { exact: true }).waitFor();
  assert.equal(await p.locator(".cost").count(), 0);
  assert.ok(await p.locator("#export").isDisabled());
  assert.deepEqual(errors, []);
  console.log(
    "Simulated live UI: public read, declined signature, wrong network, timeout and refresh recovery, duplicate-submit block, account change, finalized execution failure, XSS escaping and failed-address read isolation passed. No page errors.",
  );
  // V2 UI permissions are tested separately from actual chain evidence.
  const v2 = await browser.newContext({ viewport: { width: 1280, height: 1100 } });
  await v2.addInitScript(() => {
    const project = '0x'+'1'.repeat(40), a = '0x'+'a'.repeat(40), b = '0x'+'b'.repeat(40);
    window.__v2 = {project,a,b,account:project,writes:[],listeners:{}};
    window.ethereum={on:(event,fn)=>window.__v2.listeners[event]=fn};
  });
  await v2.route('**/src/network.js', route=>route.fulfill({contentType:'application/javascript',body:`
    export function createAdapter(){const f=window.__v2;
    const state={schema:2,project:'Shared approval test',currency:'USD',project_party:f.project,funders:[f.a,f.b],required_approvals:2,proposals:[],costs:[],reservations:[]};
    return {chainId:61999,connect:async()=>f.account,accounts:async()=>[f.account],chain:async()=>61999,
      read:async()=>JSON.stringify(state),wait:async()=>({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',resultName:'MAJORITY_AGREE'}),
      write:async(address,account,name,args)=>{f.writes.push({account,name,args});
        if(name==='propose_cost')state.proposals.push({id:state.proposals.length+1,proposer:account,description:args[0],evidence:args[1],cap:args[2],status:'PENDING',approvals:[]});
        if(name==='approve_cost')state.proposals[args[0]-1].approvals.push(account);
        if(name==='activate_cost'){const p=state.proposals[args[0]-1];p.status='ACTIVE';p.cost_id=state.costs.length+1;state.costs.push({id:p.cost_id,proposal_id:p.id,description:p.description,evidence:p.evidence,cap:p.cap});}
        if(name==='reserve')state.reservations.push({id:state.reservations.length+1,cost_id:args[0],funder:account,amount:args[1],reference:args[2],active:true});
        if(name==='release')state.reservations[args[0]-1].active=false;
        return '0x'+'e'.repeat(64);}};}` }));
  const q=await v2.newPage();q.on('pageerror',e=>errors.push(e.message));
  await q.goto(dev);await q.locator('#mode').click();await q.locator('#load').click();
  await q.getByRole('heading',{name:'Shared approval test'}).waitFor();
  assert.ok(await q.locator('#register button').isDisabled());
  await q.locator('#wallet').click();
  await q.locator('#participants').filter({hasText:'Project party'}).waitFor();
  await q.locator('#register [name=description]').fill('Microscope');
  await q.locator('#register [name=evidence]').fill('Synthetic invoice LAB-104');
  await q.locator('#register [name=cap]').fill('1200.00');await q.locator('#register button').click();
  await q.locator('#proposals').filter({hasText:'0/2 approvals'}).waitFor();
  assert.ok(await q.locator('[data-method=approve_cost]').isDisabled());
  assert.ok(await q.locator('[data-method=activate_cost]').isDisabled());
  const switchRole=async role=>{
    await q.evaluate(role=>{const f=window.__v2;f.account=f[role];f.listeners.accountsChanged();},role);
    if(await q.locator('[data-method=approve_cost]').count()) assert.ok(await q.locator('[data-method=approve_cost]').isDisabled());
    await q.locator('#wallet').click();
  };
  await switchRole('a');await q.locator('[data-method=approve_cost]').click();
  await q.locator('#proposals').filter({hasText:'1/2 approvals'}).waitFor();
  assert.ok(await q.locator('[data-method=approve_cost]').isDisabled());
  assert.ok(await q.locator('[data-method=activate_cost]').isDisabled());
  await switchRole('b');await q.locator('[data-method=approve_cost]').click();
  await q.locator('#proposals').filter({hasText:'2/2 approvals'}).waitFor();
  await q.locator('[data-method=activate_cost]').click();
  await q.locator('#cost-select option').waitFor({state:'attached'});
  assert.equal(await q.locator('#source-label').isVisible(),false);
  await q.locator('#reserve [name=amount]').fill('500.00');
  await q.locator('#reserve [name=reference]').fill('B-001');await q.locator('#reserve button').click();
  await q.locator('#history').filter({hasText:'B-001'}).waitFor();
  assert.deepEqual(await q.evaluate(()=>window.__v2.writes.at(-1).args),[1,50000,'B-001']);
  await switchRole('a');assert.ok(await q.locator('.release').isDisabled());
  await switchRole('project');assert.ok(await q.locator('.release').isDisabled());
  assert.ok(await q.locator('#reserve button').isDisabled());
  await switchRole('b');await q.locator('.release').click();
  await q.locator('#history').filter({hasText:'Released'}).waitFor();
  for(const width of [390,768,1280]){await q.setViewportSize({width,height:1000});assert.ok(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth), 'V2 viewport overflow at '+width);}
  assert.deepEqual(errors,[]);
  console.log('V2 browser: proposal, distinct wallet approvals, activation, address-bound reserve arguments, owner-only release and responsive layout passed.');

  if (process.env.LIVE_CONTRACT_ADDRESS) {
    const actual=await context.newPage();actual.on('pageerror',e=>errors.push(e.message));
    await actual.goto(base);await actual.locator('#mode').click();
    await actual.locator('#address').fill(process.env.LIVE_CONTRACT_ADDRESS);
    await actual.locator('#load').click();
    await actual.locator('#participants').waitFor({state:'visible',timeout:120000});
    assert.match(await actual.locator('#participants').innerText(),/Funder 1[\s\S]*Funder 2/);
    assert.ok(await actual.locator('#register button').isDisabled());
    const event=actual.waitForEvent('download');await actual.locator('#export').click();
    const saved=await event;
    const liveExport=JSON.parse(await readFile(await saved.path(),'utf8'));
    assert.equal(liveExport.mode,'live');assert.equal(liveExport.chainId,61999);
    assert.equal(liveExport.contract,process.env.LIVE_CONTRACT_ADDRESS.toLowerCase());
    assert.equal(liveExport.stateFresh,true);assert.equal(liveExport.ledger.schema,2);
    assert.equal(liveExport.ledger.required_approvals,2);
    if(process.env.SCREENSHOT_DIR)await actual.screenshot({path:process.env.SCREENSHOT_DIR+'/v2-live.png',fullPage:true});
    console.log('Real V2 public read and live JSON export passed:',liveExport.contract);
  }

} finally {
  await browser.close();
  await devServer?.close();
  if (previewServer)
    await new Promise((resolve) => previewServer.httpServer.close(resolve));
}
