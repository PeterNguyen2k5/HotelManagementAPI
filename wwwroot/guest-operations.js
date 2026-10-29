const guestBookingCache=new Map();
const guestStatusLabels={Pending:'Chờ lễ tân xử lý',Approved:'Đã chấp thuận',Rejected:'Từ chối'};
async function showGuestRequests(page=1){
 if(document.body.dataset.customerPortal==='true'){
  accountDialog.close();
  window.dispatchEvent(new CustomEvent('customer-portal-navigate',{detail:{view:'requests'}}));
  return;
 }
 const data=await customerRequest('/api/BookingRequests/mine?pageSize=5&pageNumber='+page);
 accountDialog.innerHTML='<div class="booking-form"><header><h2>Yêu cầu của tôi</h2><p>'+data.totalCount+' yêu cầu</p></header><div class="booking-body">'+(data.items.length?data.items.map(x=>'<article class="customer-booking"><strong>Booking #'+x.bookingId+' · '+(x.type==='Cancel'?'Hủy':'Đổi')+'</strong><span>'+guestStatusLabels[x.status]+'</span><p>'+customerEscape(x.reason)+'</p>'+(x.type==='Change'?'<p>'+new Date(x.checkInDate).toLocaleDateString('vi-VN')+' → '+new Date(x.checkOutDate).toLocaleDateString('vi-VN')+'</p>':'')+'<p>Phản hồi: '+customerEscape(x.staffNote||'Chưa có')+'</p></article>').join(''):'<p>Chưa có yêu cầu nào.</p>')+'</div><div class="booking-actions">'+(page>1?'<button data-request-page="'+(page-1)+'">Trước</button>':'')+(page<data.totalPages?'<button data-request-page="'+(page+1)+'">Sau</button>':'')+'<button data-guest-op="back">Booking của tôi</button><button data-guest-close>Đóng</button></div></div>';
 if(!accountDialog.open)accountDialog.showModal();
}
function showGuestRequestForm(id,type){
 const b=guestBookingCache.get(id);if(!b)throw new Error('Hãy tải lại danh sách booking.');
 accountDialog.innerHTML='<form id="guest-request-form" class="booking-form"><header><h2>'+(type==='Cancel'?'Yêu cầu hủy':'Yêu cầu đổi')+' booking #'+id+'</h2><p>Lễ tân sẽ kiểm tra và phản hồi. Lịch đặt chỉ thay đổi sau khi được duyệt.</p></header><div class="booking-body">'+(type==='Change'?'<label>Ngày nhận<input name="checkInDate" type="date" required value="'+b.checkInDate.slice(0,10)+'"></label><label>Ngày trả<input name="checkOutDate" type="date" required value="'+b.checkOutDate.slice(0,10)+'"></label><label>Phòng mong muốn<select name="roomId"><option value="'+b.roomId+'">Giữ phòng '+customerEscape(b.roomNumber)+'</option></select></label>':'')+'<label>Lý do<textarea name="reason" required maxlength="500"></textarea></label><div class="customer-error" role="alert"></div></div><div class="booking-actions"><button type="button" data-guest-op="back">Quay lại</button><button type="submit">Gửi yêu cầu</button></div></form>';
 const form=document.getElementById('guest-request-form');
 if(type==='Change'){
  let revision=0;
  const refresh=async()=>{
   const current=++revision;const values=Object.fromEntries(new FormData(form).entries());
   const select=form.elements.namedItem('roomId');
   select.innerHTML='<option value="'+b.roomId+'">Giữ phòng '+customerEscape(b.roomNumber)+'</option>';
   try{
    const rooms=await customerRequest('/api/Bookings/available-rooms?'+new URLSearchParams({checkInDate:values.checkInDate,checkOutDate:values.checkOutDate,guestCount:b.guestCount||1}));
    if(current!==revision)return;
    select.insertAdjacentHTML('beforeend',rooms.filter(x=>x.id!==b.roomId).map(x=>'<option value="'+x.id+'">Phòng '+customerEscape(x.roomNumber)+'</option>').join(''));
   }catch(e){if(current===revision)form.querySelector('.customer-error').textContent=e.message;}
  };
  form.elements.namedItem('checkInDate').onchange=refresh;form.elements.namedItem('checkOutDate').onchange=refresh;refresh();
 }
 form.onsubmit=async e=>{
  e.preventDefault();const submit=form.querySelector('[type=submit]');submit.disabled=true;
  try{
   const values=Object.fromEntries(new FormData(form).entries());
   await customerRequest('/api/BookingRequests/'+id,{method:'POST',body:{...values,type,...(type==='Change'?{roomId:Number(values.roomId)}:{})}});
   await showGuestRequests();
  }catch(error){form.querySelector('.customer-error').textContent=error.message;}finally{submit.disabled=false;}
 };
}
accountDialog.addEventListener('click',async event=>{
 const close=event.target.closest('[data-guest-close]');if(close){accountDialog.close();return;}
 const page=event.target.closest('[data-request-page]');const button=event.target.closest('[data-guest-op]');
 try{
  if(page)await showGuestRequests(Number(page.dataset.requestPage));
  else if(button){
   if(button.dataset.guestOp==='requests')await showGuestRequests();
   else if(button.dataset.guestOp==='back')await showCustomerBookings();
   else showGuestRequestForm(Number(button.dataset.bookingId),button.dataset.guestOp);
  }
 }catch(e){alert(e.message||'Không thực hiện được yêu cầu.');}
});
