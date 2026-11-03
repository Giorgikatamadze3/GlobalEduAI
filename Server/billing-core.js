'use strict';
const FEATURES=['discovery','matching','favorites','planner','ai','pdf','consultation'];
const DEFAULT_PLANS=[
 {id:'free',name:'Free',monthlyPrice:0,yearlyPrice:0,description:'პროგრამების აღმოჩენა და პირველი ნაბიჯები',features:{discovery:true,matching:true,favorites:20,planner:true,ai:5,pdf:false,consultation:0}},
 {id:'student',name:'Student',monthlyPrice:1900,yearlyPrice:22800,description:'ყოველდღიური დახმარება სწავლის დაგეგმვაში',features:{discovery:true,matching:true,favorites:100,planner:true,ai:100,pdf:true,consultation:1}},
 {id:'premium',name:'Premium',monthlyPrice:3900,yearlyPrice:46800,description:'მეტი AI მხარდაჭერა და კონსულტაციის მოთხოვნები',features:{discovery:true,matching:true,favorites:200,planner:true,ai:300,pdf:true,consultation:3}},
 {id:'pro',name:'Pro',monthlyPrice:7900,yearlyPrice:94800,description:'ინტენსიური მომზადება და გაფართოებული მხარდაჭერა',features:{discovery:true,matching:true,favorites:200,planner:true,ai:1000,pdf:true,consultation:6}}
].map(p=>({...p,active:true,currency:'GEL'}));
const fail=(status,code,message)=>Object.assign(new Error(message),{status,code});
function validatePlan(input,id){
 if(!DEFAULT_PLANS.some(p=>p.id===id)||!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'INVALID_PLAN','პაკეტი არასწორია.');
 if(Object.keys(input).some(k=>!['id','name','monthlyPrice','yearlyPrice','description','features','active','currency','revision'].includes(k)))throw fail(400,'INVALID_PLAN','პაკეტის უცნობი ველი.');
 if(typeof input.name!=='string'||input.name.trim().length<1||input.name.length>60||typeof input.description!=='string'||input.description.length>1000||typeof input.active!=='boolean')throw fail(400,'INVALID_PLAN','შეამოწმე პაკეტის სახელი და აღწერა.');
 for(const k of ['monthlyPrice','yearlyPrice'])if(!Number.isSafeInteger(input[k])||input[k]<0||input[k]>10000000||(id==='free'&&input[k]!==0)||(id!=='free'&&input[k]===0))throw fail(400,'INVALID_PRICE','ფასი მიუთითე თეთრებში, დადებითი მთელი რიცხვით.');
 if(!input.features||Object.keys(input.features).length!==FEATURES.length||FEATURES.some(k=>!(k in input.features)))throw fail(400,'INVALID_FEATURES','პაკეტის ყველა ფუნქცია აუცილებელია.');
 for(const k of FEATURES){const v=input.features[k];if(['ai','favorites','consultation'].includes(k)?!Number.isSafeInteger(v)||v<0||v>100000:typeof v!=='boolean')throw fail(400,'INVALID_FEATURES','ფუნქციის ლიმიტი არასწორია.');}
 if(id==='free'&&(!input.active||!input.features.discovery))throw fail(400,'INVALID_PLAN','უფასო აღმოჩენა ხელმისაწვდომი უნდა დარჩეს.');
 if(['discovery','matching','planner'].some(k=>input.features[k]!==true))throw fail(400,'INVALID_FEATURES','აღმოჩენა, შესაბამისობის შეფასება და გეგმა ყველა პაკეტში შედის.');
 return {id,name:input.name.trim(),description:input.description.trim(),monthlyPrice:input.monthlyPrice,yearlyPrice:input.yearlyPrice,currency:'GEL',features:{...input.features},active:input.active};
}
function addPeriod(iso,period){
 if(!['monthly','yearly'].includes(period))throw fail(400,'INVALID_PERIOD','აირჩიე თვიური ან წლიური პერიოდი.');
 const d=new Date(iso),day=d.getUTCDate();d.setUTCDate(1);if(period==='yearly')d.setUTCFullYear(d.getUTCFullYear()+1);else d.setUTCMonth(d.getUTCMonth()+1);
 const last=new Date(Date.UTC(d.getUTCFullYear(),d.getUTCMonth()+1,0)).getUTCDate();d.setUTCDate(Math.min(day,last));return d.toISOString();
}
module.exports={DEFAULT_PLANS,FEATURES,fail,validatePlan,addPeriod};
