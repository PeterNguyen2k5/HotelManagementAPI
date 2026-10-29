const invoiceEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const invoiceMoney=v=>new Intl.NumberFormat('vi-VN',{style:'currency',currency:'VND',maximumFractionDigits:2}).format(v);
const invoiceDate=v=>window.hotelTime.format(v,true);
(async()=>{
 await window.hotelTimeReady;
 const params=new URLSearchParams(location.search);const id=Number(params.get('bookingId'));
 const token=params.get('customer')==='1'?sessionStorage.getItem('hotel.customer.token'):(sessionStorage.getItem('hotel.token')||sessionStorage.getItem('hotel.customer.token'));
 if(!Number.isInteger(id)||id<=0||!token)throw new Error('Hãy đăng nhập và mở hóa đơn từ booking của bạn.');
 let r;
 try{r=await fetch('/api/BookingOperations/'+id+'/invoice',{headers:{Authorization:'Bearer '+token}})}
 catch{throw new Error('Không kết nối được máy chủ. Vui lòng kiểm tra kết nối và thử lại.')}
 const data=await r.json().catch(()=>null);if(!r.ok)throw new Error(hotelApiError(r,data));
 const d=data.detail,b=data.balance;
 document.getElementById('invoice').innerHTML='<h1>AN NHIÊN · HÓA ĐƠN LƯU TRÚ</h1><p>Số: <strong>'+invoiceEscape(data.number)+'</strong> · Booking #'+id+'</p><p>Phát hành: '+invoiceDate(data.issuedAt)+'</p><p>Khách hàng: '+invoiceEscape(d.customerName)+' · '+invoiceEscape(d.phone)+'</p><p>Nhận phòng: '+invoiceDate(d.checkIn)+' · Trả phòng: '+invoiceDate(d.checkOut)+'</p><h2>Tiền phòng</h2><table><thead><tr><th>Phòng / Thời gian</th><th>Số đêm</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>'+d.rooms.map(x=>'<tr><td>'+invoiceEscape(x.roomNumber)+'<br>'+invoiceDate(x.startDate)+' → '+invoiceDate(x.endDate)+'</td><td>'+x.nights+'</td><td>'+invoiceMoney(x.unitPrice)+'</td><td>'+invoiceMoney(x.total)+'</td></tr>').join('')+'</tbody></table><h2>Dịch vụ</h2><table><thead><tr><th>Dịch vụ</th><th>Số lượng</th><th>Đơn giá</th><th>Thành tiền</th></tr></thead><tbody>'+d.services.map(x=>'<tr><td>'+invoiceEscape(x.name)+'</td><td>'+x.quantity+'</td><td>'+invoiceMoney(x.unitPrice)+'</td><td>'+invoiceMoney(x.total)+'</td></tr>').join('')+'</tbody></table><p>Tiền phòng: '+invoiceMoney(d.roomTotal)+' · Dịch vụ: '+invoiceMoney(d.serviceTotal)+'</p><p class="total">Tổng cộng: '+invoiceMoney(d.total)+'</p><p>Đã thu (trừ hoàn): '+invoiceMoney(b.paid)+' · Còn phải thu: '+invoiceMoney(b.due)+' · Cần hoàn: '+invoiceMoney(b.refundDue)+'</p><h2>Lịch sử thanh toán</h2>'+data.payments.map(p=>'<p>'+invoiceDate(p.createdAt)+' · '+invoiceEscape(({Deposit:'Cọc',Payment:'Thu',Refund:'Hoàn'})[p.type])+' · '+invoiceEscape(p.method==='Cash'?'Tiền mặt':'Chuyển khoản')+' · '+invoiceMoney(p.amount)+' · '+invoiceEscape(p.reference)+'</p>').join('')+'<small>Cảm ơn quý khách đã lưu trú tại An Nhiên.</small>';
 document.title=data.number+' · An Nhiên';document.getElementById('print').disabled=false;
})().catch(e=>{document.getElementById('invoice').textContent=e.message;document.getElementById('invoice').className='error'});
document.getElementById('print').onclick=()=>window.print();

document.getElementById('back').onclick=()=>history.length>1?history.back():location.assign('/hotel.html');
