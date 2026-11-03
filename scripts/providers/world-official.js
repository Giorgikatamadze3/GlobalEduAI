'use strict';
const {load}=require('cheerio');
const tidy=s=>String(s||'').normalize('NFKC').replace(/\u200b/g,'').replace(/\s+/g,' ').trim();
const MASTER=/\b(?:Master(?:[’']s)?|MScR?|MS|MA|MBA|MFA|MEd|EdM|MEng|MENG|MArch|MAccy?|MCS|MMus|MM|MPH|MPP|MPA|MSW|MSN|MPhil|MRes|MLitt|MSt|MTh|MLIS|MUP|LLM|Mag[ií]ster|Maestr[ií]a)\b/i;
const hasMaster=value=>MASTER.test(value.replaceAll('.',''));
const EXCLUDED=/\b(?:certificate|diploma|minor|micro.?credential|masterclass|mastering|bachelor|concentration|speciali[sz]ation)\b|BA-to|BS-to|BA\/MA|BS\/MS/i;
function extractWorldCatalog(html,source,{checkedAt=new Date().toISOString().slice(0,10),pageUrl=source.url}={}){
    if(typeof html!=='string'||html.length>15000000)throw Error('Invalid source HTML');
    const $=load(html),entries=[];
    const push=(href,title,extra={})=>entries.push({href,title:tidy(title),...extra});
    if(source.format==='hku-json'){
        const payload=JSON.parse(html);if(!Array.isArray(payload.responses))throw Error('Missing HKU response collection');
        for(const response of payload.responses){if(!Array.isArray(response.data)||response.total!==response.data.length)throw Error('Incomplete HKU result set');for(const item of response.data){const a=item.Attributes,name=a?.hkutgp_name,root=a?.['rootprogramme.hkutgp_name']?.Value;if(typeof name!=='string'||!/^Master of\b/.test(name)||typeof root!=='string')continue;push('/tpg-admissions/programme-details?programme='+encodeURIComponent(root)+'&mode=0',name,{sourceRecordId:item.Id});}}
    }else if(source.format==='bologna-cards'){
        $('.item').each((i,a)=>{const row=$(a),link=row.find('a[href*="/second-cycle-degree/programme/"]').first(),title=row.find('.title h3').first().text();if(!link.length||!title)return;const line=row.find('.text-wrapper p').filter((j,p)=>tidy($(p).find('span').text())==='Language:').first().clone();line.find('span').remove();const language={English:'en',Italian:'it',French:'fr'}[tidy(line.text())]||null;push(link.attr('href'),title,{language,languages:language?[language]:[]});});
    }else if(source.format==='bu-degrees'){
        $('li.ma').each((i,li)=>{const row=$(li),clone=row.clone();clone.find('a,strong').remove();const subject=tidy(clone.text()).replace(/\s*\([^)]*\)\s*$/,'').trim();row.find('a[href]').each((j,a)=>{const degree=tidy($(a).text());if(hasMaster(degree)&&!EXCLUDED.test(degree))push($(a).attr('href'),subject+' ('+degree+')'+(row.find('strong').first().text()?' — '+tidy(row.find('strong').first().text()):''));});});
    }else if(source.format==='gwu-masters'){
        $('li.item').each((i,item)=>{const row=$(item),tags=row.find('.keyword').map((j,a)=>tidy($(a).text())).get();if(tags.includes("Master's")&&!tags.includes('Undergraduate'))push(row.find('a[href]').first().attr('href'),row.find('.title').first().text());});
    }else if(source.format==='auckland-masters'){
        $('a.listing-item__link').each((i,a)=>{const row=$(a);if(row.find('[data-programme-type]').attr('data-programme-type')==='Masters degree')push(row.attr('href'),row.find('[data-programme-name]').attr('data-programme-name'));});
    }else if(source.format==='twente-masters'){
        $('a[href]').each((i,a)=>{const row=$(a),href=row.attr('href');if(/\/en\/education\/master\/programmes\/[^/]+\/$/.test(href)&&MASTER.test(row.find('.degree').text())){const lang=tidy(row.find('.languages').text()),mode=tidy(row.find('.time').text()),duration=tidy(row.find('.duration').text()).match(/^(\d+) years?$/);push(href,row.find('.studyfinder__programme__title__text').text()+' (MSc)',{language:lang==='100% English-taught'?'en':lang==='100% Dutch-taught'?'nl':null,mode:mode==='Full-time'?'full-time':null,durationMonths:duration?Number(duration[1])*12:null});}});
    }else if(source.format==='uct-masters-codes'){
        const heading=$('h2,h3').filter((i,a)=>tidy($(a).text())==="Master's Degrees").first(),table=heading.nextAll('table').first();let qualification='';
        table.find('tbody tr').each((i,tr)=>{const cells=$(tr).children('td').map((j,a)=>tidy($(a).text())).get();if(cells.length===3)qualification=cells.shift();if(cells.length!==2||!/^Master of\b/.test(qualification)||!/^HM[A-Z0-9]+$/.test(cells[1]))return;push(pageUrl,qualification+' — '+cells[0],{sourceRecordId:cells[1],requirements:{note:'Published qualification/specialisation code '+cells[1]+'. Official faculty master-level listing; detailed entry requirements and active intake must be verified separately.'}});});
    }else if(source.format==='masters-links'){
        $(source.selector||'a[href]').each((i,a)=>{const row=$(a),href=row.attr('href');if(!href)return;let u;try{u=new URL(href,pageUrl);}catch{return;}if(!(new RegExp(source.pathPattern)).test(href)&&!(new RegExp(source.pathPattern)).test(u.pathname))return;let title=source.titleSelector?row.find(source.titleSelector).first().text():row.text();title=tidy(title);if(!source.masterContext&&!hasMaster(title))return;if(source.removeLeadingMaster)title=title.replace(/^Master\s+/,'');if(EXCLUDED.test(title))return;push(href,(source.titlePrefix||'')+title);});
    }else throw Error('Unsupported world catalogue format');
    const records=[],seen=new Set(),owner=new URL(source.url).hostname.replace(/^www\./,'');
    for(const e of entries){if(e.title.length<4||e.title.length>450||EXCLUDED.test(e.title))continue;let u;try{u=new URL(e.href,pageUrl);}catch{continue;}const h=u.hostname.replace(/^www\./,'');if(!['https:','http:'].includes(u.protocol)||u.username||u.password||!(h===owner||h.endsWith('.'+owner)))continue;u.hash='';const key=e.sourceRecordId||u.href;if(seen.has(key))continue;seen.add(key);records.push({sourceId:source.id,sourceRecordId:e.sourceRecordId||u.pathname,title:e.title,institutionName:source.institutionName,institutionWebsite:source.institutionWebsite,countryCode:source.countryCodes[0],degree:'master',language:null,languages:[],field:null,category:null,mode:null,durationMonths:null,programUrl:u.href,sourceUrl:pageUrl,listingSourceUrl:pageUrl,checkedAt,requirements:{note:'Master-level title and official link verified in the university catalogue. Detailed entry requirements, current intake, fees and funding are not inferred from this listing.'},...Object.fromEntries(Object.entries(e).filter(([k])=>!['href','title'].includes(k)))});}
    if(records.length<(source.minRecords||1))throw Error(`Source layout yielded ${records.length} master records; expected at least ${source.minRecords||1}.`);
    return {records,next:$('a[rel="next"]').first().attr('href')||$('a[href]').filter((i,a)=>/Go to next page/i.test($(a).text()+' '+($(a).attr('title')||'')+' '+($(a).attr('aria-label')||''))).first().attr('href')||null};
}
module.exports={extractWorldCatalog,MASTER,tidy};
