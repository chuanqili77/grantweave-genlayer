import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createAccount, createClient } from 'genlayer-js';
import { studionet } from 'genlayer-js/chains';
import { getAddress } from 'viem';
import { normalizeReceipt, successful, validateSnapshot, used } from '../src/model.js';

// Wallet keys come from environment variables. Every write uses zero transfer value.
const projectKey = process.env.GRANTWEAVE_PRIVATE_KEY;
const aKey = process.env.GRANTWEAVE_FUNDER_A_KEY;
const bKey = process.env.GRANTWEAVE_FUNDER_B_KEY;
if (![projectKey, aKey, bKey].every(k => /^0x[0-9a-fA-F]{64}$/.test(k || '')))
  throw Error('Set GRANTWEAVE_PRIVATE_KEY, GRANTWEAVE_FUNDER_A_KEY and GRANTWEAVE_FUNDER_B_KEY to three test wallet keys');
const keys = { project: projectKey, a: aKey, b: bKey };
const accounts = Object.fromEntries(Object.entries(keys).map(([role,key])=>[role,createAccount(key)]));
const clients = Object.fromEntries(Object.entries(accounts).map(([role,account])=>[role,createClient({chain:studionet,account})]));
const addr = role => accounts[role].address.toLowerCase();
const path = 'deployments/studionet-v2.json', evidencePath = 'deployments/studionet-v2-verification.json';
await mkdir('deployments',{recursive:true});
const source = await readFile('public/contracts/grant_overlap_v2.py','utf8');
const sourceSha256 = createHash('sha256').update(source).digest('hex');
const load = async p => {try{return JSON.parse(await readFile(p,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;return null}};
const save = (p,s)=>writeFile(p,JSON.stringify(s,null,2)+'\n');
let deployment=await load(path);
if(!deployment){
 const args=['GrantWeave Shared Approval Ledger','USD',accounts.a.address,accounts.b.address];
 const hash=await clients.project.deployContract({code:source,args,leaderOnly:false});
 deployment={schema:2,chainId:61999,network:'studionet',project:args[0],currency:args[1],sourceSha256,constructorArgs:args,
 projectParty:accounts.project.address,funders:[accounts.a.address,accounts.b.address],transactionHash:hash,status:'submitted',valueTransferred:'0'};
 await save(path,deployment); console.log('Deployment submitted',hash);
}
assert.equal(deployment.sourceSha256,sourceSha256);
assert.equal(deployment.projectParty.toLowerCase(),addr('project'));
assert.deepEqual(deployment.funders.map(x=>x.toLowerCase()),[addr('a'),addr('b')]);
const wait = async (client,hash)=>normalizeReceipt(await client.waitForTransactionReceipt({hash,status:'FINALIZED',interval:5000,retries:120,fullTransaction:true}));
if(deployment.status!=='FINALIZED'){
 const r=await wait(clients.project,deployment.transactionHash);
 deployment.status=r.statusName; deployment.execution=r.txExecutionResultName;
 deployment.contractAddress=r.txDataDecoded?.contractAddress||r.data?.contract_address;
 await save(path,deployment);assert.ok(successful(r));
}
const address=getAddress(deployment.contractAddress);
const snapshot=async()=>validateSnapshot(await clients.project.readContract({address,functionName:'snapshot',args:[],transactionHashVariant:'latest-final'}));
assert.equal((await snapshot()).project_party,addr('project'));
let evidence=await load(evidencePath)||{schema:2,chainId:61999,contractAddress:address,sourceSha256,
 projectParty:accounts.project.address,funders:deployment.funders,valueTransferred:'0',
 testScope:'Three controlled test wallets verify address-based permissions; they do not represent independent organizations. Model decisions are real network results; invoice facts are synthetic.',steps:[]};
assert.equal(evidence.contractAddress,address);
async function step(name,role,functionName,args,expectedSuccess,check,allowDisagreement=false){
 let entry=evidence.steps.find(x=>x.name===name);if(entry?.verified)return;
 if(!entry){const before=await snapshot();const hash=await clients[role].writeContract({address,functionName,args,value:0n,leaderOnly:false});
 entry={name,caller:accounts[role].address,functionName,args,value:'0',expectedSuccess,transactionHash:hash,before};evidence.steps.push(entry);await save(evidencePath,evidence);console.log(name,'submitted',hash)}
 const r=await wait(clients[role],entry.transactionHash);
 const raw=r.consensus_data?.leader_receipt;const leaders=Array.isArray(raw)?raw:raw?[raw]:[];
 entry.receipt={status:r.statusName,execution:r.txExecutionResultName,result:r.resultName,votes:r.consensus_data?.votes,
 leaders:leaders.map(x=>({mode:x.mode,execution:x.execution_result,result:x.result,equivalenceOutputs:x.eq_outputs}))};
 await save(evidencePath,evidence);assert.equal(r.statusName,'FINALIZED');
 if(expectedSuccess && !successful(r) && r.resultName==='MAJORITY_DISAGREE' && allowDisagreement){
   entry.after=await snapshot();assert.deepEqual(entry.after,entry.before);
   entry.actualSuccess=false;entry.outcome='validator-disagreement-state-unchanged';entry.verified=true;
   await save(evidencePath,evidence);console.log(name,'verified fail-closed disagreement');return;
 }
 assert.equal(successful(r),expectedSuccess, name+': unexpected result');
 entry.after=await snapshot();if(!expectedSuccess)assert.deepEqual(entry.after,entry.before);check?.(entry.after);entry.verified=true;await save(evidencePath,evidence);console.log(name,'verified');
}
const invoice='Synthetic test invoice LAB-104. Supplier North Lab Tools. One microscope model M1 delivered 2026-10-01 to Community Workshop. Full single purchase USD 1200.00. No other items.';
await step('propose-microscope','project','propose_cost',['One workshop microscope',invoice,120000],true,s=>assert.equal(s.proposals.length,1));
await step('reject-project-self-approval','project','approve_cost',[1],false);
await step('approve-funder-a','a','approve_cost',[1],true);
await step('reject-one-approval-activation','project','activate_cost',[1],false);
await step('approve-funder-b','b','approve_cost',[1],true);
await step('activate-approved-cost','project','activate_cost',[1],true,s=>assert.equal(s.costs.length,1));
await step('reject-project-reservation','project','reserve',[1,1,'PROJECT-DENIED'],false);
await step('reserve-funder-a','a','reserve',[1,70000,'A-001'],true,s=>assert.equal(s.reservations[0].funder,addr('a')));
await step('reserve-funder-b','b','reserve',[1,50000,'B-001'],true,s=>assert.equal(used(s,1),120000));
await step('reject-shared-over-cap','b','reserve',[1,1,'OVER-001'],false);
await step('reject-other-funder-release','b','release',[1],false);
await step('reject-project-release','project','release',[1],false);
await step('release-own-reservation','a','release',[1],true,s=>{assert.equal(s.reservations[0].active,false);assert.equal(used(s,1),50000)});
await step('propose-renamed-duplicate','a','propose_cost',['Optical research equipment',invoice+' This is exactly the same LAB-104 purchase already registered, with no additional items.',120000],true);
await step('approve-duplicate-a','a','approve_cost',[2],true);
await step('approve-duplicate-b','b','approve_cost',[2],true);
await step('reject-duplicate-despite-both-approvals','project','activate_cost',[2],false,s=>assert.equal(s.costs.length,1));
await step('propose-distinct-hall','b','propose_cost',['Community hall hire','Synthetic invoice HALL-22. Supplier East Hall Association. Hall B rental November 12-13 2026, USD 400.00. No microscope or laboratory equipment; independent purchase from LAB-104.',40000],true);
await step('approve-hall-a','a','approve_cost',[3],true);
await step('approve-hall-b','b','approve_cost',[3],true);
await step('activate-distinct-hall','b','activate_cost',[3],true,s=>assert.equal(s.costs.length,2),true);
if ((await snapshot()).costs.length === 1) {
await step('propose-clarified-hall','project','propose_cost',['Hall B rental for two evenings',
 'Synthetic test invoice HALL-22 issued by East Hall Association on 2026-10-15. Purchase category: venue rental service. Booking HALL-B-NOV12-13. Deliverable: exclusive use of Hall B, 20 River Road, for the two sessions 2026-11-12 18:00-22:00 and 2026-11-13 18:00-22:00. Quantity two evenings at USD 200.00 each, total USD 400.00. This proposal replaces the unactivated venue proposal with complete booking facts.',40000],true);
await step('approve-clarified-hall-a','a','approve_cost',[4],true);
await step('approve-clarified-hall-b','b','approve_cost',[4],true);
await step('activate-clarified-hall','a','activate_cost',[4],true,s=>assert.equal(s.costs.length,2),true);
}
evidence.completedAt=new Date().toISOString();evidence.finalSnapshot=await snapshot();evidence.observations=evidence.steps.filter(x=>x.outcome==='validator-disagreement-state-unchanged').map(x=>({transactionHash:x.transactionHash,description:'Leader returned successfully but a majority of validators disagreed. Activation did not commit state. A clarified proposal requires fresh approvals.'}));await save(evidencePath,evidence);
console.log('All',evidence.steps.length,'V2 chain checks verified',address);process.exit(0);
