const auditEntities={Booking:'Booking',BookingDetail:'Tiền phòng',Room:'Phòng',RoomType:'Loại phòng',Customer:'Khách hàng',User:'Nhân viên',CustomerAccount:'Tài khoản khách',BookingRequest:'Yêu cầu khách',BookingPayment:'Giao dịch',BookingInvoice:'Hóa đơn',RoomCharge:'Chặng lưu trú',DatabaseBackup:'Bản sao lưu',HotelService:'Dịch vụ',ServiceUsage:'Dịch vụ đã dùng'};
const auditWords={Status:'Trạng thái',RoomId:'Phòng',CheckInDate:'Ngày nhận',CheckOutDate:'Ngày trả',Price:'Đơn giá',Capacity:'Sức chứa',IsActive:'Hoạt động',Amount:'Số tiền',Type:'Loại',Available:'Trống',Occupied:'Đang thuê',Maintenance:'Bảo trì',Cleaning:'Chờ dọn',Reserved:'Đã đặt',CheckedIn:'Đang ở',CheckedOut:'Đã trả',Cancelled:'Đã hủy',Pending:'Chờ duyệt',Approved:'Đã duyệt',Rejected:'Từ chối',Deposit:'Cọc',Payment:'Thu tiền',Refund:'Hoàn tiền',Cancel:'Hủy',Change:'Đổi'};
function auditSummary(text){return String(text).replace(/\b[A-Za-z]+\b/g,word=>auditWords[word]||word)}
const operationLabels={Cancel:'Hủy booking',Change:'Đổi booking',Pending:'Chờ duyệt',Approved:'Đã duyệt',Rejected:'Từ chối',Deposit:'Đặt cọc',Payment:'Thanh toán',Direct:'Tại quầy',Refund:'Hoàn tiền',Cash:'Tiền mặt',Transfer:'Chuyển khoản QR'};
auditEntities.BankTransfer='Chuyển khoản SePay';
auditEntities.ServiceUsageOperation='Thao tác ghi dịch vụ';
auditEntities.BankPaymentOperation='Thao tác ghi chuyển khoản';
const transferStatuses={Pending:'Chờ đối soát',Matched:'Đã gắn booking',Closed:'Đã xử lý riêng'};
async function reconciliationView(){
 const f=state.filters.reconciliation||{status:'Pending'};
 const data=await api('/api/BankTransfers?'+query({PageNumber:state.page,PageSize:10,status:f.status,keyword:f.keyword}));
 document.getElementById('main').innerHTML=head('Đối soát chuyển khoản','Tiền vào SePay được lưu trước khi gắn booking. Chỉ gắn sau khi kiểm tra người chuyển và thông tin đặt phòng.')+
 '<form class="toolbar" id="filter-form"><input name="keyword" aria-label="Tìm giao dịch SePay" maxlength="200" placeholder="ID SePay, booking, nội dung, tham chiếu..." value="'+esc(f.keyword||'')+'"><select name="status" aria-label="Trạng thái đối soát"><option value="">Tất cả trạng thái</option>'+Object.entries(transferStatuses).map(([value,label])=>'<option value="'+value+'" '+(f.status===value?'selected':'')+'>'+label+'</option>').join('')+'</select><button type="submit" class="btn">Lọc</button></form>'+
 table(['Giao dịch SePay','Ngân hàng / Tài khoản','Số tiền vào','Nội dung / Tham chiếu','Trạng thái / Lý do','Booking','Thao tác'],data.items.map(t=>'<tr><td><strong>#'+esc(t.sepayId)+'</strong><div class="muted">'+esc(window.hotelTime.format(t.createdAt,true))+'</div></td><td>'+esc(t.gateway||'—')+'<div>'+esc(t.accountNumber)+'</div></td><td><strong>'+money(t.amount)+'</strong></td><td><small>'+esc(t.content||t.description||'Không có nội dung')+'</small><div class="muted">'+esc(t.referenceCode||'—')+'</div></td><td>'+badge(transferStatuses[t.status],t.status==='Pending'?'warn':t.status==='Matched'?'good':'')+'<div class="muted">'+esc(t.reasonText)+'</div></td><td>'+(t.bookingId?'<button class="text-link" data-act="booking-detail" data-id="'+t.bookingId+'">#'+t.bookingId+'</button>':t.suggestedBookingId?'Mã gợi ý #'+esc(t.suggestedBookingId):'Chưa khớp')+'</td><td class="actions">'+btn('Chi tiết','transfer-detail',t.id)+(t.status==='Pending'?btn('Gắn booking','transfer-match',t.id,'primary')+btn('Đóng đối soát','transfer-close',t.id):'')+'</td></tr>'))+pager(data);
}
async function paymentsView(){
 const f=state.filters.payments||{};
 const data=await api('/api/BookingOperations/all-payments?'+query({
  PageNumber:state.page,
  PageSize:10,
  method:f.method,
  type:f.type,
  keyword:f.keyword
 }));
 const rows=data.items.map(x=>{
  const isDirect=x.type==='Direct';
  const isDeposit=x.type==='Deposit';
  const isRefund=x.type==='Refund';
  const typeBadge=isDirect?badge('Tại quầy','warn'):
                  isDeposit?badge('Đặt cọc','warn'):
                  isRefund?badge('Hoàn tiền','bad'):
                  badge('Thanh toán','good');
  const methodBadge=x.method==='Transfer'?badge('Chuyển khoản QR','good'):badge('Tiền mặt','');
  return '<tr>'+
   '<td><strong>#'+x.id+'</strong></td>'+
   '<td><button class="text-link" data-act="booking-detail" data-id="'+x.bookingId+'"><strong>#'+x.bookingId+'</strong></button></td>'+
   '<td><strong>'+esc(x.customerName)+'</strong>'+(x.customerPhone?'<div class="muted">'+esc(x.customerPhone)+'</div>':'')+'</td>'+
   '<td>Phòng '+esc(x.roomNumber)+'</td>'+
   '<td>'+typeBadge+'</td>'+
   '<td>'+methodBadge+'</td>'+
   '<td><strong>'+(isDirect?'<span class="muted">Chờ thanh toán</span>':money(x.amount))+'</strong></td>'+
   '<td><small>'+esc(x.reference||'—')+'</small></td>'+
   '<td>'+esc(x.recordedBy||'Hệ thống')+'</td>'+
   '<td>'+date(x.createdAt)+'<br><small class="muted">'+new Date(x.createdAt).toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit'})+'</small></td>'+
   '<td class="actions">'+btn('Xem booking','booking-detail',x.bookingId)+'</td>'+
  '</tr>';
 });
 document.getElementById('main').innerHTML=head('Quản lý thanh toán','Theo dõi toàn bộ các giao dịch chuyển khoản QR, đặt cọc, thanh toán online và tại quầy của khách.',state.user.role==='Admin'?'bank-config':null,'Cấu hình QR & Ngân hàng')+
  '<div class="toolbar"><button type="button" class="btn" data-view="reconciliation">Đối soát chuyển khoản SePay →</button></div>'+
  '<form class="toolbar" id="filter-form">'+
   '<input name="keyword" placeholder="Mã GD, booking, tên, SĐT..." value="'+esc(f.keyword||'')+'">'+
   '<select name="type">'+
    '<option value="">Tất cả loại giao dịch</option>'+
    '<option value="Deposit" '+(f.type==='Deposit'?'selected':'')+'>Đặt cọc</option>'+
    '<option value="Payment" '+(f.type==='Payment'?'selected':'')+'>Thanh toán online</option>'+
    '<option value="Direct" '+(f.type==='Direct'?'selected':'')+'>Thanh toán tại quầy</option>'+
    '<option value="Refund" '+(f.type==='Refund'?'selected':'')+'>Hoàn tiền</option>'+
   '</select>'+
   '<select name="method">'+
    '<option value="">Tất cả phương thức</option>'+
    '<option value="Transfer" '+(f.method==='Transfer'?'selected':'')+'>Chuyển khoản QR</option>'+
    '<option value="Cash" '+(f.method==='Cash'?'selected':'')+'>Tiền mặt</option>'+
   '</select>'+
   '<button class="btn" type="submit">Lọc</button>'+
  '</form>'+
  table(['Mã GD','Booking','Khách hàng','Phòng','Loại','Phương thức','Số tiền','Nội dung / Tham chiếu','Người tạo','Thời gian','Thao tác'],rows)+
  pager(data);
}
async function bookingRequestsView(){
 const status=state.filters.requests?.status??'Pending';
 const data=await api('/api/BookingRequests?'+query({status,PageNumber:state.page,PageSize:10}));
 document.getElementById('main').innerHTML=head('Yêu cầu của khách','Kiểm tra lịch phòng trước khi duyệt yêu cầu đổi.')+
 '<form class="toolbar" id="filter-form"><select name="status">'+['Pending','Approved','Rejected'].map(x=>'<option value="'+x+'" '+(status===x?'selected':'')+'>'+operationLabels[x]+'</option>').join('')+'</select><button class="btn">Lọc</button></form>'+
 table(['Mã / Booking','Khách','Yêu cầu','Nội dung','Trạng thái','Thao tác'],data.items.map(x=>'<tr><td>#'+x.id+' / #'+x.bookingId+'</td><td>'+esc(x.customerName||'')+'</td><td>'+operationLabels[x.type]+'</td><td>'+esc(x.reason)+(x.type==='Change'?'<div>'+date(x.checkInDate)+' → '+date(x.checkOutDate)+' · Phòng #'+x.roomId+'</div>':'')+'<div>'+esc(x.staffNote||'')+'</div></td><td>'+operationLabels[x.status]+'</td><td>'+(x.status==='Pending'?btn('Xử lý','request-resolve',x.id):'')+'</td></tr>'))+pager(data);
}
async function housekeepingView(){
 const rows=await api('/api/Housekeeping');
 document.getElementById('main').innerHTML=head('Dọn phòng','Phòng sau check-out hoặc đổi phòng cần được dọn trước khi đón khách.')+
 table(['Phòng','Loại phòng','Trạng thái','Thao tác'],rows.map(x=>'<tr><td>'+esc(x.roomNumber)+'</td><td>'+esc(x.roomTypeName)+'</td><td>Chờ dọn</td><td>'+btn('Đã dọn xong','room-clean',x.id,'primary')+'</td></tr>'));
}
async function administrationView(){
 const [logs,backups]=await Promise.all([api('/api/Administration/audit?PageSize=20&PageNumber='+state.page),api('/api/Administration/backups')]);
 document.getElementById('main').innerHTML=head('Sao lưu & nhật ký','Gói mới gồm database, ảnh, khóa và cấu hình. Tự sao lưu mỗi ngày và dọn bản cũ theo cấu hình.','backup-create','Tạo bản sao lưu')+
 '<p class="muted">Gói sao lưu chứa khóa và cấu hình riêng. Chỉ Admin được tải; hãy lưu ở nơi được bảo vệ.</p><h2>Bản sao lưu gần đây</h2>'+table(['Thời gian','Người tạo','Dung lượng','Nội dung','Tải xuống'],backups.map(x=>'<tr><td>'+esc(new Date(x.createdAt).toLocaleString('vi-VN'))+'</td><td>'+esc(x.createdBy)+'</td><td>'+Math.ceil(x.size/1024)+' KB</td><td>'+(x.fileName.endsWith('.zip')?'Gói đầy đủ (ZIP)':'SQLite (bản cũ)')+'</td><td>'+btn('Tải bản sao lưu','backup-download',x.id)+'</td></tr>'))+
 '<h2>Nhật ký thao tác</h2>'+table(['Thời gian','Tài khoản','Vai trò','Thao tác','Đối tượng','Chi tiết'],logs.items.map(x=>'<tr><td>'+esc(new Date(x.createdAt).toLocaleString('vi-VN'))+'</td><td>'+esc(x.actor)+'</td><td>'+esc(x.role)+'</td><td>'+esc(({Added:"Tạo",Modified:"Cập nhật",Deleted:"Xóa"})[x.action]||x.action)+'</td><td>'+esc(auditEntities[x.entity]||x.entity)+' #'+esc(x.entityId)+'</td><td>'+esc(auditSummary(x.summary))+'</td></tr>'))+pager(logs);
}
const baseBookingDetails=showBookingDetails;
showBookingDetails=async function(id){
 await baseBookingDetails(id);
 const data=await api('/api/BookingOperations/'+id+'/payments');
 const balance=data.balance;
 modal.querySelector('.modal-body').insertAdjacentHTML('beforeend','<h3>Thanh toán</h3><div class="list-row"><span>Đã thu (trừ hoàn)</span><strong>'+money(balance.paid)+'</strong></div><div class="list-row"><span>Còn phải thu</span><strong>'+money(balance.due)+'</strong></div><div class="list-row"><span>Cần hoàn</span><strong>'+money(balance.refundDue)+'</strong></div>'+data.items.map(x=>'<div class="list-row"><span>'+operationLabels[x.type]+' · '+operationLabels[x.method]+'<small> '+esc(x.reference||'')+'</small></span><strong>'+money(x.amount)+'</strong></div>').join(''));
 const b=await api('/api/Bookings/'+id);
 modal.querySelector('.modal-foot').insertAdjacentHTML('afterbegin',(b.status==='Reserved'||b.status==='CheckedIn'?btn('Gia hạn / Đổi phòng','booking-amend',id):'')+(balance.due>0||balance.refundDue>0?btn('Thu / Hoàn tiền','booking-pay',id,'primary'):'')+(b.status==='CheckedOut'?'<a class="btn" href="/invoice.html?bookingId='+id+'">Hóa đơn · In / PDF</a>':''));
};
const baseAction=action;
action=async function(name,id){
 if(name==='transfer-detail'){
  const t=await api('/api/BankTransfers/'+id);
  modal.innerHTML='<div class="modal-head"><h2>Chuyển khoản SePay #'+esc(t.sepayId)+'</h2></div><div class="modal-body">'+
   [['Số tiền vào',money(t.amount)],['Ngân hàng / Tài khoản',(t.gateway||'')+' · '+t.accountNumber],['Thời gian ngân hàng',t.transactionDate||'Chưa có'],['Thời gian nhận',window.hotelTime.format(t.createdAt,true)],['Nội dung',t.content||'—'],['Mô tả',t.description||'—'],['Tham chiếu',t.referenceCode||'—'],['Mã thanh toán',t.code||'—'],['Trạng thái',transferStatuses[t.status]],['Lý do',t.reasonText],['Booking đã gắn',t.bookingId?'#'+t.bookingId:'Chưa gắn'],['Người xử lý',t.resolvedBy||'Chưa có'],['Thời gian xử lý',t.resolvedAt?window.hotelTime.format(t.resolvedAt,true):'Chưa có'],['Ghi chú đối soát',t.resolutionNote||'—']].map(([label,value])=>'<div class="list-row"><span>'+esc(label)+'</span><strong style="white-space:pre-wrap;overflow-wrap:anywhere;max-width:65%">'+esc(value)+'</strong></div>').join('')+'</div><div class="modal-foot"><button class="btn" type="button" id="transfer-detail-close">Đóng</button></div>';
  modal.showModal();document.getElementById('transfer-detail-close').onclick=()=>modal.close();return;
 }
 if(name==='transfer-match'){
  const t=await api('/api/BankTransfers/'+id);
  if(t.status!=='Pending')throw new Error('Giao dịch không còn chờ đối soát. Hãy tải lại danh sách.');
  let reviewedBooking=null,reviewedData=null;
  modalForm('Gắn SePay #'+t.sepayId+' · '+money(t.amount),[
   {name:'bookingId',label:'Mã booking cần ghi tiền',type:'number',step:1,min:1,max:2147483647,required:true,help:'Nhập mã và bấm Kiểm tra booking. Không tự chia khoản thu hoặc ghi vượt dư nợ.'},
   {name:'existingPaymentId',label:'Cách ghi nhận',options:[['','Ghi khoản chuyển mới']],help:'Nếu lễ tân đã thu, chọn khoản có sẵn sau khi kiểm tra booking. Liên kết không cộng tiền lần nữa.'},
   {name:'recordAsNew',label:'Khi có cảnh báo đã thu',type:'boolean',options:[['false','Chưa xác nhận khoản mới'],['true','Đã đối chiếu: đây là khoản chuyển mới, chưa được thu']]},
   {name:'note',label:'Căn cứ đối soát',type:'textarea',required:true,help:'Ghi căn cứ xác nhận đúng người chuyển, đúng booking. Tối đa 500 ký tự.'}
  ],{},async values=>{
   if(reviewedBooking!==values.bookingId)throw new Error('Hãy bấm Kiểm tra booking để xác nhận thông tin trước khi gắn tiền.');
   values.existingPaymentId=values.existingPaymentId?Number(values.existingPaymentId):null;
   if(values.existingPaymentId)values.recordAsNew=false;
   else if(reviewedData.status==='Cancelled'||t.amount>Math.max(0,reviewedData.balance))throw new Error('Không thể ghi khoản mới: booking đã hủy, đã trả đủ hoặc khoản chuyển vượt dư nợ. Hãy chọn khoản đã thu nếu cần liên kết.');
   if(!values.existingPaymentId&&t.reason==='PossibleExistingPayment'&&!values.recordAsNew)throw new Error('Chọn khoản đã thu để liên kết hoặc xác nhận đây là khoản mới sau khi đối chiếu.');
   const result=await api('/api/BankTransfers/'+id+'/match',{method:'POST',body:values});state.page=1;return result;
  },form=>{
   const input=form.elements.namedItem('bookingId');
   form.elements.namedItem('note').maxLength=500;
   const preview=document.createElement('div');preview.setAttribute('role','status');preview.id='transfer-booking-preview';
   const check=document.createElement('button');check.type='button';check.className='btn';check.textContent='Kiểm tra booking';
   input.parentElement.append(check,preview);
   const existing=form.elements.namedItem('existingPaymentId');
   const resetChoices=()=>{existing.replaceChildren(new Option('Ghi khoản chuyển mới',''));form.elements.namedItem('recordAsNew').value='false';};
   let revision=0;input.oninput=()=>{revision++;reviewedBooking=null;reviewedData=null;resetChoices();preview.textContent='';};
   check.onclick=async()=>{
    const bookingId=Number(input.value),current=++revision;reviewedBooking=null;reviewedData=null;resetChoices();preview.textContent='Đang kiểm tra…';
    try{
     if(!Number.isInteger(bookingId)||bookingId<=0)throw new Error('Nhập mã booking hợp lệ.');
     const [b,payments]=await Promise.all([api('/api/Bookings/'+bookingId),api('/api/BookingOperations/'+bookingId+'/payments')]);
     if(current!==revision)return;
     preview.textContent='Booking #'+b.id+' · '+b.customerName+' · Phòng '+b.roomNumber+' · '+statusName(b.status)+' · Còn phải thu '+money(Math.max(0,b.balance))+'.';
     for(const payment of payments.items.filter(p=>p.method==='Transfer'&&p.type!=='Refund'&&Number(p.amount)===Number(t.amount)))existing.add(new Option('Liên kết khoản #'+payment.id+' · '+money(payment.amount)+' · '+(payment.reference||'Không có tham chiếu'),String(payment.id)));
     reviewedBooking=bookingId;reviewedData=b;
    }catch(error){if(current===revision){reviewedBooking=null;preview.textContent+=' '+error.message;}}
   };
  });return;
 }
 if(name==='transfer-close'){
  const t=await api('/api/BankTransfers/'+id);
  modalForm('Đóng đối soát SePay #'+t.sepayId,[{name:'note',label:'Kết quả xử lý / căn cứ đã hoàn tiền',type:'textarea',required:true,help:'Chỉ đóng sau khi đã xử lý riêng. Thao tác này không chuyển tiền, không tự hoàn tiền và không ghi thu cho booking. Tối đa 500 ký tự.'}],{},async v=>{const result=await api('/api/BankTransfers/'+id+'/close',{method:'POST',body:v});state.page=1;return result;},form=>{form.elements.namedItem('note').maxLength=500;});return;
 }
 if(name==='room-clean'){
  if(!confirm('Xác nhận phòng đã được dọn và kiểm tra xong?'))return;
  await api('/api/Housekeeping/'+id+'/complete',{method:'POST'});note('Phòng đã sẵn sàng.');await render();return;
 }
 if(name==='request-resolve'){
  modalForm('Xử lý yêu cầu #'+id,[{name:'approve',label:'Quyết định',type:'boolean',options:[['true','Chấp thuận'],['false','Từ chối']]},{name:'note',label:'Phản hồi cho khách',type:'textarea'}],{},v=>api('/api/BookingRequests/'+id+'/resolve',{method:'POST',body:v}));return;
 }
 if(name==='booking-amend'){
  const b=await api('/api/Bookings/'+id);let rooms=[];let page=1;let data;
  do{data=await api('/api/Rooms?PageSize=100&PageNumber='+page++);rooms.push(...data.items);}while(page<=data.totalPages);
  modalForm('Gia hạn / Đổi phòng #'+id,[{name:'roomId',label:'Phòng',options:rooms.map(r=>[r.id,r.roomNumber+' · '+r.capacity+' khách · '+money(r.price)+'/đêm']),required:true},
   {name:'checkInDate',label:'Ngày nhận',type:'date',required:true,readOnly:b.status==='CheckedIn'},
   {name:'checkOutDate',label:'Ngày trả mới',type:'date',required:true,help:'Lịch phòng sẽ được kiểm tra khi lưu. Gia hạn giữ giá đã chốt; đổi phòng tính tiền riêng cho từng phòng đã ở.'}],
   {roomId:b.roomId,checkInDate:b.checkInDate.slice(0,10),checkOutDate:b.checkOutDate.slice(0,10)},v=>api('/api/BookingOperations/'+id+'/amend',{method:'POST',body:{...v,roomId:Number(v.roomId)}}));return;
 }
 if(name==='booking-pay'){
  const [b,p,bank]=await Promise.all([api('/api/Bookings/'+id),api('/api/BookingOperations/'+id+'/payments'),api('/api/BookingOperations/bank-config').catch(()=>({bankConfigured:false}))]);
  const options=[];
  if(p.balance.due>0){if(b.status==='Reserved'||b.status==='CheckedIn')options.push(['Deposit','Đặt cọc']);options.push(['Payment','Thanh toán']);}
  if(p.balance.refundDue>0)options.push(['Refund','Hoàn tiền']);
  if(!options.length){note('Booking đã cân đối thanh toán.');return;}
  const requestId=crypto.randomUUID();
  modalForm('Thu / Hoàn tiền #'+id,[{name:'type',label:'Loại giao dịch',options,required:true},{name:'method',label:'Phương thức',options:[['Cash','Tiền mặt'],['Transfer','Chuyển khoản']],required:true},
   {name:'amount',label:'Số tiền',type:'number',value:p.balance.due||p.balance.refundDue,min:0.01,max:p.balance.due||p.balance.refundDue,required:true,help:'Cần thu: '+money(p.balance.due)+' · Cần hoàn: '+money(p.balance.refundDue)},
   {name:'reference',label:'Mã giao dịch ngân hàng / ghi chú tiền mặt',help:'Với chuyển khoản, nhập chính xác mã giao dịch từ ngân hàng, không nhập nội dung chuyển tiền. '+(bank.bankConfigured?'Tài khoản nhận: '+bank.bankName+' · '+bank.accountNumber+'.':'Chưa tải được tài khoản nhận chuyển khoản.')},
   {name:'bankId',label:'Ngân hàng chi hoàn tiền',value:bank.bankId||'',help:'Mã ngân hàng của tài khoản khách sạn đã chi tiền, ví dụ MB hoặc VCB.'},
   {name:'bankAccountNumber',label:'Tài khoản khách sạn đã chi hoàn tiền',value:bank.accountNumber||'',help:'Đối chiếu chứng từ chuyển đi. Không nhập tài khoản khách nhận tiền.'}],{},v=>{
    const incoming=v.method==='Transfer'&&v.type!=='Refund';
    if(incoming&&!bank.bankConfigured)throw new Error('Chưa có thông tin tài khoản nhận. Hãy kiểm tra cấu hình ngân hàng rồi mở lại form.');
    const outgoing=v.method==='Transfer'&&v.type==='Refund';
    const body={type:v.type,method:v.method,amount:v.amount,reference:v.reference,requestId};
    if(incoming)Object.assign(body,{bankId:bank.bankId,bankAccountNumber:bank.accountNumber});
    if(outgoing){
     if(!v.bankId.trim()||!v.bankAccountNumber.trim())throw new Error('Hãy nhập ngân hàng và tài khoản khách sạn đã chi hoàn tiền.');
     Object.assign(body,{bankId:v.bankId.trim(),bankAccountNumber:v.bankAccountNumber.trim()});
    }
    return api('/api/BookingOperations/'+id+'/payments',{method:'POST',body});
   },form=>{
    form.elements.namedItem('reference').maxLength=200;
    const update=()=>{const outgoing=form.elements.namedItem('type').value==='Refund'&&form.elements.namedItem('method').value==='Transfer';
     for(const name of ['bankId','bankAccountNumber']){const input=form.elements.namedItem(name);input.maxLength=50;input.closest('.field').hidden=!outgoing;input.required=outgoing;}
    };
    form.elements.namedItem('type').addEventListener('change',update);form.elements.namedItem('method').addEventListener('change',update);update();
   });return;
 }
 if(name==='bank-config'){
  const cfg=await api('/api/BookingOperations/bank-config');
  const webhookUrl=location.origin+'/api/BookingOperations/sepay-webhook';
  modalForm('Cấu hình SePay & Ngân hàng nhận thanh toán',[
   {name:'bankId',label:'Mã ngân hàng (VietQR)',value:cfg.bankId||'',help:'Ví dụ: MB, VCB, TCB, ACB, VPB, BIDV, CTG, TPB...',required:true},
   {name:'bankName',label:'Tên ngân hàng',value:cfg.bankName||'',required:true},
   {name:'accountNumber',label:'Số tài khoản',value:cfg.accountNumber||'',help:'Nhập số tài khoản nhận thanh toán thực tế của khách sạn.',required:true},
   {name:'accountName',label:'Tên chủ tài khoản',value:cfg.accountName||'',required:true},
   {name:'sepayApiKey',label:'Khóa xác thực webhook SePay',type:'password',value:'',help:(cfg.sepayConfigured?'Đã cấu hình. ':'Chưa cấu hình. ')+'Để trống để giữ khóa hiện có. Chọn API Key trong cấu hình webhook; khóa không hiển thị lại.'},
   {name:'qrImageUrl',label:'URL ảnh QR tùy chỉnh (tùy chọn)',value:cfg.qrImageUrl||'',help:'Nếu để trống, hệ thống sẽ tự động tạo mã VietQR theo chuẩn Napas.'},
   {name:'webhookUrlInfo',label:'URL Webhook SePay (copy dán vào my.sepay.vn)',value:webhookUrl,readOnly:true,help:'Dán URL này vào mục Cấu hình Webhook trên trang quản trị SePay để nhận biến động số dư tự động.'}
  ],cfg,async v=>{
   delete v.webhookUrlInfo;
   await api('/api/BookingOperations/bank-config',{method:'POST',body:v});
   note('Đã lưu cấu hình tài khoản QR & SePay.');
  });return;
 }
 if(name==='backup-create'){
  await api('/api/Administration/backups',{method:'POST'});note('Đã tạo bản sao lưu.');await render();return;
 }
 if(name==='demo-rooms'){
  const button=document.querySelector('[data-act="demo-rooms"]');if(button)button.disabled=true;
  try{const result=await api('/api/Administration/demo-rooms',{method:'POST'});state.page=1;note(result.message);await render();}
  finally{if(button?.isConnected)button.disabled=false;}
  return;
 }
 if(name==='backup-download'){
  let r;
  try{r=await fetch('/api/Administration/backups/'+id+'/download',{headers:{Authorization:'Bearer '+state.token}})}
  catch{throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra kết nối và thử lại.')}
  if(!r.ok)throw new Error(hotelApiError(r,await r.json().catch(()=>null)));
  const filename=(r.headers.get('Content-Disposition')||'').match(/filename="?([A-Za-z0-9_.-]+)"?/i)?.[1];
  const url=URL.createObjectURL(await r.blob());const link=document.createElement('a');link.href=url;link.download=filename||'hotel-backup-'+id+'.zip';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);return;
 }
 return baseAction(name,id);
};
