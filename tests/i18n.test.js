'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const I18n=require('../i18n');
const Core=require('../catalog-core');

test('all three interface languages translate critical student, funding and GPA actions',()=>{
    assert.deepEqual(I18n.LANGUAGES,['ka','en','ru']);assert.ok(I18n.phraseCount>1100);
    for(const source of ['მთავარი','შესვლა','რეგისტრაცია','დაფინანსების წყაროები','GPA — 0–4 სკალა','შეიყვანე პაროლი','პროგრამის შესაბამისობა გადასამოწმებელია']){
        assert.equal(I18n.t(source,'ka'),source);
        for(const language of ['en','ru'])assert.ok(!/[ა-ჰ]/.test(I18n.t(source,language)),`${language}: ${source}`);
    }
});

test('all directory country names and published funding conditions have English and Russian translations',()=>{
    const directory=require('../Server/data/institutions.json');
    const funding=require('../Server/data/funding.json');
    const strings=new Set(directory.institutions.map(i=>i.country));
    function visit(value){if(typeof value==='string'&&/[ა-ჰ]/.test(value))strings.add(value);else if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')Object.values(value).forEach(visit);}
    visit(funding);
    const programs=require('../Server/data/programs.json').programs.filter(p=>p.verificationStatus==='official-source');
    for(const program of programs)for(const value of [program.tuition?.note,program.requirements?.note,program.deadline?.note])if(value)strings.add(value);
    for(const record of require('../Server/data/admissions-statistics.json').records)if(record.scopeDescription)strings.add(record.scopeDescription);
    for(const source of strings)for(const language of ['en','ru'])assert.ok(!/[ა-ჰ]/.test(I18n.t(source,language)),`${language}: ${source}`);
});

test('dynamic counts, statuses and whitespace translate without changing original identifiers',()=>{
    assert.equal(I18n.t('  77 პროგრამის აღწერა  ','en'),'  77 program records  ');
    assert.equal(I18n.t('დადასტურებული კავშირი · მიღება დახურულია','en'),'Confirmed association · Applications closed');
    assert.equal(I18n.t('DAAD EPOS','ru'),'DAAD EPOS');
    assert.equal(I18n.t('program_saarland-computer-science-msc','en'),'program_saarland-computer-science-msc');
    assert.equal(I18n.t('GPA: 3.75 / 4','ru'),'GPA: 3.75 / 4');
    assert.equal(I18n.t('თბილისის უნივერსიტეტი — დეტალები','en'),'თბილისის უნივერსიტეტი — details');
    assert.equal(I18n.t('მთავარი','unsupported'),'მთავარი');
});

// A small DOM contract exercises the real runtime without adding a browser
// dependency to deployment. Full layout/language checks also run in Chrome.
function browser(stored='ka',storageDisabled=false){
    const elements=[],nodes=[],events=[],listeners={},storage=new Map([[I18n.STORAGE_KEY,stored]]);
    class Element {
        constructor(tag,attrs={},parent=null){this.nodeType=1;this.tagName=tag.toUpperCase();this.attrs={...attrs};this.parentElement=parent;this.value='';elements.push(this);}
        hasAttribute(key){return Object.hasOwn(this.attrs,key);}getAttribute(key){return this.attrs[key]??null;}setAttribute(key,value){this.attrs[key]=String(value);}
        matches(selector){return selector==='meta[name="description"]'&&this.tagName==='META'&&this.attrs.name==='description';}
        closest(selector){let current=this;while(current){if(selector.split(',').some(s=>{s=s.trim();return s===current.tagName.toLowerCase()||s==='[data-i18n-ignore]'&&current.hasAttribute('data-i18n-ignore')||s.startsWith('.')&&(current.attrs.class||'').split(' ').includes(s.slice(1))||s.startsWith('#')&&current.attrs.id===s.slice(1);}))return current;current=current.parentElement;}return null;}
        querySelectorAll(){return [];}
    }
    const label=new Element('button'),text={nodeType:3,nodeValue:'მთავარი',parentElement:label};nodes.push(text);
    const input=new Element('input',{placeholder:'შეიყვანე პაროლი','aria-label':'პაროლი'});input.value='ჩემი პირადი ტექსტი';
    const proper=new Element('span',{'data-i18n-ignore':''}),properText={nodeType:3,nodeValue:'მთავარი',parentElement:proper};nodes.push(properText);
    const chat=new Element('div',{class:'agent-message-body'}),chatText={nodeType:3,nodeValue:'მთავარი',parentElement:chat};nodes.push(chatText);
    const picker=new Element('select',{'data-language-selector':''});
    const doc={nodeType:9,readyState:'complete',documentElement:{lang:''},addEventListener(name,callback){listeners[name]=callback;},querySelectorAll(selector){return selector.includes('data-language-selector')?[picker]:elements.filter(e=>['placeholder','aria-label','title','alt'].some(a=>e.hasAttribute(a)));},createTreeWalker(){let i=0;return {nextNode:()=>nodes[i++]||null};}};
    let mutation;
    const context=vm.createContext({document:doc,Intl,queueMicrotask,localStorage:{getItem:key=>{if(storageDisabled)throw Error('Storage disabled');return storage.get(key);},setItem:(key,value)=>{if(storageDisabled)throw Error('Storage disabled');storage.set(key,value);}},CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:event=>events.push(event),MutationObserver:class {constructor(callback){mutation=callback;}observe(){}}});
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../i18n.js'),'utf8'),context);
    return {api:context.I18n,doc,text,input,properText,chatText,picker,storage,events,mutate:()=>mutation([{type:'characterData',target:text}])};
}

test('language switching is reversible and preserves user input, chat and source-owned names',()=>{
    const b=browser();b.api.setLanguage('en');
    assert.equal(b.text.nodeValue,'Home');assert.match(b.input.getAttribute('placeholder'),/password/i);
    assert.equal(b.input.value,'ჩემი პირადი ტექსტი');assert.equal(b.properText.nodeValue,'მთავარი');assert.equal(b.chatText.nodeValue,'მთავარი');
    b.api.setLanguage('ru');assert.equal(b.text.nodeValue,'Главная');assert.equal(b.doc.documentElement.lang,'ru');assert.equal(b.picker.value,'ru');
    assert.equal(b.storage.get(I18n.STORAGE_KEY),'ru');assert.equal(b.events.at(-1).detail.language,'ru');
    b.api.setLanguage('ka');assert.equal(b.text.nodeValue,'მთავარი');assert.equal(b.input.getAttribute('placeholder'),'შეიყვანე პაროლი');
    assert.equal(b.api.setLanguage('invalid'),false);assert.equal(b.doc.documentElement.lang,'ka');
});

test('stored language loads safely and dynamic application text is translated after rendering',async()=>{
    const b=browser('en');assert.equal(b.text.nodeValue,'Home');
    b.text.nodeValue='შესვლა';b.mutate();await new Promise(resolve=>setImmediate(resolve));assert.equal(b.text.nodeValue,'Sign in');
    b.api.setLanguage('ru');assert.equal(b.text.nodeValue,'Войти');
    b.api.apply(b.input);assert.ok(!/[ა-ჰ]/.test(b.input.getAttribute('placeholder')));
    const privateMode=browser('en',true);assert.equal(privateMode.doc.documentElement.lang,'ka');assert.doesNotThrow(()=>privateMode.api.setLanguage('en'));assert.equal(privateMode.text.nodeValue,'Home');
});

test('country search accepts Russian labels alongside original university names',()=>{
    const institutions=[{id:'de',name:'Example University',countryCode:'DE',country:'გერმანია',countryEnglish:'Germany',domains:['example.de'],website:'https://example.de'},{id:'us',name:'Example University',countryCode:'US',country:'აშშ',countryEnglish:'United States',domains:['example.edu'],website:'https://example.edu'}];
    assert.deepEqual(Core.filterInstitutions(institutions,{query:'Германия'}).map(i=>i.id),['de']);
    assert.deepEqual(Core.filterInstitutions(institutions,{query:'Example Германия'}).map(i=>i.id),['de']);
});
