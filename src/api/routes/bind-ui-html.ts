/** HTML renderer for the service token bind UI page. */
import { htmlPage, esc } from "../html/layout.js";

const EXTRA_CSS = `
header{text-align:center;margin-bottom:2rem}
header h1{font-size:18px}
label{display:block;font-size:13px;font-weight:500;color:#444;margin-bottom:.25rem}
input[type=text],input[type=password]{font-family:inherit;font-size:14px;width:100%;padding:.5rem .75rem;border:1px solid #d0d0d0;border-radius:4px;outline:none;transition:border-color .15s}
input:focus{border-color:#0070f3;box-shadow:0 0 0 2px rgba(0,112,243,.15)}
input:user-invalid{border-color:#dc3545}
.field{margin-bottom:.75rem}
.field small{display:block;color:#888;font-size:12px;margin-top:.2rem}
button{font-family:inherit;font-size:14px;font-weight:500;padding:.5rem 1rem;border-radius:4px;cursor:pointer;border:none;transition:background .15s}
.btn-primary{background:#0070f3;color:#fff;width:100%;margin-top:.25rem}
.btn-primary:hover{background:#005bd4}
.btn-primary:disabled{background:#99c4f8;cursor:not-allowed}
.btn-danger{background:none;color:#dc3545;border:1px solid #dc3545;padding:.25rem .5rem;font-size:12px}
.btn-danger:hover{background:#dc3545;color:#fff}
#status{padding:.625rem .75rem;border-radius:4px;font-size:13px;margin-bottom:1rem;display:none}
#status.error{display:block;background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
#status.ok{display:block;background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
.busy{display:none;color:#666;font-size:13px;margin-left:.5rem}
.busy.active{display:inline}
`;

/* eslint-disable no-useless-escape */
const SCRIPT = `(function(){
var S=document.getElementById('status'),F=document.getElementById('bf'),
B=document.getElementById('bb'),P=document.getElementById('sp'),
T=document.getElementById('tl');
function msg(t,c){S.textContent=t;S.className=c}
function esc(s){var d=document.createElement('div');d.textContent=s;return d.innerHTML}
async function api(m,p,b){
var o={method:m,credentials:'include',headers:{'Content-Type':'application/json'}};
if(b)o.body=JSON.stringify(b);
var r=await fetch(p,o),d=await r.json().catch(function(){return null});
return{r:r,d:d};
}
async function load(){
var x=await api('GET','/api/v1/admin/service-tokens');
if(!x.r.ok){T.innerHTML='<p class=\"empty\">Failed to load tokens.<\/p>';return}
if(!x.d||!x.d.length){T.innerHTML='<p class=\"empty\">No tokens bound.<\/p>';return}
var h='<table><tr><th>Label<\/th><th>Client ID<\/th><th>Bound<\/th><th><\/th><\/tr>';
for(var i=0;i<x.d.length;i++){
var t=x.d[i],cn=esc(t.common_name),dt=new Date(t.created_at*1000).toISOString().slice(0,10);
h+='<tr><td>'+esc(t.label||'--')+'<\/td><td><code>'+cn.slice(0,8)+'...<\/code><\/td>';
h+='<td>'+dt+'<\/td><td><button class=\"btn-danger\" data-cn=\"'+cn+'\">Revoke<\/button><\/td><\/tr>';
}
T.innerHTML=h+'<\/table>';
}
T.addEventListener('click',async function(e){
if(!e.target.dataset.cn)return;
if(!confirm('Revoke this token?'))return;
S.className='';
var x=await api('DELETE','/api/v1/admin/service-tokens/'+encodeURIComponent(e.target.dataset.cn));
if(x.r.ok){msg('Token revoked.','ok');await load()}
else msg((x.d&&x.d.error)||'Failed to revoke','error');
});
var RE_ID=/^[a-f0-9]{32}[.]access$/,RE_SEC=/^[a-f0-9]{64}$/;
F.addEventListener('submit',async function(e){
e.preventDefault();S.className='';B.disabled=true;P.classList.add('active');
var ci=document.getElementById('ci').value.trim(),
cs=document.getElementById('cs').value.trim(),
lb=document.getElementById('lb').value.trim();
if(!RE_ID.test(ci)){msg('Client ID must be 32 hex chars + .access','error');B.disabled=false;P.classList.remove('active');return}
if(!RE_SEC.test(cs)){msg('Client Secret must be 64 hex characters','error');B.disabled=false;P.classList.remove('active');return}
try{
var body={client_id:ci,client_secret:cs};
if(lb)body.label=lb;
var x=await api('POST','/api/v1/admin/service-tokens/bind',body);
if(x.r.ok||x.r.status===201){msg('Token bound successfully.','ok');F.reset();await load()}
else msg((x.d&&x.d.error)||'Bind failed','error');
}catch(err){msg('Network error: '+err.message,'error')}
finally{B.disabled=false;P.classList.remove('active')}
});
load();
})();`;
/* eslint-enable no-useless-escape */

/** Render the bind UI as a clean admin page. */
export function renderBindPage(email: string, nonce: string): Response {
  const safeEmail = esc(email);

  const body = `<header>
<h1>Service Token Management</h1>
<p>${safeEmail}</p>
</header>

<div id="status"></div>

<div class="card">
<h2>Bind a new token</h2>
<form id="bf">
<div class="field">
<label for="ci">Client ID</label>
<input type="text" id="ci" required placeholder="e.g. 561c89bb...366a0d98.access" pattern="[a-f0-9]{32}\\.access" title="32 hex characters followed by .access">
<small>The CF-Access-Client-Id from your service token</small>
</div>
<div class="field">
<label for="cs">Client Secret</label>
<input type="password" id="cs" required placeholder="64-character hex string" pattern="[a-f0-9]{64}" title="64 hex characters">
<small>The CF-Access-Client-Secret (never stored or logged)</small>
</div>
<div class="field">
<label for="lb">Label <span style="font-weight:400;color:#888">(optional)</span></label>
<input type="text" id="lb" placeholder="e.g. CI bot, staging runner" maxlength="100">
</div>
<button type="submit" class="btn-primary" id="bb">Bind token</button>
<span class="busy" id="sp">Binding...</span>
</form>
</div>

<div class="card">
<h2>Your bound tokens</h2>
<div id="tl"><p class="empty">Loading...</p></div>
</div>`;

  return htmlPage(body, {
    title: "Service Token Management",
    maxWidth: "560px",
    extraCss: EXTRA_CSS,
    script: SCRIPT,
    scriptNonce: nonce,
  });
}
