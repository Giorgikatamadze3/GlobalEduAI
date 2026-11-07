'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),{allowedByRobots,checkSourcePolicy}=require('../scripts/source-policy');
test('source policy handles longest paths, wildcard endings, specific agents and crawl delays',()=>{
 const robots='User-agent: *\nDisallow: /private\nAllow: /private/public\nDisallow: /*.pdf$\nCrawl-delay: 2';
 assert.equal(allowedByRobots(robots,'https://example.org/private/a').allowed,false);assert.equal(allowedByRobots(robots,'https://example.org/private/public/a').allowed,true);assert.equal(allowedByRobots(robots,'https://example.org/x.pdf').allowed,false);assert.equal(allowedByRobots(robots,'https://example.org/x.pdf/html').allowed,true);assert.equal(allowedByRobots(robots,'https://example.org').delaySeconds,2);
 assert.equal(allowedByRobots('User-agent: *\nDisallow: /\nUser-agent: GlobalEduAI-Catalog\nAllow: /','https://example.org/a').allowed,true);
});
test('unavailable or paced source policies preserve the last snapshot by refusing collection',async()=>{
 await assert.rejects(checkSourcePolicy({url:'https://example.org/degrees'},{fetchImpl:async()=>({ok:false,status:403})}),/unavailable/);
 await assert.rejects(checkSourcePolicy({url:'https://example.org/degrees'},{fetchImpl:async()=>({ok:true,status:200,text:async()=> 'User-agent: *\nCrawl-delay: 10'})}),/paced/);
 assert.equal((await checkSourcePolicy({url:'https://example.org/degrees'},{fetchImpl:async()=>({status:404})})).origins,1);
});
