(function(root,factory){const api=factory(typeof module==='object'&&module.exports?require('./catalog-core'):root.CatalogCore);if(typeof module==='object'&&module.exports)module.exports=api;else root.StudentProfileCore=api;})(typeof globalThis!=='undefined'?globalThis:this,function(Core){
    'use strict';
    const EXTRA_FIELDS=Object.freeze(['academicUniversity','academicFaculty','academicSubject','completedDegree','degreeStatus','gpa4','certificateStatus','languageCertificate','studyGoal','targetDegree','targetSubject','targetCountry','annualBudget','budgetCurrency','workspace']);
    const fail=(field,message)=>{throw Object.assign(new Error(message),{code:'INVALID_INPUT',field});};
    const record=value=>value&&typeof value==='object'&&!Array.isArray(value);
    function normalizeExtras(input){
        const out={};
        if('targetCountry'in input){if(typeof input.targetCountry!=='string'||input.targetCountry&&!Core.COUNTRIES[input.targetCountry])fail('targetCountry','აირჩიე ქვეყანა სიიდან.');out.targetCountry=input.targetCountry;}
        if('annualBudget'in input){if(input.annualBudget!==null&&(typeof input.annualBudget!=='number'||!Number.isFinite(input.annualBudget)||input.annualBudget<0||input.annualBudget>1000000))fail('annualBudget','მიუთითე სწორი წლიური ბიუჯეტი.');out.annualBudget=input.annualBudget;}
        if('budgetCurrency'in input){if(!['EUR','USD','GBP','GEL'].includes(input.budgetCurrency))fail('budgetCurrency','აირჩიე ვალუტა სიიდან.');out.budgetCurrency=input.budgetCurrency;}
        if('workspace'in input){
            const w=input.workspace,W=typeof module==='object'&&module.exports?require('./student-workspace-core'):globalThis.StudentWorkspaceCore;
            if(!record(w)||JSON.stringify(w).length>260000||!record(w.plans)||!record(w.tasks)||Object.keys(w.plans).length>200||!Number.isSafeInteger(w.revision)||w.revision<0)fail('workspace','გეგმის მონაცემები არასწორია.');
            for(const[id,p]of Object.entries(w.plans))if(!/^program_[a-z0-9-]+$/.test(id)||!record(p)||!W.STAGES.includes(p.stage)||p.targetDate!==''&&!W.validDate(p.targetDate)||typeof p.note!=='string'||p.note.length>1000)fail('workspace','გეგმის ჩანაწერი არასწორია.');
            out.workspace={...W.normalize(w),revision:w.revision};
        }
        for(const [field,max]of [['academicUniversity',250],['academicFaculty',250],['studyGoal',1500]])if(field in input){if(typeof input[field]!=='string'||input[field].length>max||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(input[field]))fail(field,'მონაცემი არასწორია ან ტექსტი ზედმეტად გრძელია.');out[field]=input[field].trim();}
        for(const[field,allowed]of [['academicSubject',Core.SUBFIELDS.map(f=>f.value)],['targetSubject',Core.SUBFIELDS.map(f=>f.value)],['completedDegree',['high-school','bachelor','master','phd','other']],['targetDegree',Core.DEGREES.map(d=>d.value)],['degreeStatus',['completed','in-progress']],['certificateStatus',['none','provided']]])if(field in input){if(typeof input[field]!=='string'||input[field]&&!allowed.includes(input[field]))fail(field,'აირჩიე მნიშვნელობა სიიდან.');out[field]=input[field];}
        if('gpa4'in input){const value=input.gpa4;if(value!==null&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>4))fail('gpa4','მიუთითე GPA 0–4 სკალაზე.');out.gpa4=value;}
        if('languageCertificate'in input){
            const test=input.languageCertificate;
            if(test===null)out.languageCertificate=null;
            else{
                if(!record(test)||Object.keys(test).some(k=>!['name','score','minComponentScore','scoreScale'].includes(k)))fail('languageCertificate','ენის სერტიფიკატის მონაცემები არასწორია.');
                const custom=typeof test.name==='string'&&test.name.trim().length>=2&&test.name.length<=100&&!['IELTS Academic','TOEFL iBT'].includes(test.name);
                const max=test.name==='IELTS Academic'?9:test.name==='TOEFL iBT'&&test.scoreScale==='0-120'?120:test.name==='TOEFL iBT'&&test.scoreScale==='1-6'?6:custom?1000:null;
                if(max===null||!(custom&&test.score===null)&&(typeof test.score!=='number'||!Number.isFinite(test.score)||test.score<0||test.score>max||(max===6&&test.score<1)))fail('languageCertificate','სერტიფიკატის ქულა ან სკალა არასწორია.');
                if((max===9||max===6)&&!Number.isInteger(test.score*2)||max===120&&!Number.isInteger(test.score))fail('languageCertificate','სერტიფიკატის ქულა ან სკალა არასწორია.');
                const component=test.minComponentScore??null;
                if(component!==null&&(typeof component!=='number'||!Number.isFinite(component)||component<0||component>max||(max===120&&component>30)||(max===6&&component<1)))fail('languageCertificate','კომპონენტის ქულა არასწორია.');
                if(!custom&&component!==null&&!Number.isInteger(component*(max===120?1:2)))fail('languageCertificate','კომპონენტის ქულა არასწორია.');
                if(!custom&&component!==null&&component*(max===120?4:1)>test.score)fail('languageCertificate','კომპონენტის ქულა არასწორია.');
                out.languageCertificate={name:test.name.trim(),score:test.score,minComponentScore:component,...(test.name==='TOEFL iBT'?{scoreScale:test.scoreScale}:{})};
            }
        }
        if(input.certificateStatus==='none')out.languageCertificate=null;
        if(input.certificateStatus==='provided'&&!out.languageCertificate)fail('languageCertificate','მიუთითე სერტიფიკატის ტიპი და შედეგი.');
        return out;
    }
    function matchingProfile(student){
        if(!record(student))return {};
        const out={};
        if(Object.hasOwn(student,'gpa4'))out.gpa4=student.gpa4;
        for(const[from,to]of [['completedDegree','priorDegree'],['academicSubject','priorSubject'],['degreeStatus','degreeStatus'],['academicUniversity','academicUniversity'],['academicFaculty','academicFaculty'],['studyGoal','studyGoal'],['citizenshipCode','citizenshipCode']])if(Object.hasOwn(student,from))out[to]=student[from]||'';
        if(['provided','none'].includes(student.certificateStatus))out.languageTests=student.certificateStatus==='provided'&&student.languageCertificate?[{...student.languageCertificate}]:[];
        if(Object.hasOwn(student,'targetDegree'))out.degrees=student.targetDegree?[student.targetDegree]:[];
        if(student.targetCountry)out.countryCodes=[student.targetCountry];
        if(typeof student.annualBudget==='number'){out.budget=student.annualBudget;out.currency=student.budgetCurrency||'EUR';out.budgetPeriod='year';}
        if(Object.hasOwn(student,'targetSubject')){out.subjectFields=student.targetSubject?[student.targetSubject]:[];out.fields=[];const field=Core.SUBFIELDS.find(f=>f.value===student.targetSubject);if(field)out.fields=[field.category];}
        return out;
    }
    return Object.freeze({EXTRA_FIELDS,normalizeExtras,matchingProfile});
});
