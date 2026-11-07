'use strict';
function allowedByRobots(content,url,agent='globaleduai-catalog'){
 const groups=[];let group=null,hasRules=false;
 for(const raw of content.split(/\r?\n/)){const line=raw.split('#')[0].trim(),at=line.indexOf(':');if(at<0)continue;const key=line.slice(0,at).trim().toLowerCase(),value=line.slice(at+1).trim();
  if(key==='user-agent'){if(!group||hasRules){group={agents:[],rules:[],delay:0};groups.push(group);hasRules=false;}group.agents.push(value.toLowerCase());}
  else if(group){hasRules=true;if(['allow','disallow'].includes(key)&&value)group.rules.push({allow:key==='allow',path:value});if(key==='crawl-delay'&&Number.isFinite(Number(value)))group.delay=Math.max(group.delay,Number(value));}
 }
 const specific=groups.filter(g=>g.agents.some(a=>a!=='*'&&agent.includes(a))),selected=specific.length?specific:groups.filter(g=>g.agents.includes('*'));
 const target=new URL(url),path=target.pathname+target.search;let best=null;
 for(const g of selected)for(const rule of g.rules){const pattern=rule.path.replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*').replace(/\\\$$/,'$'),size=rule.path.replace(/[*$]/g,'').length;if(new RegExp('^'+pattern).test(path)&&(!best||size>best.size||size===best.size&&rule.allow))best={...rule,size};}
 return {allowed:best?.allow!==false,delaySeconds:Math.max(0,...selected.map(g=>g.delay))};
}
async function checkSourcePolicy(source,{fetchImpl=fetch}={}){
 if(source.robots?.allowed===false)throw Error('Source policy explicitly disables collection.');
 const targets=[source.url,...(source.apiUrls||[])].filter(Boolean),byOrigin=new Map();
 for(const target of targets){const origin=new URL(target).origin;let policy=byOrigin.get(origin);if(!policy){const r=await fetchImpl(origin+'/robots.txt',{signal:AbortSignal.timeout(15000),headers:{'User-Agent':'GlobalEduAI-Catalog/1.0'}});if(r.status===404)policy={text:'',status:404};else{if(!r.ok)throw Error('Robots policy unavailable: HTTP '+r.status);if(new URL(r.url||origin+'/robots.txt').origin!==origin)throw Error('Robots policy redirected off origin.');policy={text:await r.text(),status:r.status};}byOrigin.set(origin,policy);}
  const result=allowedByRobots(policy.text,target);if(!result.allowed)throw Error('Current robots rules disallow configured source.');if(result.delaySeconds>0)throw Error('Source requires paced collection; skipped by this scheduler.');
 }
 return {checkedAt:new Date().toISOString(),origins:byOrigin.size};
}
module.exports={allowedByRobots,checkSourcePolicy};
