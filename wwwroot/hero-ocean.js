const hero=document.getElementById('home');
const host=document.getElementById('hero-ocean');
const toggle=document.getElementById('hero-fx-toggle');
const status=document.getElementById('hero-fx-status');
const reduced=matchMedia('(prefers-reduced-motion:reduce)');
let preference;
try{preference=localStorage.getItem('hotel.hero3d')}catch{}
let enabled=preference!=='off'&&!reduced.matches&&!navigator.connection?.saveData;
let scene=null,revision=0,pending=false,visible=true,unavailable=false;
function stateLabel(){
  toggle.hidden=false;
  toggle.disabled=pending||unavailable;
  toggle.setAttribute('aria-pressed',String(enabled&&!unavailable));
  toggle.setAttribute('aria-label',(enabled?'Tắt':'Bật')+' hiệu ứng sóng biển 3D');
  toggle.querySelector('span').textContent=unavailable?'Không khả dụng':pending?'Đang tải':enabled?'Bật':'Tắt';
  if(unavailable)toggle.title='Trình duyệt chưa hỗ trợ hiệu ứng. Bạn vẫn có thể tìm và đặt phòng bình thường.';
}
function synchronize(){
  const active=enabled&&visible&&!document.hidden&&!unavailable;
  scene?.setRunning(active);
  hero.dataset.fxState=unavailable?'unavailable':pending?'loading':!enabled?'off':scene?(active?'running':'paused'):'off';
}
function release(){scene?.dispose();scene=null;host.replaceChildren();host.classList.remove('is-ready')}
function fail(){
  revision++;pending=false;unavailable=true;enabled=false;release();synchronize();stateLabel();
  status.textContent='Hiệu ứng 3D không khả dụng. Trang vẫn có thể tìm và đặt phòng bình thường.';
}
async function apply(){
  const current=++revision;
  if(!enabled){pending=false;release();stateLabel();synchronize();return}
  if(scene){stateLabel();synchronize();return}
  pending=true;stateLabel();synchronize();
  try{
    // Loading the visual enhancement never blocks hotel.js, forms, auth or room details.
    const [THREE,{createOcean}]=await Promise.all([
      import('/vendor/three-0.186.1/three.hotel.min.js'),import('/hero-ocean-scene.js')
    ]);
    if(current!==revision||!enabled)return;
    scene=createOcean(THREE,host,fail);
    if(!scene){fail();return}
    pending=false;stateLabel();synchronize();
  }catch{if(current===revision)fail()}
}
toggle.addEventListener('click',()=>{
  enabled=!enabled;
  preference=enabled?'on':'off';
  try{localStorage.setItem('hotel.hero3d',preference)}catch{}
  status.textContent=enabled?'Đã bật hiệu ứng sóng biển 3D.':'Đã tắt hiệu ứng sóng biển 3D.';
  apply();
});
reduced.addEventListener('change',()=>{enabled=!reduced.matches&&preference!=='off'&&!navigator.connection?.saveData;apply()});
document.addEventListener('visibilitychange',synchronize);
const observer=new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;synchronize()},{threshold:0.01});
observer.observe(hero);
window.addEventListener('pagehide',()=>{revision++;pending=false;release();synchronize()});
window.addEventListener('pageshow',event=>{if(event.persisted)apply()});
stateLabel();synchronize();
if(enabled){if('requestIdleCallback'in window)requestIdleCallback(()=>{if(enabled)apply()},{timeout:1200});else setTimeout(()=>{if(enabled)apply()},200)}
