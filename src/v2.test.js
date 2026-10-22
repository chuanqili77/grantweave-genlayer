import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, canWrite, walletRole } from './model.js';
import { LedgerSession } from './session.js';
const project = '0x' + '1'.repeat(40), a = '0x' + 'a'.repeat(40), b = '0x' + 'b'.repeat(40);
const fixture = () => ({schema:2,project:'Lab',currency:'USD',project_party:project,funders:[a,b],required_approvals:2,
  proposals:[{id:1,proposer:project,description:'Microscope',evidence:'LAB-104',cap:120000,approvals:[a,b],status:'ACTIVE',cost_id:1},
    {id:2,proposer:a,description:'Hall',evidence:'HALL-22',cap:40000,approvals:[a],status:'PENDING'}],
  costs:[{id:1,proposal_id:1,description:'Microscope',evidence:'LAB-104',cap:120000}],
  reservations:[{id:1,cost_id:1,funder:a,amount:70000,reference:'F-1',active:true},
    {id:2,cost_id:1,funder:b,amount:50000,reference:'F-1',active:true}]});
test('V2 snapshot validates participant-scoped references and immutable approval links', () => {
  assert.equal(validateSnapshot(JSON.stringify(fixture())).schema,2);
  for (const mutate of [s=>s.funders[1]=a,s=>s.required_approvals=1,s=>s.proposals[0].approvals=[a,a],
    s=>s.costs[0].cap=1,s=>s.proposals[1].status='ACTIVE',s=>s.reservations[1].funder=project,
    s=>s.reservations[1].funder=a]) {
    const s=fixture(); mutate(s); assert.throws(()=>validateSnapshot(s));
  }
});
test('V2 roles enforce consent and reservation ownership', () => {
  const s=fixture();
  assert.equal(walletRole(s,a.toUpperCase().replace('0X','0x')),'Funder 1');
  assert.equal(canWrite(s,project,'propose_cost'),true);
  assert.equal(canWrite(s,project,'approve_cost',[2]),false);
  assert.equal(canWrite(s,a,'approve_cost',[2]),false);
  assert.equal(canWrite(s,b,'approve_cost',[2]),true);
  assert.equal(canWrite(s,project,'activate_cost',[2]),false);
  s.proposals[1].approvals.push(b);
  assert.equal(canWrite(s,project,'activate_cost',[2]),true);
  assert.equal(canWrite(s,project,'reserve'),false);
  assert.equal(canWrite(s,a,'release',[1]),true);
  assert.equal(canWrite(s,b,'release',[1]),false);
  s.reservations[0].active=false;
  assert.equal(canWrite(s,a,'release',[1]),false);
  assert.equal(canWrite(s,a,'register_cost'),false);
});
test('V2 session blocks unauthorized writes before submission and preserves tracking for allowed writes',async()=>{
  const s=fixture(), values=new Map(), calls=[];
  let account=project;
  const adapter={chainId:61999,connect:async()=>account,accounts:async()=>[account],chain:async()=>61999,
    read:async()=>JSON.stringify(s),write:async(...args)=>{calls.push(args);return '0x'+'f'.repeat(64)},
    wait:async()=>({statusName:'FINALIZED',txExecutionResultName:'FINISHED_WITH_RETURN',resultName:'MAJORITY_AGREE'})};
  const session=new LedgerSession({adapter,storage:{getItem:k=>values.get(k)??null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}});
  await session.load('0x'+'9'.repeat(40));
  await assert.rejects(()=>session.write('approve_cost',[2]),/cannot perform/);
  assert.equal(calls.length,0);
  account=b;session.walletChanged();
  await assert.rejects(()=>session.write('release',[1]),/cannot perform/);
  assert.equal(calls.length,0);
  await session.write('approve_cost',[2]);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].slice(2),['approve_cost',[2]]);
  assert.equal(session.pending(),null);
});
