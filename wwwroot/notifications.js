const staffNotifications={token:null,data:null,error:'',loading:false,controller:null,revision:0};
function resetNotifications(){
  staffNotifications.controller?.abort();
  Object.assign(staffNotifications,{token:null,data:null,error:'',loading:false,controller:null,revision:staffNotifications.revision+1});
}
function notificationsMarkup(){
  if(staffNotifications.token!==state.token){resetNotifications();staffNotifications.token=state.token}
  return '<div class="notifications"><button type="button" class="bell-button" id="notification-toggle" data-act="notifications" aria-label="Thông báo" aria-expanded="false" aria-controls="notification-panel">'+icon('bell')+'<span class="notification-count" hidden></span></button>'+
    '<section class="notification-panel" id="notification-panel" tabindex="-1" aria-label="Thông báo công việc" hidden><div class="notification-heading"><div><h2>Thông báo</h2><p>Công việc cần xử lý</p></div><button type="button" data-notification-refresh>Làm mới</button></div><div id="notification-content" aria-live="polite"></div><p class="notification-updated" id="notification-updated"></p></section></div>';
}
function renderNotifications(){
  const button=document.getElementById('notification-toggle');
  const content=document.getElementById('notification-content');
  if(!button||!content)return;
  const data=staffNotifications.data;
  const count=button.querySelector('.notification-count');
  count.hidden=!data||data.totalCount===0;
  count.textContent=data?.totalCount>99?'99+':String(data?.totalCount||0);
  button.setAttribute('aria-label',data?'Thông báo: '+data.totalCount+' công việc cần xử lý':'Thông báo');
  const items=data?.items||[];
  content.innerHTML=(staffNotifications.error?'<div class="notification-error" role="alert">'+esc(staffNotifications.error)+'<button type="button" data-notification-refresh>Thử lại</button></div>':'')+
    (data?(items.length?items.map(item=>'<button type="button" class="notification-item '+(item.kind==='overdue'?'urgent':'')+'" data-notification-kind="'+esc(item.kind)+'"><span class="notification-symbol">'+icon(item.kind==='housekeeping'?'bed':'calendar')+'</span><span class="notification-copy"><strong>'+esc(item.title)+'</strong><small>'+esc(item.description)+'</small></span><b>'+item.count+'</b></button>').join(''):'<div class="notification-empty">Không có công việc cần xử lý lúc này.</div>'):
      (staffNotifications.loading?'<div class="notification-empty">Đang tải thông báo...</div>':''));
  content.setAttribute('aria-busy',String(staffNotifications.loading));
  const refresh=document.querySelector('.notification-heading [data-notification-refresh]');
  refresh.disabled=staffNotifications.loading;
  refresh.textContent=staffNotifications.loading?'Đang tải...':'Làm mới';
  document.getElementById('notification-updated').textContent=data?'Cập nhật '+new Date(data.generatedAt).toLocaleTimeString('vi-VN')+' · Tự làm mới mỗi 30 giây':'';
}
async function refreshNotifications(){
  if(!state.token||!state.user||document.hidden)return;
  if(staffNotifications.token!==state.token){resetNotifications();staffNotifications.token=state.token}
  if(staffNotifications.loading){renderNotifications();return}
  const token=state.token;
  const revision=++staffNotifications.revision;
  const controller=new AbortController();staffNotifications.controller=controller;
  const timer=setTimeout(()=>controller.abort(),15000);
  staffNotifications.loading=true;staffNotifications.error='';renderNotifications();
  try{
    const response=await fetch('/api/Notifications',{headers:{Accept:'application/json',Authorization:'Bearer '+token},signal:controller.signal,cache:'no-store'});
    const data=await response.json().catch(()=>null);
    if(state.token!==token||staffNotifications.revision!==revision)return;
    if(response.status===401){logout();return}
    if(!response.ok)throw new Error(hotelApiError(response,data));
    if(!data||!Array.isArray(data.items)||!Number.isInteger(data.totalCount))throw new Error('Không tải được thông báo. Vui lòng thử lại.');
    staffNotifications.data=data;
  }catch(error){
    if(state.token===token&&staffNotifications.revision===revision)
      staffNotifications.error=error.name==='AbortError'?'Tải thông báo quá thời gian chờ. Vui lòng thử lại.':error.message==='Failed to fetch'?'Không kết nối được máy chủ. Vui lòng thử lại.':error.message;
  }finally{
    clearTimeout(timer);
    if(state.token===token&&staffNotifications.revision===revision){staffNotifications.loading=false;staffNotifications.controller=null;renderNotifications()}
  }
}
function closeNotifications(restoreFocus=false){
  const panel=document.getElementById('notification-panel');if(!panel)return;
  panel.hidden=true;
  const button=document.getElementById('notification-toggle');button.setAttribute('aria-expanded','false');
  if(restoreFocus)button.focus();
}
function toggleNotifications(){
  const panel=document.getElementById('notification-panel');if(!panel)return;
  if(!panel.hidden){closeNotifications();return}
  setStaffMenu(false);
  panel.hidden=false;document.getElementById('notification-toggle').setAttribute('aria-expanded','true');
  renderNotifications();refreshNotifications();
  panel.focus();
}
document.addEventListener('click',async event=>{
  if(!event.target.closest('.notifications'))closeNotifications();
  if(event.target.closest('[data-notification-refresh]')){refreshNotifications();return}
  const item=event.target.closest('[data-notification-kind]');if(!item)return;
  const kind=item.dataset.notificationKind;closeNotifications();
  if(kind==='requests'){state.view='requests';state.filters.requests={status:'Pending'}}
  else if(kind==='housekeeping')state.view='housekeeping';
  else if(['arrivals','departures','overdue'].includes(kind)){state.view='bookings';state.filters.bookings={attention:kind}}
  else return;
  state.page=1;await render();
});
document.addEventListener('keydown',event=>{
  const panel=document.getElementById('notification-panel');
  if(event.key==='Escape'&&panel&&!panel.hidden){event.preventDefault();closeNotifications(true)}
});
document.addEventListener('focusin',event=>{if(!event.target.closest('.notifications'))closeNotifications()});
document.addEventListener('visibilitychange',()=>{if(!document.hidden)refreshNotifications()});
setInterval(()=>refreshNotifications(),30000);
