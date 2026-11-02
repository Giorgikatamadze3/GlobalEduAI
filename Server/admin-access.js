'use strict';
function adminAccess(user,environment=process.env){
    if(!user||user.accountStatus!=='active')return false;
    const ids=new Set((environment.ADMIN_ACCOUNT_IDS||'').split(',').map(s=>s.trim()).filter(Boolean));
    if(ids.has(user.id))return true;
    try{const bootstrap=JSON.parse(environment.ADMIN_BOOTSTRAP||'null');return !!bootstrap&&user.email===bootstrap.email&&Number.isFinite(Date.parse(user.createdAt))&&Number.isFinite(Date.parse(bootstrap.createdBefore))&&Date.parse(user.createdAt)<Date.parse(bootstrap.createdBefore);}catch{return false;}
}
module.exports={adminAccess};
