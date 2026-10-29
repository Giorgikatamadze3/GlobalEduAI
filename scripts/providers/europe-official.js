'use strict';

function text(html){return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<[^>]+>/g,' ').replace(/&#(x[\da-f]+|\d+);/gi,(_,n)=>String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n))).replace(/&amp;/g,'&').replace(/&nbsp;/g,' ').replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/\u200b/g,'').replace(/\s+/g,' ').trim();}
function anchors(html){return [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({href:m[1].replace(/&amp;/g,'&'),title:text(m[2])}));}
function extractEuropeanCatalog(html,source,{checkedAt=new Date().toISOString().slice(0,10)}={}){
    if(typeof html!=='string'||html.length>10000000||!source?.institutionWebsite||!source?.countryCodes?.length)throw Error('Invalid official European catalogue context.');
    let entries=[];
    if(source.adapter==='oslo-masters'){
        for(const match of html.matchAll(/<li>\s*<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/li>/gi)){
            const title=match[2].match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1];
            if(!title||!/<span class="facet">Master<\/span>/.test(match[2]))continue;
            entries.push({href:match[1],title:text(title),durationMonths:/<span class="facet">\s*2 years\s*<\/span>/.test(match[2])?24:null});
        }
    }else if(source.adapter==='vienna-masters'){
        entries=anchors(html).filter(a=>/\/(?:admission-info\/mag\/[^/]+|master-access-guide-mag\/[^/]+)/.test(a.href)&&a.title.length>3&&!/^(?:Master Access Guide|Admission|Visiting)/i.test(a.title));
    }else if(source.adapter==='uppsala-masters'){
        entries=anchors(html).filter(a=>/^\/en\/study\/programme\/masters-programme-[^/?#]+$/.test(a.href));
    }else if(source.adapter==='copenhagen-masters'){
        for(const match of html.matchAll(/<article\b([^>]*data-study-programme[^>]*)>([\s\S]*?)<\/article>/gi)){
            const title=match[1].match(/aria-label="([^"]+)"/)?.[1],link=anchors(match[2])[0];
            if(title&&link&&/^Master of (Science|Arts|Laws|Theology)/.test(title))entries.push({href:link.href,title:text(title)});
        }
    }else throw Error('Unsupported European institutional adapter.');
    const records=[],seen=new Set(),institutionHost=new URL(source.institutionWebsite).hostname.replace(/^www\./,'');
    for(const entry of entries){
        const url=new URL(entry.href,source.url);const host=url.hostname.replace(/^www\./,'');
        if(!['https:','http:'].includes(url.protocol)||url.username||url.password||!(host===institutionHost||host.endsWith('.'+institutionHost)))continue;
        url.hash='';if(seen.has(url.href))continue;seen.add(url.href);
        records.push({sourceId:source.id,sourceRecordId:url.pathname,institutionName:source.institutionName,institutionWebsite:source.institutionWebsite,countryCode:source.countryCodes[0],title:entry.title,degree:'master',language:null,languages:[],field:null,category:null,mode:null,durationMonths:entry.durationMonths??null,programUrl:url.href,sourceUrl:source.url,listingSourceUrl:source.url,checkedAt});
    }
    if(!records.length)throw Error('The source layout yielded no verified degree listings; preserve the previous snapshot.');
    return {records,coverage:{sourceId:source.id,asOf:checkedAt,listingComplete:true,complete:false,recordsFetched:records.length,pagesFetched:1,scope:source.scope,verification:'Programme title and linked institutional page from the configured master-level list. Unknown fees, language, deadlines and admissions remain null. Listing completeness is limited to this configured page.'}};
}
async function fetchEuropeanCatalog(source,{fetchImpl=fetch,signal}={}){
    const response=await fetchImpl(source.url,{signal:signal||AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Official European source returned HTTP ${response.status}; previous catalogue preserved.`);
    const actual=new URL(response.url||source.url),host=new URL(source.institutionWebsite).hostname.replace(/^www\./,'');
    if(!(actual.hostname.replace(/^www\./,'')===host||actual.hostname.endsWith('.'+host)))throw Error('Official source redirected outside the registered university.');
    return extractEuropeanCatalog(await response.text(),source);
}
module.exports={extractEuropeanCatalog,fetchEuropeanCatalog};
