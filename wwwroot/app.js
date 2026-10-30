const app = document.getElementById('app');
const modal = document.getElementById('modal');
const toast = document.getElementById('toast');
const state = {
  token: sessionStorage.getItem('hotel.token'),
  user: JSON.parse(sessionStorage.getItem('hotel.user') || 'null'),
  view: 'dashboard',
  page: 1,
  filters: {},
  reportFrom: today(),
  reportTo: today()
};
const nav = [
  ['dashboard','Tổng quan','dashboard'],['bookings','Đặt phòng','calendar'],
  ['payments','Quản lý thanh toán','revenue'],
  ['reconciliation','Đối soát chuyển khoản','revenue'],
  ['rooms','Quản lý phòng','bed'],['customers','Khách hàng','users'],
  ['users','Quản lý nhân viên','users'],
  ['requests','Yêu cầu của khách','calendar'],['housekeeping','Dọn phòng','bed'],['administration','Sao lưu & Nhật ký','settings'],['reports','Báo cáo','chart'],['settings','Cài đặt','settings']
];
const viewLabels = Object.fromEntries([...nav, ['roomtypes','Loại phòng'],
  ['services','Dịch vụ']].map(x => [x[0], x[1]]));
const iconPaths = {
  dashboard:'<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
  calendar:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 3v4M17 3v4M3 10h18"/>',
  bed:'<path d="M3 18v-7M21 18v-7M3 15h18M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3M5 11h14"/>',
  users:'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8ZM22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  chart:'<path d="M4 20v-5M9 20V9M14 20V4M19 20v-8"/>',
  settings:'<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="m16 16 5 5"/>',
  bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
  revenue:'<path d="M4 20V9m5 11V4m5 16v-8m5 8V6"/>',
  arrow:'<path d="M5 12h14m-6-6 6 6-6 6"/>'
};
function icon(name){return '<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+(iconPaths[name]||iconPaths.dashboard)+'</svg>'}
function today(){return window.hotelTime.day()}
function tomorrow(){return window.hotelTime.day(1)}
function esc(value){return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
function money(value){return new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:2}).format(Number(value)||0)}
function date(value){return window.hotelTime.format(value)}
function btn(label,action,id,kind){return '<button class="btn small '+(kind||'')+'" data-act="'+action+'"'+(id==null?'':' data-id="'+id+'"')+'>'+esc(label)+'</button>'}
function badge(text,kind){return '<span class="badge '+(kind||'')+'">'+esc(text)+'</span>'}
function statusName(status){return ({Reserved:'Đã đặt',CheckedIn:'Đang ở',CheckedOut:'Đã trả',Cancelled:'Đã hủy'})[status]||status}
function roomStatus(status){return ['Trống','Đang thuê','Bảo trì','Chờ dọn'][status]||'Không rõ'}
function note(message,bad){toast.textContent=message;toast.className='show'+(bad?' bad':'');clearTimeout(note.timer);note.timer=setTimeout(()=>toast.className='',4200)}
function logout(){resetNotifications();state.token=null;state.user=null;sessionStorage.removeItem('hotel.token');sessionStorage.removeItem('hotel.user');renderLogin()}
function validateStaffPasswordBytes(values){
  for(const name of ['password','oldPassword','newPassword']){
    if(typeof values[name]==='string' && new TextEncoder().encode(values[name]).length>72)
      throw new Error('Mật khẩu tối đa 72 byte UTF-8. Ký tự có dấu hoặc emoji có thể chiếm nhiều byte.');
  }
}
async function api(path,options){
  options=options||{};
  if(options.body && ['/api/Auth/login','/api/Auth/register','/api/Auth/change-password','/api/Users'].includes(path))
    validateStaffPasswordBytes(options.body);
  const headers={Accept:'application/json'};
  if(options.body!==undefined)headers['Content-Type']='application/json';
  if(state.token && options.auth!==false)headers.Authorization='Bearer '+state.token;
  let response;
  try{response=await fetch(path,{method:options.method||'GET',headers,body:options.body===undefined?undefined:JSON.stringify(options.body)})}
  catch{throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra kết nối và thử lại.')}
  let data=null;
  const contentType=response.headers.get('content-type')||'';
  if(contentType.includes('json')){try{data=await response.json()}catch{}}
  if(response.status===401 && options.auth!==false){logout();throw new Error('Phiên đăng nhập đã hết hạn.')}
  if(data?.code==='PASSWORD_CHANGE_REQUIRED' && state.user){
    state.user.mustChangePassword=true;
    sessionStorage.setItem('hotel.user',JSON.stringify(state.user));
    renderRequiredPasswordChange();
  }
  if(!response.ok){
    throw new Error(hotelApiError(response,data));
  }
  return data;
}
function renderLogin(){
  app.innerHTML='<div class="login"><div class="hero"><div class="brand"><span class="brand-mark">A</span><span>An Nhiên<small>HOTEL &amp; RESORT</small></span></div><div class="hero-copy"><div class="eyebrow">QUẢN LÝ KHÁCH SẠN</div><h1>Chào mừng về<br><em>An Nhiên.</em></h1><p>Quản lý đặt phòng, khách hàng và dịch vụ trong một không gian làm việc tinh tế.</p></div><a class="hero-link" href="/hotel.html">Xem website khách sạn '+icon('arrow')+'</a></div><div class="login-side"><form class="login-card" id="login-form"><div class="eyebrow">AN NHIÊN HOTEL &amp; RESORT</div><h2>Chào mừng trở lại</h2><p class="muted">Đăng nhập bằng tài khoản nhân viên để tiếp tục.</p><div class="field"><label for="username">Tên đăng nhập</label><input id="username" name="username" autocomplete="username" required autofocus></div><div class="field"><label for="password">Mật khẩu</label><input id="password" name="password" type="password" autocomplete="current-password" required><p class="help">Tối đa 72 byte UTF-8; ký tự có dấu có thể chiếm nhiều byte.</p></div><div id="login-error"></div><button class="btn primary full" type="submit">Đăng nhập '+icon('arrow')+'</button></form></div></div>';
  document.getElementById('login-form').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,submit=form.querySelector('button');
    submit.disabled=true;document.getElementById('login-error').textContent='';
    try{
      const result=await api('/api/Auth/login',{method:'POST',body:{username:form.elements.namedItem('username').value,password:form.elements.namedItem('password').value},auth:false});
      state.token=result.token;state.user=result.user;state.view='dashboard';
      sessionStorage.setItem('hotel.token',state.token);
      sessionStorage.setItem('hotel.user',JSON.stringify(state.user));
      render();
    }catch(error){document.getElementById('login-error').innerHTML='<div class="error">'+esc(error.message)+'</div>'}
    finally{submit.disabled=false}
  };
}
function renderRequiredPasswordChange(){
  resetNotifications();
  if(modal.open)modal.close();
  app.innerHTML='<main class="login-side" style="min-height:100vh"><form class="login-card" id="required-password-form"><h2>Đổi mật khẩu lần đầu</h2><p>Bạn cần đổi mật khẩu khởi tạo trước khi sử dụng chức năng quản trị.</p>'+
    '<div class="field"><label for="initial-password">Mật khẩu hiện tại</label><input id="initial-password" name="oldPassword" type="password" autocomplete="current-password" required></div>'+
    '<div class="field"><label for="initial-new-password">Mật khẩu mới</label><input id="initial-new-password" name="newPassword" type="password" autocomplete="new-password" minlength="12" required><p class="help">Tối thiểu 12 ký tự, tối đa 72 byte UTF-8 và khác mật khẩu khởi tạo.</p></div>'+
    '<div class="field"><label for="initial-confirm-password">Nhập lại mật khẩu mới</label><input id="initial-confirm-password" name="confirmPassword" type="password" autocomplete="new-password" required></div>'+
    '<div id="required-password-error" role="alert"></div><button type="submit" class="btn primary full">Đổi mật khẩu</button><button type="button" class="btn full" id="required-password-logout">Đăng xuất</button></form></main>';
  document.getElementById('required-password-logout').onclick=logout;
  document.getElementById('required-password-form').onsubmit=async event=>{
    event.preventDefault();
    const form=event.currentTarget,button=form.querySelector('[type="submit"]');
    const values=Object.fromEntries(new FormData(form).entries());
    const error=document.getElementById('required-password-error');error.textContent='';
    if(values.newPassword!==values.confirmPassword){error.textContent='Mật khẩu nhập lại chưa khớp.';return}
    button.disabled=true;
    try{
      const result=await api('/api/Auth/change-password',{method:'POST',body:{oldPassword:values.oldPassword,newPassword:values.newPassword}});
      logout();note(result.message);
    }catch(problem){error.textContent=problem.message}
    finally{button.disabled=false}
  };
}
function staffAccountMenu(initials){
  const role=state.user.role==='Admin'?'Quản trị viên':'Lễ tân';
  return '<div class="staff-account"><button type="button" class="staff-card" id="staff-account-button" data-account-toggle aria-haspopup="menu" aria-expanded="false" aria-controls="staff-account-menu">'+
    '<span class="staff-avatar">'+esc(initials)+'</span><span class="staff-copy"><strong>'+esc(state.user.fullName)+'</strong><small>'+role+'</small></span>'+
    '<svg class="staff-chevron" viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m6 12 4-4 4 4"/></svg></button>'+
    '<div class="staff-menu" id="staff-account-menu" role="menu" aria-label="Tài khoản nhân viên" hidden>'+
    '<div class="staff-menu-title" role="presentation">Tài khoản của bạn</div>'+
    '<button type="button" class="staff-menu-item" role="menuitem" tabindex="-1" data-act="account">'+icon('users')+'<span>Thông tin tài khoản</span></button>'+
    '<button type="button" class="staff-menu-item" role="menuitem" tabindex="-1" data-act="password">'+icon('settings')+'<span>Đổi mật khẩu</span></button>'+
    '<button type="button" class="staff-menu-item staff-menu-logout" role="menuitem" tabindex="-1" data-act="logout"><svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M9 5H5v14h4m5-14 7 7-7 7m-5-7h12"/></svg><span>Đăng xuất</span></button></div></div>';
}
function setStaffMenu(open,focus){
  const menu=document.getElementById('staff-account-menu');
  const button=document.getElementById('staff-account-button');
  if(!menu||!button)return;
  menu.hidden=!open;
  button.setAttribute('aria-expanded',String(open));
  if(open){const items=menu.querySelectorAll('[role="menuitem"]');items[focus==='last'?items.length-1:0]?.focus()}
  else if(focus==='trigger')button.focus();
}
function shell(){
  const settingsActive=['settings','roomtypes','services'].includes(state.view);
  const links=nav.filter(x=>state.user.role==='Admin'||!['reports','administration','users'].includes(x[0]))
    .map(x=>'<button class="nav-item '+((state.view===x[0]||(x[0]==='settings'&&settingsActive))?'active':'')+'" data-view="'+x[0]+'">'+icon(x[2])+'<span>'+x[1]+'</span></button>').join('');
  const initials=state.user.fullName.split(/\s+/).slice(-2).map(x=>x[0]||'').join('').toUpperCase();
  const rawDate=new Intl.DateTimeFormat('vi-VN',{timeZone:window.hotelTime.zone,weekday:'long',day:'numeric',month:'long'}).format(new Date());
  const dateLabel=rawDate[0].toUpperCase()+rawDate.slice(1).toLocaleLowerCase('vi-VN');
  app.innerHTML='<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">A</span><span>An Nhiên<small>HOTEL &amp; RESORT</small></span></div><nav>'+links+'</nav><div class="sidebar-bottom"><div class="site-card"><strong>Website khách sạn</strong><p>Xem trải nghiệm đặt phòng của khách.</p><a href="/hotel.html">Xem website <span>›</span></a></div>'+staffAccountMenu(initials)+'</div></aside><div class="workspace"><header class="topbar"><div class="topbar-title"><small>'+esc(dateLabel)+'</small><strong>'+esc(viewLabels[state.view]||'Tổng quan')+'</strong></div><div class="topbar-tools"><label class="global-search">'+icon('search')+'<input id="global-search" placeholder="Tìm phòng, khách hàng..." aria-label="Tìm kiếm"></label>'+notificationsMarkup()+'</div></header><main class="main" id="main"><div class="empty">Đang tải dữ liệu...</div></main></div></div>';
  renderNotifications();refreshNotifications();
}
function head(title,description,action,label){
  return '<div class="page-head"><div><div class="eyebrow">AN NHIÊN HOTEL &amp; RESORT</div><h1>'+esc(title)+'</h1><p>'+esc(description)+'</p></div>'+(action?'<button class="btn primary" data-act="'+action+'">+ '+esc(label)+'</button>':'')+'</div>';
}
function table(headers,rows){
  return '<div class="panel table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+(rows.length?rows.join(''):'<tr><td colspan="'+headers.length+'" class="empty">Chưa có dữ liệu phù hợp.</td></tr>')+'</tbody></table></div>';
}
function pager(data){
  if(!data.totalPages)return '';
  state.totalPages=data.totalPages;
  return '<div class="pager"><span>Trang '+data.pageNumber+' / '+data.totalPages+' · '+data.totalCount+' mục</span><div>'+btn('← Trước','page-prev',null)+(btn('Sau →','page-next',null))+'</div></div>';
}
function query(params){return new URLSearchParams(Object.entries(params).filter(x=>x[1]!==''&&x[1]!=null)).toString()}
async function render(){
  if(!state.token||!state.user){renderLogin();return}
  if(state.user.mustChangePassword){renderRequiredPasswordChange();return}
  if(state.user.role!=='Admin'&&['reports','users','administration'].includes(state.view))state.view='dashboard';
  shell();
  try{
    if(state.view==='dashboard')await dashboard();
    else if(state.view==='rooms')await rooms();
    else if(state.view==='roomtypes')await roomtypes();
    else if(state.view==='customers')await customers();
    else if(state.view==='bookings')await bookings();
    else if(state.view==='payments')await paymentsView();
    else if(state.view==='reconciliation')await reconciliationView();
    else if(state.view==='services')await services();
    else if(state.view==='reports')await reports();
    else if(state.view==='users')await users();
    else if(state.view==='settings')await settings();
    else if(state.view==='requests')await bookingRequestsView();
    else if(state.view==='housekeeping')await housekeepingView();
    else if(state.view==='administration')await administrationView();
  }catch(error){const main=document.getElementById('main');if(main)main.innerHTML='<div class="error">'+esc(error.message)+'</div>'}
}
async function dashboard(){
  const isAdmin=state.user.role==='Admin';
  const [roomsData,bookingsData,checkedIn,checkedOut]=await Promise.all([
    api('/api/Rooms?PageSize=1'),api('/api/Bookings?PageSize=5'),
    api('/api/Bookings?Status=CheckedIn&PageSize=1'),
    api('/api/Bookings?Status=CheckedOut&PageSize=1')
  ]);
  const [roomReport,revenue,customers,statusCounts]=await Promise.all([
    isAdmin?api('/api/Reports/rooms'):Promise.resolve(null),
    isAdmin?api('/api/Reports/revenue?from='+today().slice(0,7)+'-01&to='+today()):Promise.resolve(null),
    isAdmin?Promise.resolve(null):api('/api/Customers'),
    isAdmin?Promise.resolve(null):Promise.all([0,1,2,3].map(status=>api('/api/Rooms?PageSize=1&Status='+status)))
  ]);
  const roomStats=roomReport||{
    totalRooms:roomsData.totalCount,
    available:statusCounts[0].totalCount,
    occupied:statusCounts[1].totalCount,
    maintenance:statusCounts[2].totalCount,cleaning:statusCounts[3].totalCount
  };
  const occupied=roomStats.totalRooms?roomStats.occupied*100/roomStats.totalRooms:0;
  const occupancy=Math.round(occupied);
  const maintenance=roomStats.totalRooms?roomStats.maintenance*100/roomStats.totalRooms:0;
  const cleaning=roomStats.totalRooms?roomStats.cleaning*100/roomStats.totalRooms:0;
  const metrics=[
    [isAdmin?'Tổng doanh thu':'Khách hàng',isAdmin?money(revenue.totalRevenue):customers.length,
      isAdmin?'Tháng này':'Đã lưu','revenue'],
    ['Phòng đang thuê',roomStats.occupied+' / '+roomStats.totalRooms,occupancy+'% công suất','bed'],
    ['Khách nhận phòng',checkedIn.totalCount,'Đang lưu trú','users'],
    ['Khách trả phòng',checkedOut.totalCount,'Đã hoàn tất','calendar']
  ];
  const firstName=state.user.fullName;
  const hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:window.hotelTime.zone,hour:'2-digit',hourCycle:'h23'}).format(new Date()));
  const greeting=hour<11?'Chào buổi sáng':hour<18?'Chào buổi chiều':'Chào buổi tối';
  const recent=bookingsData.items.map(x=>{
    const initials=(x.customerName||'?').trim().split(/\s+/).slice(-2).map(part=>part[0]||'').join('').toUpperCase();
    return '<tr><td><div class="guest-name"><span class="table-avatar">'+esc(initials)+'</span><span>'+esc(x.customerName)+'</span></div></td><td>'+esc(x.roomNumber)+'</td><td>'+date(x.checkInDate)+'<br>'+date(x.checkOutDate)+'</td><td>'+money(x.totalAmount)+'</td><td>'+badge(statusName(x.status),x.status==='CheckedIn'?'good':x.status==='Cancelled'?'bad':x.status==='Reserved'?'warn':'')+'</td></tr>';
  }).join('');
  if(state.view!=='dashboard'||!state.user)return;
  document.getElementById('main').innerHTML=
    '<div class="page-head dashboard-head"><div><p>'+esc(greeting)+', '+esc(firstName)+'</p><h1>Khách sạn hôm nay thế nào?</h1></div><button class="btn primary" data-act="booking-add">+ Tạo đặt phòng</button></div>'+
    '<div class="cards">'+metrics.map((x,i)=>'<article class="card"><div class="card-top"><span class="metric-icon '+(i===0?'gold':'')+'">'+icon(x[3])+'</span><small>'+esc(x[2])+'</small></div><span class="card-label">'+esc(x[0])+'</span><strong>'+x[1]+'</strong></article>').join('')+'</div>'+
    '<div class="dashboard-grid"><section class="panel recent-panel"><div class="panel-heading"><div><h2>Đặt phòng gần đây</h2><p>Cập nhật theo thời gian thực</p></div><button class="text-link" data-view="bookings">Xem tất cả</button></div><div class="table-wrap"><table class="dashboard-table"><thead><tr><th>Khách hàng</th><th>Phòng</th><th>Thời gian</th><th>Tổng tiền</th><th>Trạng thái</th></tr></thead><tbody>'+(recent||'<tr><td colspan="5" class="empty">Chưa có đặt phòng.</td></tr>')+'</tbody></table></div></section>'+
    '<section class="panel occupancy-panel"><div class="panel-heading"><div><h2>Tình trạng phòng</h2><p>Tổng '+roomStats.totalRooms+' phòng</p></div><button class="text-link" data-view="rooms">Chi tiết</button></div><div class="donut" role="img" aria-label="'+esc('Tình trạng '+roomStats.totalRooms+' phòng: '+roomStats.occupied+' đang thuê, '+roomStats.maintenance+' bảo trì, '+roomStats.cleaning+' chờ dọn, '+roomStats.available+' trống.')+'" style="--occupied:'+occupied+'%;--maintenance:'+maintenance+'%;--cleaning:'+cleaning+'%"><div><strong>'+occupancy+'%</strong><small>Công suất</small></div></div><div class="room-legend"><div><span><i class="dot occupied"></i>Đang sử dụng</span><strong>'+roomStats.occupied+' phòng</strong></div><div><span><i class="dot maintenance"></i>Bảo trì</span><strong>'+roomStats.maintenance+' phòng</strong></div><div><span><i class="dot cleaning"></i>Chờ dọn</span><strong>'+roomStats.cleaning+' phòng</strong></div><div><span><i class="dot available"></i>Phòng trống</span><strong>'+roomStats.available+' phòng</strong></div></div></section></div>';
}
async function settings(){
  const links=[['roomtypes','Loại phòng','Quản lý danh mục và mô tả loại phòng.'],
    ['services','Dịch vụ','Giá dịch vụ và dịch vụ khách đã sử dụng.'],
    ...(state.user.role==='Admin'?[['users','Quản lý nhân viên','Thêm, sửa, phân quyền và khóa/mở khóa tài khoản nhân viên.'],
      ['bank-config-view','Cấu hình QR & Ngân hàng','Cài đặt số tài khoản và mã QR chuyển khoản cho khách.']]:[])];
  document.getElementById('main').innerHTML=head('Cài đặt','Quản lý danh mục và tài khoản trong hệ thống.')+
    '<div class="settings-grid">'+links.map(x=>'<button class="settings-tile" data-view="'+x[0]+'"><strong>'+x[1]+'</strong><span>'+x[2]+'</span><b>→</b></button>').join('')+'</div>'+
    '<div class="panel panel-pad account-panel"><h2 class="section-title">Tài khoản của tôi</h2><div class="list-row"><span>Họ tên</span><strong>'+esc(state.user.fullName)+'</strong></div><div class="list-row"><span>Tên đăng nhập</span><strong>'+esc(state.user.username)+'</strong></div><div class="list-row"><span>Vai trò</span><strong>'+esc(state.user.role)+'</strong></div><div class="account-actions">'+btn('Đổi mật khẩu','password')+btn('Đăng xuất','logout',null,'danger')+'</div></div>';
}
async function rooms(){
  const f=state.filters.rooms||{},data=await api('/api/Rooms?'+query({PageNumber:state.page,PageSize:10,Keyword:f.keyword,Status:f.status,SortBy:f.sort}));
  const rows=data.items.map(x=>'<tr><td><strong>'+esc(x.roomNumber)+'</strong></td><td>'+esc(x.roomTypeName)+' · tối đa '+x.capacity+' khách</td><td>'+money(x.price)+'</td><td>'+badge(roomStatus(x.status),x.status===0?'good':x.status===1?'warn':'bad')+'</td><td class="actions">'+(state.user.role==='Admin'?btn('Sửa','room-edit',x.id)+btn('Ảnh & tiện nghi','room-presentation',x.id)+btn('Trạng thái','room-status',x.id)+btn('Xóa','room-delete',x.id,'danger'):'')+'</td></tr>');
  document.getElementById('main').innerHTML=head('Phòng','Quản lý số phòng, giá và trạng thái.',state.user.role==='Admin'?'room-add':null,'Thêm phòng')+
    (state.user.role==='Admin'&&data.totalCount===0&&!f.keyword&&!String(f.status??'').trim()?'<div class="card"><strong>Khách sạn chưa có phòng?</strong><p>Tạo 3 hạng phòng và 6 phòng mẫu để trải nghiệm website. Giá, tiện nghi và ảnh đều là minh họa; hãy chỉnh lại trước khi nhận khách thật.</p>'+btn('Tạo dữ liệu mẫu','demo-rooms',null,'primary')+'</div>':'')+
    '<form class="toolbar" id="filter-form"><input name="keyword" placeholder="Tìm số phòng" value="'+esc(f.keyword||'')+'"><select name="status"><option value="">Tất cả trạng thái</option>'+[[0,'Trống'],[1,'Đang thuê'],[2,'Bảo trì'],[3,'Chờ dọn']].map(x=>'<option value="'+x[0]+'" '+(String(f.status)===String(x[0])?'selected':'')+'>'+x[1]+'</option>').join('')+'</select><select name="sort"><option value="">Mặc định</option><option value="price_asc" '+(f.sort==='price_asc'?'selected':'')+'>Giá tăng</option><option value="price_desc" '+(f.sort==='price_desc'?'selected':'')+'>Giá giảm</option><option value="roomnumber" '+(f.sort==='roomnumber'?'selected':'')+'>Số phòng</option></select><button class="btn" type="submit">Lọc</button></form>'+
    table(['Số phòng','Loại phòng','Giá/đêm','Trạng thái','Thao tác'],rows)+pager(data);
}
async function roomtypes(){
  const f=state.filters.roomtypes||{},data=await api('/api/RoomTypes?'+query({PageNumber:state.page,PageSize:10,Keyword:f.keyword,SortBy:f.sort}));
  const rows=data.items.map(x=>'<tr><td><strong>'+esc(x.name)+'</strong></td><td>'+esc(x.description||'—')+'</td><td>'+x.roomCount+'</td><td class="actions">'+(state.user.role==='Admin'?btn('Sửa','type-edit',x.id)+btn('Xóa','type-delete',x.id,'danger'):'')+'</td></tr>');
  document.getElementById('main').innerHTML=head('Loại phòng','Nhóm và phân loại các phòng.',state.user.role==='Admin'?'type-add':null,'Thêm loại phòng')+
    '<form class="toolbar" id="filter-form"><input name="keyword" placeholder="Tìm loại phòng" value="'+esc(f.keyword||'')+'"><select name="sort"><option value="">Tên A-Z</option><option value="name_desc" '+(f.sort==='name_desc'?'selected':'')+'>Tên Z-A</option><option value="room_count_desc" '+(f.sort==='room_count_desc'?'selected':'')+'>Nhiều phòng nhất</option></select><button class="btn" type="submit">Lọc</button></form>'+
    table(['Loại phòng','Mô tả','Số phòng','Thao tác'],rows)+pager(data);
}
async function customers(){
  const f=state.filters.customers||{},data=await api('/api/Customers?'+query({PageNumber:state.page,PageSize:10,Keyword:f.keyword,SortBy:f.sort}));
  const rows=data.items.map(x=>'<tr><td><strong>'+esc(x.fullName)+'</strong></td><td>'+esc(x.phone||'—')+'</td><td>'+esc(x.identityCard||'—')+'</td><td>'+esc(x.email||'—')+'</td><td class="actions">'+btn('Sửa','customer-edit',x.id)+(state.user.role==='Admin'?btn('Xóa','customer-delete',x.id,'danger'):'')+'</td></tr>');
  document.getElementById('main').innerHTML=head('Khách hàng','Thông tin liên hệ và hồ sơ lưu trú.','customer-add','Thêm khách hàng')+
    '<form class="toolbar" id="filter-form"><input name="keyword" placeholder="Tên, số điện thoại hoặc CCCD" value="'+esc(f.keyword||'')+'"><select name="sort"><option value="">Mặc định (ID tăng)</option><option value="name_asc" '+(f.sort==='name_asc'?'selected':'')+'>Tên A-Z</option><option value="name_desc" '+(f.sort==='name_desc'?'selected':'')+'>Tên Z-A</option><option value="id_desc" '+(f.sort==='id_desc'?'selected':'')+'>Mới nhất trước</option></select><button class="btn" type="submit">Tìm kiếm</button></form>'+
    table(['Họ tên','Điện thoại','CCCD','Email','Thao tác'],rows)+pager(data);
}
async function bookings(){
  const f=state.filters.bookings||{},data=await api('/api/Bookings?'+query({PageNumber:state.page,PageSize:10,Status:f.status,Attention:f.attention,CustomerKeyword:f.customerKeyword,RoomNumber:f.roomNumber,FromDate:f.fromDate,ToDate:f.toDate}));
  const rows=data.items.map(x=>'<tr><td><strong>#'+x.id+'</strong></td><td>'+esc(x.customerName)+'</td><td>'+esc(x.roomNumber)+'</td><td>'+date(x.checkInDate)+' → '+date(x.checkOutDate)+'</td><td>'+badge(statusName(x.status),x.status==='CheckedIn'?'good':x.status==='Cancelled'?'bad':'')+'</td><td>'+money(x.totalAmount)+'</td><td class="actions">'+btn('Chi tiết','booking-detail',x.id)+(x.status==='Reserved'?btn('Check-in','booking-in',x.id)+btn('Hủy','booking-cancel',x.id,'danger'):x.status==='CheckedIn'?btn('Dịch vụ','usage-add',x.id)+btn('Check-out','booking-out',x.id,'primary'):'')+'</td></tr>');
  document.getElementById('main').innerHTML=head('Đặt phòng','Chọn phòng, nhận và trả phòng.','booking-add','Tạo booking')+
    '<form class="toolbar booking-filters" id="filter-form" aria-label="Tìm kiếm booking">'+
    '<label>Khách hàng<input name="customerKeyword" maxlength="200" placeholder="Tên, số điện thoại, email hoặc CCCD" value="'+esc(f.customerKeyword||'')+'"></label>'+
    '<label>Số phòng<input name="roomNumber" maxlength="10" placeholder="Ví dụ: 101" value="'+esc(f.roomNumber||'')+'"></label>'+
    '<label>Công việc<select name="attention"><option value="">Tất cả công việc</option>'+[['arrivals','Nhận phòng hôm nay'],['departures','Trả phòng hôm nay'],['overdue','Quá ngày trả phòng']].map(x=>'<option value="'+x[0]+'" '+(f.attention===x[0]?'selected':'')+'>'+x[1]+'</option>').join('')+'</select></label>'+
    '<label>Lưu trú từ ngày<input type="date" name="fromDate" max="9999-12-30" value="'+esc(f.fromDate||'')+'"></label>'+
    '<label>Đến hết ngày<input type="date" name="toDate" max="9999-12-30" value="'+esc(f.toDate||'')+'"></label>'+
    '<label>Trạng thái<select name="status"><option value="">Tất cả trạng thái</option>'+['Reserved','CheckedIn','CheckedOut','Cancelled'].map(x=>'<option value="'+x+'" '+(f.status===x?'selected':'')+'>'+statusName(x)+'</option>').join('')+'</select></label>'+
    '<div class="booking-filter-actions"><button class="btn primary" type="submit">Tìm booking</button><button class="btn" type="button" data-act="booking-clear-filters">Xóa bộ lọc</button></div>'+
    '<p class="booking-filter-help">Tìm booking có ít nhất một đêm lưu trú trong khoảng đã chọn. Có thể chỉ nhập một mốc ngày.</p><div class="error" id="booking-filter-error" role="alert" hidden></div></form>'+
    table(['Mã','Khách','Phòng','Ngày ở','Trạng thái','Tổng tiền','Thao tác'],rows)+pager(data);
}
async function services(){
  const rows=await api('/api/Services');
  document.getElementById('main').innerHTML=head('Dịch vụ','Đơn giá và dịch vụ khách đã sử dụng.',state.user.role==='Admin'?'service-add':null,'Thêm dịch vụ')+
    table(['Dịch vụ','Đơn vị','Đơn giá','Trạng thái','Thao tác'],rows.map(x=>'<tr><td><strong>'+esc(x.name)+'</strong><div class="muted">'+esc(x.description||'')+'</div></td><td>'+esc(x.unit)+'</td><td>'+money(x.price)+'</td><td>'+badge(x.isActive?'Hoạt động':'Tạm dừng',x.isActive?'good':'bad')+'</td><td class="actions">'+(state.user.role==='Admin'?btn('Sửa','service-edit',x.id)+(x.isActive?btn('Vô hiệu','service-delete',x.id,'danger'):btn('Kích hoạt','service-activate',x.id,'primary')):'')+'</td></tr>'));
}
async function reports(){
  const params='?from='+encodeURIComponent(state.reportFrom)+'&to='+encodeURIComponent(state.reportTo);
  const [revenue,rooms,popular]=await Promise.all([api('/api/Reports/revenue'+params),api('/api/Reports/rooms'),api('/api/Reports/popular-services'+params)]);
  document.getElementById('main').innerHTML=head('Báo cáo','Doanh thu chỉ ghi nhận khi booking đã check-out.')+
    '<form class="toolbar" id="report-form"><input type="date" name="from" value="'+state.reportFrom+'"><input type="date" name="to" value="'+state.reportTo+'"><button class="btn" type="submit">Xem báo cáo</button></form>'+
    '<div class="cards reports-metrics"><div class="card"><span>Doanh thu</span><strong>'+money(revenue.totalRevenue)+'</strong></div><div class="card"><span>Tiền phòng</span><strong>'+money(revenue.roomRevenue)+'</strong></div><div class="card"><span>Dịch vụ</span><strong>'+money(revenue.serviceRevenue)+'</strong></div><div class="card"><span>Booking đã trả</span><strong>'+revenue.bookings+'</strong></div></div>'+
    '<div class="split reports-layout"><div><h2 class="section-title">Doanh thu theo ngày</h2>'+table(['Ngày','Tiền phòng','Dịch vụ','Tổng'],revenue.daily.map(x=>'<tr><td>'+date(x.date)+'</td><td>'+money(x.roomRevenue)+'</td><td>'+money(x.serviceRevenue)+'</td><td><strong>'+money(x.total)+'</strong></td></tr>'))+'</div><div><h2 class="section-title">Tình trạng phòng</h2><div class="panel panel-pad"><div class="list-row"><span>Trống</span><strong>'+rooms.available+'</strong></div><div class="list-row"><span>Đang thuê</span><strong>'+rooms.occupied+'</strong></div><div class="list-row"><span>Bảo trì</span><strong>'+rooms.maintenance+'</strong></div><div class="list-row"><span>Chờ dọn</span><strong>'+rooms.cleaning+'</strong></div><div class="list-row"><span>Tỷ lệ lấp đầy</span><strong>'+rooms.occupancyRate+'%</strong></div></div><h2 class="section-title" style="margin-top:22px">Dịch vụ phổ biến</h2><div class="panel panel-pad">'+(popular.map(x=>'<div class="list-row"><span>'+esc(x.name)+' · '+x.quantity+'</span><strong>'+money(x.revenue)+'</strong></div>').join('')||'<span class="muted">Chưa có dữ liệu.</span>')+'</div></div></div>';
}
async function users(){
  const rows=await api('/api/Users');
  if(state.view!=='users'||state.user?.role!=='Admin')return;
  document.getElementById('main').innerHTML=head('Quản lý nhân viên','Thêm, sửa, phân quyền và khóa/mở khóa tài khoản. Chỉ quản trị viên được truy cập.','user-add','Thêm nhân viên')+
    table(['Tài khoản','Họ tên','Email','Vai trò','Trạng thái','Thao tác'],rows.map(x=>'<tr><td><strong>'+esc(x.username)+'</strong>'+(x.id===state.user.id?'<div class="muted">Tài khoản của bạn</div>':'')+'</td><td>'+esc(x.fullName)+'</td><td>'+esc(x.email||'—')+'</td><td>'+badge(x.role==='Admin'?'Quản trị viên':'Lễ tân')+'</td><td>'+badge(x.isActive?'Hoạt động':'Đã khóa',x.isActive?'good':'bad')+'</td><td class="actions">'+btn('Sửa','user-edit',x.id)+(x.isActive&&x.id!==state.user.id?btn('Khóa','user-delete',x.id,'danger'):!x.isActive?btn('Mở khóa','user-activate',x.id,'primary'):'')+'</td></tr>'));
}

function modalForm(title,fields,initial,onSubmit,onOpen){
  initial=initial||{};
  const controls=fields.map(field=>{
    const value=initial[field.name] == null ? (field.value == null ? '' : field.value) : initial[field.name];
    const common=' name="'+field.name+'" id="f-'+field.name+'" '+(field.required?'required ':'')+(field.readOnly?'readonly ':'');
    let control;
    if(field.options){
      control='<select'+common+'>'+field.options.map(option=>
        '<option value="'+esc(option[0])+'" '+(String(value)===String(option[0])?'selected':'')+'>'+esc(option[1])+'</option>').join('')+'</select>';
    }else if(field.type==='textarea'){
      control='<textarea'+common+'>'+esc(value)+'</textarea>';
    }else{
      control='<input'+common+' type="'+(field.type||'text')+'" value="'+esc(value)+'"'+
        (field.type==='number'?' min="'+(field.min??0)+'" step="'+(field.step??0.01)+'"'+(field.max==null?'':' max="'+field.max+'"'):'')+'>';
    }
    return '<div class="field"><label for="f-'+field.name+'">'+esc(field.label)+'</label>'+control+
      (field.help?'<div class="help">'+esc(field.help)+'</div>':'')+'</div>';
  }).join('');
  modal.innerHTML='<form id="modal-form"><div class="modal-head"><h2>'+esc(title)+'</h2></div><div class="modal-body">'+controls+'<div id="modal-error"></div></div><div class="modal-foot"><button class="btn" type="button" id="modal-cancel">Đóng</button><button class="btn primary" type="submit">Lưu</button></div></form>';
  modal.showModal();
  document.getElementById('modal-cancel').onclick=()=>modal.close();
  const form=document.getElementById('modal-form');
  if(onOpen)onOpen(form);
  form.onsubmit=async event=>{
    event.preventDefault();
    const button=form.querySelector('button[type=submit]');
    button.disabled=true;
    const values=Object.fromEntries(new FormData(form).entries());
    fields.forEach(field=>{
      if(field.type==='number')values[field.name]=Number(values[field.name]);
      if(field.type==='boolean')values[field.name]=values[field.name]==='true';
    });
    try{const result=await onSubmit(values);modal.close();note(result?.message||'Đã lưu thành công.');await render()}
    catch(error){document.getElementById('modal-error').innerHTML='<div class="error">'+esc(error.message)+'</div>'}
    finally{button.disabled=false}
  };
}
function typeFields(){return [{name:'name',label:'Tên loại phòng',required:true},{name:'description',label:'Mô tả',type:'textarea'}]}
function customerFields(){return [
  {name:'fullName',label:'Họ tên',required:true},
  {name:'identityCard',label:'CCCD/Hộ chiếu'},
  {name:'phone',label:'Số điện thoại'},
  {name:'email',label:'Email',type:'email',help:'Nếu khách có tài khoản, email được đồng bộ và dùng để khôi phục mật khẩu; không thể bỏ trống.'},
  {name:'address',label:'Địa chỉ',type:'textarea'}
]}
function serviceFields(){return [
  {name:'name',label:'Tên dịch vụ',required:true},
  {name:'unit',label:'Đơn vị tính',required:true},
  {name:'price',label:'Đơn giá',type:'number',step:0.01,required:true,help:'Giá không âm, tối đa 2 chữ số thập phân.'},
  {name:'description',label:'Mô tả',type:'textarea'}
]}
async function roomFields(edit){
  const types=await api('/api/RoomTypes?PageSize=100');
  const fields=[
    {name:'roomNumber',label:'Số phòng',required:true},
    {name:'roomTypeId',label:'Loại phòng',options:types.items.map(x=>[x.id,x.name]),required:true},
    {name:'price',label:'Giá mỗi đêm',type:'number',step:0.01,required:true,help:'Giá không âm, tối đa 2 chữ số thập phân.'},
    {name:'capacity',label:'Sức chứa tối đa (khách)',type:'number',value:2,min:1,max:100,step:1,required:true},
    {name:'description',label:'Mô tả',type:'textarea'}
  ];
  if(edit)fields.push({name:'status',label:'Trạng thái',options:[[0,'Trống'],[1,'Đang thuê'],[2,'Bảo trì'],[3,'Chờ dọn']],required:true});
  return fields;
}
async function showBookingForm(){
  const customers=await api('/api/Customers');
  if(!customers.length){note('Hãy thêm khách hàng trước khi đặt phòng.',true);return}
  const fields=[
    {name:'customerId',label:'Khách hàng',options:customers.map(x=>[x.id,x.fullName]),required:true},
    {name:'checkInDate',label:'Ngày nhận phòng',type:'date',value:today(),min:today(),required:true},
    {name:'checkOutDate',label:'Ngày trả phòng',type:'date',value:tomorrow(),min:tomorrow(),required:true},
    {name:'guestCount',label:'Số khách',type:'number',value:1,min:1,max:100,step:1,required:true},
    {name:'roomId',label:'Phòng khả dụng',options:[],required:true,help:'Danh sách cập nhật khi bạn thay đổi ngày.'},
    {name:'note',label:'Ghi chú',type:'textarea'}
  ];
  modalForm('Tạo booking',fields,{},async values=>{
    if(values.checkInDate<today())throw new Error('Ngày nhận phòng không thể ở trong quá khứ.');
    if(!values.checkOutDate||values.checkOutDate<=values.checkInDate)throw new Error('Ngày trả phòng phải sau ngày nhận phòng.');
    if(!values.roomId)throw new Error('Hãy chọn một phòng khả dụng.');
    await api('/api/Bookings',{method:'POST',body:{
      customerId:Number(values.customerId),roomId:Number(values.roomId),
      guestCount:values.guestCount,checkInDate:values.checkInDate,checkOutDate:values.checkOutDate,note:values.note
    }});
  },form=>{
    const refresh=async()=>{
      const start=form.elements.namedItem('checkInDate').value;
      const end=form.elements.namedItem('checkOutDate').value;
      const select=form.elements.namedItem('roomId');
      form.elements.namedItem('checkInDate').min=today();
      form.elements.namedItem('checkOutDate').min=tomorrow();
      if(start&&start<today()){select.innerHTML='<option value="">Ngày nhận phòng không thể ở trong quá khứ</option>';return}
      if(!start||!end||end<=start){select.innerHTML='<option value="">Ngày không hợp lệ</option>';return}
      try{
        const rooms=await api('/api/Bookings/available-rooms?CheckInDate='+encodeURIComponent(start)+'&CheckOutDate='+encodeURIComponent(end)+'&GuestCount='+encodeURIComponent(form.elements.namedItem('guestCount').value));
        select.innerHTML=rooms.length?rooms.map(x=>'<option value="'+x.id+'">'+esc(x.roomNumber)+' · '+esc(x.roomTypeName)+' · '+money(x.price)+'</option>').join(''):'<option value="">Không còn phòng khả dụng</option>';
      }catch(error){select.innerHTML='<option value="">Không tải được phòng</option>';note(error.message,true)}
    };
    form.elements.namedItem('checkInDate').onchange=refresh;
    form.elements.namedItem('checkOutDate').onchange=refresh;
    form.elements.namedItem('guestCount').onchange=refresh;
    refresh();
  });
}
async function showBookingDetails(id){
  const [booking,usage]=await Promise.all([api('/api/Bookings/'+id),api('/api/Services/usage/booking/'+id)]);
  modal.innerHTML='<div class="modal-head"><h2>Booking #'+id+'</h2></div><div class="modal-body">'+
    '<div class="list-row"><span>Khách hàng</span><strong>'+esc(booking.customerName)+'</strong></div>'+
    '<div class="list-row"><span>Phòng</span><strong>'+esc(booking.roomNumber)+'</strong></div>'+
    '<div class="list-row"><span>Số khách</span><strong>'+esc(booking.guestCount ?? 'Chưa ghi nhận')+'</strong></div>'+
    '<div class="list-row"><span>Trạng thái</span>'+badge(statusName(booking.status))+'</div>'+
    '<div class="list-row"><span>Lưu trú</span><strong>'+date(booking.checkInDate)+' → '+date(booking.checkOutDate)+'</strong></div>'+
    '<div class="list-row"><span>Tiền phòng ('+booking.nights+' đêm)</span><strong>'+money(booking.roomTotal)+'</strong></div>'+
    '<div class="list-row"><span>Dịch vụ</span><strong>'+money(booking.serviceTotal)+'</strong></div>'+
    '<div class="list-row"><span>Tổng tiền</span><strong>'+money(booking.totalAmount)+'</strong></div>'+
    '<h3>Dịch vụ đã dùng</h3>'+(usage.map(x=>'<div class="list-row"><span>'+esc(x.serviceName)+' × '+x.quantity+'</span><strong>'+money(x.total)+'</strong>'+(booking.status==='CheckedIn'?btn('Xóa','usage-delete',x.id,'danger'):'')+'</div>').join('')||'<p class="muted">Chưa sử dụng dịch vụ.</p>')+
    '</div><div class="modal-foot"><button class="btn" id="modal-cancel">Đóng</button></div>';
  modal.showModal();
  document.getElementById('modal-cancel').onclick=()=>modal.close();
}
async function action(name,id){
  if(name==='logout'){logout();return}
  if(name==='booking-clear-filters'){state.filters.bookings={};state.page=1;await render();return}
  if(name==='account'){
    const user=await api('/api/Auth/me');
    modal.innerHTML='<div class="modal-head"><h2>Thông tin tài khoản</h2></div><div class="modal-body">'+
      [['Họ tên',user.fullName],['Tên đăng nhập',user.username],['Email',user.email||'Chưa cập nhật'],['Vai trò',user.role==='Admin'?'Quản trị viên':'Lễ tân']].map(([label,value])=>'<div class="list-row"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>').join('')+
      '</div><div class="modal-foot"><button type="button" class="btn" id="modal-cancel">Đóng</button></div>';
    modal.showModal();document.getElementById('modal-cancel').onclick=()=>modal.close();return;
  }
  if(name==='notifications'){toggleNotifications();return}
  if(name==='page-prev'){state.page=Math.max(1,state.page-1);render();return}
  if(name==='page-next'){state.page=Math.min(state.totalPages||state.page,state.page+1);render();return}
  if(name==='password'){modalForm('Đổi mật khẩu',[
    {name:'oldPassword',label:'Mật khẩu hiện tại',type:'password',required:true,help:'Tối đa 72 byte UTF-8.'},
    {name:'newPassword',label:'Mật khẩu mới',type:'password',required:true,help:'Tối thiểu 6 ký tự, tối đa 72 byte UTF-8. Ký tự có dấu có thể chiếm nhiều byte.'}
  ],{},async v=>{const result=await api('/api/Auth/change-password',{method:'POST',body:v});logout();return result});return}
  if(name==='type-add'||name==='type-edit'){
    const item=id?await api('/api/RoomTypes/'+id):{};
    modalForm(id?'Sửa loại phòng':'Thêm loại phòng',typeFields(),item,
      v=>api('/api/RoomTypes'+(id?'/'+id:''),{method:id?'PUT':'POST',body:v}));return}
  if(name==='room-add'||name==='room-edit'){
    const item=id?await api('/api/Rooms/'+id):{};
    const fields=await roomFields(!!id);
    if(!fields[1].options.length){note('Hãy tạo loại phòng trước.',true);return}
    modalForm(id?'Sửa phòng':'Thêm phòng',fields,item,v=>api('/api/Rooms'+(id?'/'+id:''),{
      method:id?'PUT':'POST',body:{roomNumber:v.roomNumber,roomTypeId:Number(v.roomTypeId),
        capacity:v.capacity,price:v.price,description:v.description,...(id?{status:Number(v.status)}:{})}
    }));return}
  if(name==='room-status'){
    const item=await api('/api/Rooms/'+id);
    modalForm('Trạng thái phòng '+item.roomNumber,
      [{name:'status',label:'Trạng thái',options:[[0,'Trống'],[1,'Đang thuê'],[2,'Bảo trì'],[3,'Chờ dọn']],required:true}],
      item,v=>api('/api/Rooms/'+id+'/trang-thai',{method:'PATCH',body:Number(v.status)}));return}
  if(name==='customer-add'||name==='customer-edit'){
    const item=id?await api('/api/Customers/'+id):{};
    modalForm(id?'Sửa khách hàng':'Thêm khách hàng',customerFields(),item,
      v=>api('/api/Customers'+(id?'/'+id:''),{method:id?'PUT':'POST',body:v}));return}
  if(name==='booking-add'){await showBookingForm();return}
  if(name==='booking-detail'){await showBookingDetails(id);return}
  if(name==='service-add'||name==='service-edit'){
    const item=id?await api('/api/Services/'+id):{};
    modalForm(id?'Sửa dịch vụ':'Thêm dịch vụ',serviceFields(),item,
      v=>api('/api/Services'+(id?'/'+id:''),{method:id?'PUT':'POST',body:v}));return}
  if(name==='service-activate'){
    if(!confirm('Kích hoạt lại dịch vụ này?'))return;
    await api('/api/Services/'+id+'/activate',{method:'POST'});
    note('Đã kích hoạt dịch vụ.');await render();return
  }
  if(name==='usage-add'){
    const services=(await api('/api/Services')).filter(x=>x.isActive);
    if(!services.length){note('Chưa có dịch vụ hoạt động.',true);return}
    const requestId=crypto.randomUUID();
    modalForm('Thêm dịch vụ cho booking #'+id,[
      {name:'serviceId',label:'Dịch vụ',options:services.map(x=>[x.id,x.name+' · '+money(x.price)]),required:true},
      {name:'quantity',label:'Số lượng',type:'number',value:1,min:1,max:100,step:1,required:true}
    ],{},v=>api('/api/Services/usage',{method:'POST',body:{
      requestId,bookingId:id,serviceId:Number(v.serviceId),quantity:v.quantity
    }}));return}
  if(name==='user-add'||name==='user-edit'){
    const item=id?await api('/api/Users/'+id):{};
    const fields=[
      ...(!id?[
        {name:'username',label:'Tên đăng nhập',required:true},
        {name:'password',label:'Mật khẩu',type:'password',required:true,help:'Tối thiểu 6 ký tự, tối đa 72 byte UTF-8. Ký tự có dấu có thể chiếm nhiều byte.'}
      ]:[]),
      {name:'fullName',label:'Họ tên',required:true},
      {name:'email',label:'Email',type:'email'},
      {name:'role',label:'Vai trò',options:[['Receptionist','Lễ tân'],['Admin','Quản trị viên']],required:true},
      ...(id?[{name:'isActive',label:'Hoạt động',type:'boolean',options:[['true','Có'],['false','Không']]}]:[])
    ];
    modalForm(id?'Sửa nhân viên':'Thêm nhân viên',fields,item,
      v=>api('/api/Users'+(id?'/'+id:''),{method:id?'PUT':'POST',body:v}));return}
  if(name==='user-activate'){
    if(state.user?.role!=='Admin')throw new Error('Chỉ quản trị viên được quản lý nhân viên.');
    const item=await api('/api/Users/'+id);
    if(item.isActive){note('Tài khoản đã hoạt động.');await render();return;}
    if(!confirm('Mở khóa tài khoản '+item.username+'? Nhân viên cần đăng nhập lại; phiên cũ không được khôi phục.'))return;
    await api('/api/Users/'+id,{method:'PUT',body:{fullName:item.fullName,email:item.email,role:item.role,isActive:true}});
    note('Đã mở khóa. Nhân viên có thể đăng nhập lại.');await render();return;
  }
  const deletions={
    'type-delete':['/api/RoomTypes/','Xóa loại phòng này?'],
    'room-delete':['/api/Rooms/','Xóa phòng này?'],
    'customer-delete':['/api/Customers/','Xóa khách hàng này?'],
    'service-delete':['/api/Services/','Vô hiệu hóa dịch vụ này?'],
    'user-delete':['/api/Users/','Khóa tài khoản nhân viên này? Các phiên đăng nhập hiện tại sẽ mất hiệu lực.'],
    'usage-delete':['/api/Services/usage/','Xóa dịch vụ đã sử dụng?']
  };
  if(deletions[name]){
    if(!confirm(deletions[name][1]))return;
    await api(deletions[name][0]+id,{method:'DELETE'});
    modal.close();note('Đã cập nhật.');await render();return}
  const transitions={'booking-in':['check-in','Nhận phòng cho booking này?'],
    'booking-out':['check-out','Trả phòng và tính tiền cho booking này?'],
    'booking-cancel':['cancel','Hủy booking này?']};
  if(transitions[name]){
    if(!confirm(transitions[name][1]))return;
    const result=await api('/api/Bookings/'+id+'/'+transitions[name][0],{method:'POST'});
    note('Booking #'+result.id+' · '+statusName(result.status)+' · '+money(result.totalAmount));
    await render();
  }
}
document.addEventListener('click',async event=>{
  const accountToggle=event.target.closest('[data-account-toggle]');
  if(accountToggle){setStaffMenu(accountToggle.getAttribute('aria-expanded')!=='true');return}
  if(!event.target.closest('.staff-account'))setStaffMenu(false);
  const view=event.target.closest('[data-view]');
  if(view){if(view.dataset.view==='bank-config-view'){try{await action('bank-config');}catch(e){note(e.message,true)}return;}
    state.view=view.dataset.view;state.page=1;render();return}
  const trigger=event.target.closest('[data-act]');
  if(trigger){if(trigger.closest('#staff-account-menu'))setStaffMenu(false,'trigger');try{await action(trigger.dataset.act,Number(trigger.dataset.id)||null)}catch(error){note(error.message,true)}}
});

document.addEventListener('focusin',event=>{
  if(!event.target.closest('.staff-account'))setStaffMenu(false);
});
document.addEventListener('keydown',event=>{
  const button=document.getElementById('staff-account-button');
  const menu=document.getElementById('staff-account-menu');
  if(!button||!menu)return;
  if(event.target===button&&['ArrowDown','ArrowUp'].includes(event.key)){
    event.preventDefault();setStaffMenu(true,event.key==='ArrowUp'?'last':'first');return;
  }
  if(menu.hidden)return;
  if(event.key==='Escape'){event.preventDefault();setStaffMenu(false,'trigger');return}
  if(event.key==='Tab'){setStaffMenu(false,'trigger');return}
  if(!event.target.closest('#staff-account-menu'))return;
  const items=Array.from(menu.querySelectorAll('[role="menuitem"]'));
  const index=items.indexOf(document.activeElement);
  const next=event.key==='ArrowDown'?(index+1)%items.length:event.key==='ArrowUp'?(index-1+items.length)%items.length:event.key==='Home'?0:event.key==='End'?items.length-1:null;
  if(next!==null){event.preventDefault();items[next].focus()}
});
document.addEventListener('submit',event=>{
  if(event.target.id==='filter-form'){
    event.preventDefault();
    const filters=Object.fromEntries(new FormData(event.target).entries());
    if(state.view==='bookings'&&filters.fromDate&&filters.toDate&&filters.fromDate>filters.toDate){
      const error=document.getElementById('booking-filter-error');error.hidden=false;error.textContent='Ngày kết thúc phải từ ngày bắt đầu trở đi.';return;
    }
    state.filters[state.view]=filters;state.page=1;render();
  }
  if(event.target.id==='report-form'){
    event.preventDefault();
    const values=Object.fromEntries(new FormData(event.target).entries());
    if(values.to<values.from){note('Ngày kết thúc phải sau ngày bắt đầu.',true);return}
    state.reportFrom=values.from;state.reportTo=values.to;render();
  }
});
document.addEventListener('keydown',async event=>{
  if(event.target.id!=='global-search'||event.key!=='Enter')return;
  event.preventDefault();
  const term=event.target.value.trim();
  if(!term)return;
  try{
    const [roomsFound,customersFound]=await Promise.all([
      api('/api/Rooms?PageSize=1&Keyword='+encodeURIComponent(term)),
      api('/api/Customers?keyword='+encodeURIComponent(term))
    ]);
    if(roomsFound.totalCount){state.filters.rooms={keyword:term};state.view='rooms'}
    else if(customersFound.length){state.filters.customers={keyword:term};state.view='customers'}
    else {note('Không tìm thấy phòng hoặc khách hàng phù hợp.',true);return}
    state.page=1;render();
  }catch(error){note(error.message,true)}
});
async function initializeStaffSession(){
  await window.hotelTimeReady;
  state.reportFrom=today();state.reportTo=today();
  if(state.token){
    try{state.user=await api('/api/Auth/me');sessionStorage.setItem('hotel.user',JSON.stringify(state.user))}
    catch(error){if(state.token){logout();note(error.message,true)}return}
  }
  render();
}
initializeStaffSession();
