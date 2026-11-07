'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),C=require('../study-calendar-core');
test('calendar distinguishes verified dates from personal targets and never invents deadlines',()=>{
 const rows=C.events([{id:'program_x',title:'Master',deadline:{date:'2027-02-01'}},{id:'program_y',title:'Other',deadline:{date:null}},{id:'program_z',title:'Past',deadline:{date:'2020-01-01'}}],{plans:{program_y:{targetDate:'2027-01-15'}}},'2026-11-07');
 assert.deepEqual(rows.map(r=>[r.id,r.kind,r.date]),[['program_y','personal','2027-01-15'],['program_x','official','2027-02-01']]);assert.equal(C.validDate('2027-02-30'),false);
});
test('ICS is deterministic, uses exclusive all-day ends, safe folded UTF-8 and reminders',()=>{
 const event={id:'program_a',kind:'official',date:'2027-12-31',title:'ქართული '.repeat(25)+'\r\nEND:VEVENT',institution:'A, B; C',url:'javascript:alert(1)'},ics=C.calendar([event],{now:'2026-11-07T12:00:00Z'});
 assert.ok(ics.includes('DTEND;VALUE=DATE:20280101'));assert.ok(ics.includes('TRIGGER:-P7D'));assert.ok(ics.includes('TRIGGER:-P1D'));assert.equal(ics.match(/^END:VEVENT$/gm).length,1);assert.ok(!ics.includes('URL:javascript'));for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line,'utf8')<=75);
 assert.equal(ics,C.calendar([event],{now:'2026-11-07T12:00:00Z'}));
});
