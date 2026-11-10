import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSnapshot, canWrite, walletRole, used, spent, committed } from './model.js';
const project = '0x' + '1'.repeat(40), a = '0x' + 'a'.repeat(40), b = '0x' + 'b'.repeat(40);
const fixture = () => ({schema:3,project:'Lab',currency:'USD',project_party:project,funders:[a,b],required_approvals:2,
  proposals:[{id:1,proposer:project,description:'Microscope',evidence:'LAB-104',cap:120000,approvals:[a,b],status:'ACTIVE',cost_id:1}],
  costs:[{id:1,proposal_id:1,description:'Microscope',evidence:'LAB-104',cap:120000}],
  reservations:[{id:1,cost_id:1,funder:a,amount:70000,reference:'A-001',active:false,spent:true,receipt_id:1},
    {id:2,cost_id:1,funder:b,amount:50000,reference:'B-001',active:true,spent:false,receipt_id:null}],
  receipts:[{id:1,reservation_id:1,cost_id:1,supplier:'North Lab Tools',invoice_id:'LAB-104',amount:70000,period:'2026-10-01',status:'SPENT'}]});
test('Schema 3 snapshot validates receipts and their settled reservations', () => {
  assert.equal(validateSnapshot(JSON.stringify(fixture())).schema, 3);
  for (const mutate of [s=>{s.receipts=[]}, s=>{s.receipts[0].amount=69999},
    s=>{s.receipts[0].cost_id=2}, s=>{s.receipts[0].status='PENDING'},
    s=>{s.receipts[0].supplier=''}, s=>{s.reservations[0].spent=false},
    s=>{s.reservations[0].receipt_id=2}, s=>{s.reservations[0].active=true},
    s=>{s.reservations[1].spent=true}, s=>{delete s.receipts}]) {
    const s=fixture(); mutate(s); assert.throws(()=>validateSnapshot(s));
  }
});
test('Spent money stays committed to the cap', () => {
  const s=fixture();
  assert.equal(used(s,1),50000);
  assert.equal(spent(s,1),70000);
  assert.equal(committed(s,1),120000);
  s.reservations.push({id:3,cost_id:1,funder:b,amount:1,reference:'B-002',active:true,spent:false,receipt_id:null});
  assert.throws(()=>validateSnapshot(s));
});
test('Receipts are project-party only and need an active reservation', () => {
  const s=fixture();
  assert.equal(walletRole(s,project),'Project party');
  assert.equal(canWrite(s,project,'submit_receipt',[2]),true);
  assert.equal(canWrite(s,project,'submit_receipt',[1]),false);
  assert.equal(canWrite(s,a,'submit_receipt',[2]),false);
  assert.equal(canWrite(s,b,'submit_receipt',[2]),false);
  assert.equal(canWrite(s,project,'submit_receipt',[3]),false);
  s.reservations[1].active=false;
  assert.equal(canWrite(s,project,'submit_receipt',[2]),false);
});
test('Schema 2 snapshots still validate without receipts', () => {
  const s=fixture(); delete s.receipts; s.schema=2;
  s.reservations.forEach(r=>{delete r.spent; delete r.receipt_id;});
  assert.equal(validateSnapshot(JSON.stringify(s)).schema,2);
  assert.equal(spent(s,1),0);
  assert.equal(committed(s,1),50000);
});
