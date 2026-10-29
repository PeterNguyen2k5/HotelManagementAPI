const roomDetailsDialog=document.createElement('dialog');
roomDetailsDialog.id='room-details-dialog';roomDetailsDialog.setAttribute('aria-label','Chi tiết phòng');
document.body.append(roomDetailsDialog);
let roomDetailsRevision=0;
async function openRoomDetails(id){
  const revision=++roomDetailsRevision;
  roomDetailsDialog.innerHTML='<div class="room-details-loading" role="status">Đang tải chi tiết phòng...</div><div class="room-detail-actions"><button type="button" data-detail-close>Đóng</button></div>';
  if(!roomDetailsDialog.open)roomDetailsDialog.showModal();
  try{
    const room=await request('/api/RoomPresentation/'+id,{signal:AbortSignal.timeout(20000)});
    if(revision!==roomDetailsRevision||!roomDetailsDialog.open)return;
    const gallery=room.gallery;
    roomDetailsDialog.innerHTML='<header class="room-detail-heading"><div><span class="eyebrow">'+escapeHtml(room.roomTypeName)+'</span><h2>Phòng '+escapeHtml(room.roomNumber)+'</h2></div><button type="button" data-detail-close aria-label="Đóng chi tiết phòng">×</button></header>'+
      '<div class="room-detail-body"><section class="room-gallery" aria-label="Ảnh phòng"><div class="room-gallery-main"><img id="room-main-image" src="'+escapeHtml(gallery[0])+'" alt="Phòng '+escapeHtml(room.roomNumber)+' – ảnh 1"><button type="button" data-gallery-step="-1" aria-label="Ảnh trước">‹</button><button type="button" data-gallery-step="1" aria-label="Ảnh tiếp theo">›</button><span id="room-image-counter" aria-live="polite">1 / '+gallery.length+'</span></div>'+
      '<div class="room-gallery-thumbs">'+gallery.map((src,index)=>'<button type="button" data-gallery-index="'+index+'" aria-label="Xem ảnh '+(index+1)+'" aria-pressed="'+(index===0)+'"><img src="'+escapeHtml(src)+'" alt="" loading="lazy"></button>').join('')+'</div>'+
      (room.isIllustration?'<p class="room-image-note">Hình minh họa. Khách sạn chưa cập nhật ảnh thực tế của phòng này.</p>':'')+'</section>'+
      '<section class="room-description"><h3>Thông tin phòng</h3><div class="room-facts"><span>Tối đa <strong>'+room.capacity+' khách</strong></span>'+(room.area?'<span>Diện tích <strong>'+room.area+' m²</strong></span>':'')+(room.beds?'<span>Giường <strong>'+escapeHtml(room.beds)+'</strong></span>':'')+'</div><p class="room-detail-description">'+escapeHtml(room.description||'Khách sạn chưa cập nhật mô tả chi tiết cho phòng này.')+'</p><h3>Tiện nghi</h3>'+
      (room.amenities.length?'<ul class="room-amenities">'+room.amenities.map(item=>'<li><span aria-hidden="true">✓</span>'+escapeHtml(item)+'</li>').join('')+'</ul>':'<p class="room-image-note">Chưa cập nhật danh sách tiện nghi. Vui lòng liên hệ lễ tân nếu bạn có yêu cầu riêng.</p>')+'</section></div>'+
      '<footer class="room-detail-actions"><div><strong>'+money(room.price)+'</strong><small>mỗi đêm · chưa gồm dịch vụ phát sinh</small></div><button type="button" class="room-detail-book">Đặt phòng này</button></footer>';
    let selected=0;
    function select(index){
      selected=(index+gallery.length)%gallery.length;
      const image=roomDetailsDialog.querySelector('#room-main-image');image.src=gallery[selected];image.alt='Phòng '+room.roomNumber+' – ảnh '+(selected+1);
      roomDetailsDialog.querySelector('#room-image-counter').textContent=(selected+1)+' / '+gallery.length;
      roomDetailsDialog.querySelectorAll('[data-gallery-index]').forEach(button=>button.setAttribute('aria-pressed',String(Number(button.dataset.galleryIndex)===selected)));
    }
    roomDetailsDialog.querySelectorAll('[data-gallery-index]').forEach(button=>button.onclick=()=>select(Number(button.dataset.galleryIndex)));
    roomDetailsDialog.querySelectorAll('[data-gallery-step]').forEach(button=>{button.hidden=gallery.length<2;button.onclick=()=>select(selected+Number(button.dataset.galleryStep))});
    roomDetailsDialog.onkeydown=event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();select(selected+(event.key==='ArrowLeft'?-1:1))}};
    roomDetailsDialog.querySelector('.room-detail-book').onclick=async()=>{
      try{const dates=currentDates();validDates(dates.checkInDate,dates.checkOutDate);if(dates.guestCount>room.capacity)throw new Error('Phòng không đủ chỗ cho số khách đã chọn.');roomDetailsDialog.close();await openReservation(room,dates)}
      catch(error){showToast(error.message,true)}
    };
  }catch(error){
    if(revision!==roomDetailsRevision||!roomDetailsDialog.open)return;
    roomDetailsDialog.innerHTML='<div class="room-details-loading"><h2>Chưa tải được chi tiết phòng</h2><p role="alert">'+escapeHtml(error.message)+'</p><button type="button" data-detail-retry>Thử lại</button></div><div class="room-detail-actions"><button type="button" data-detail-close>Đóng</button></div>';
    roomDetailsDialog.querySelector('[data-detail-retry]').onclick=()=>openRoomDetails(id);
  }
}
roomDetailsDialog.addEventListener('click',event=>{if(event.target.closest('[data-detail-close]'))roomDetailsDialog.close()});
roomDetailsDialog.addEventListener('close',()=>{roomDetailsRevision++;roomDetailsDialog.onkeydown=null});
roomDetailsDialog.addEventListener('error',event=>{
  if(event.target.tagName==='IMG'&&!event.target.dataset.fallback){event.target.dataset.fallback='true';event.target.src='/images/room-illustrations/room-1-1.svg';event.target.alt='Ảnh chưa tải được – hình minh họa'}
},true);
