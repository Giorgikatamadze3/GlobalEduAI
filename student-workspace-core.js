(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.StudentWorkspaceCore=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
    'use strict';
    const STAGES=Object.freeze(['researching','preparing','submitted','offer','closed']);
    function validDate(value){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false;const date=new Date(value+'T00:00:00Z');return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===value;}
    function accountKey(user,preview=false){const id=user?.id||user?._id;if(typeof id!=='string'||!id)return null;return `${preview?'designPreview:':''}globalEduWorkspace:v1:${encodeURIComponent(id)}`;}
    function normalize(value){
        const plans=Object.create(null),tasks=Object.create(null);
        if(value&&typeof value==='object'&&!Array.isArray(value)){
            for(const[id,entry]of Object.entries(value.plans||{}).slice(0,200))if(/^program_[a-z0-9-]+$/.test(id)&&entry&&typeof entry==='object')plans[id]={stage:STAGES.includes(entry.stage)?entry.stage:'researching',targetDate:validDate(entry.targetDate)?entry.targetDate:'',note:typeof entry.note==='string'?entry.note.slice(0,1000):''};
            for(const key of ['shortlist','requirements','funding','documents'])tasks[key]=value.tasks?.[key]===true;
        }
        return {version:1,plans,tasks};
    }
    function completion(user){const p=user?.studentProfile||{};const fields=[Boolean(user?.name),Boolean(user?.email),Boolean(user?.phone),Boolean(p.educationLevel),Boolean(p.citizenshipCode),Number.isInteger(p.graduationYear)];return {completed:fields.filter(Boolean).length,total:fields.length,percent:Math.round(fields.filter(Boolean).length/fields.length*100)};}
    function deadlines(programs,asOf){if(!validDate(asOf))throw Error('An exact comparison date is required.');return programs.filter(p=>validDate(p.deadline?.date)&&p.deadline.date>=asOf).map(p=>({id:p.id,title:p.title,date:p.deadline.date,cycle:p.deadline.cycle||null})).sort((a,b)=>a.date.localeCompare(b.date)||a.id.localeCompare(b.id));}
    return Object.freeze({STAGES,validDate,accountKey,normalize,completion,deadlines});
});
