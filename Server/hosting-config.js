'use strict';

function publicOrigin(environment=process.env){
    const value=environment.PUBLIC_SITE_URL||environment.RENDER_EXTERNAL_URL||'https://globaleduai.vercel.app';
    const url=new URL(value);
    if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Public site URL must be an HTTPS origin.');
    return url.origin;
}

function trustedProxy(environment=process.env){
    return environment.VERCEL==='1'||environment.RENDER==='true'?1:false;
}

module.exports={publicOrigin,trustedProxy};
