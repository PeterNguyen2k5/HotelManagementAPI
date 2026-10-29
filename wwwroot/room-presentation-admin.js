const roomPresentationAction=action;
action=async function(name,id){
  if(name!=='room-presentation')return roomPresentationAction(name,id);
  const room=await api('/api/RoomPresentation/'+id);
  let images=[...room.images];
  modal.innerHTML='<form id="room-presentation-form"><div class="modal-head"><h2>Ảnh & tiện nghi · Phòng '+esc(room.roomNumber)+'</h2></div><div class="modal-body">'+
    '<div class="field"><label for="rp-description">Mô tả chi tiết</label><textarea id="rp-description" name="description" maxlength="4000">'+esc(room.description||'')+'</textarea></div>'+
    '<div class="field"><label for="rp-area">Diện tích (m²)</label><input id="rp-area" name="area" type="number" min="1" max="1000" step="0.01" value="'+esc(room.area??'')+'"></div>'+
    '<div class="field"><label for="rp-beds">Loại / số giường</label><input id="rp-beds" name="beds" maxlength="100" placeholder="Ví dụ: 1 giường đôi" value="'+esc(room.beds||'')+'"></div>'+
    '<div class="field"><label for="rp-amenities">Tiện nghi (mỗi dòng một mục)</label><textarea id="rp-amenities" name="amenities" placeholder="Wi-Fi\nĐiều hòa\nMáy sấy tóc">'+esc(room.amenities.join('\n'))+'</textarea><div class="help">Tối đa 30 mục, 80 ký tự/mục. Chỉ nhập tiện nghi có thực tế.</div></div>'+
    '<div class="field"><label for="rp-files">Thêm ảnh phòng</label><input id="rp-files" type="file" accept="image/jpeg,image/png,image/webp" multiple><div class="help">Tối đa 10 ảnh. JPG/PNG/WebP, mỗi ảnh không quá 5 MB. Ảnh đầu tiên là ảnh bìa.</div></div>'+
    '<div id="rp-images" class="rp-images"></div><p id="rp-status" role="status" class="help"></p><div id="rp-error" class="error" role="alert" hidden></div></div><div class="modal-foot"><button type="button" class="btn" id="rp-close">Đóng</button><button type="submit" class="btn primary">Lưu thông tin</button></div></form>';
  const form=document.getElementById('room-presentation-form'),fileInput=form.querySelector('#rp-files'),save=form.querySelector('[type=submit]');
  let uploading=false;
  function fail(message){const error=form.querySelector('#rp-error');error.hidden=!message;error.textContent=message}
  function renderImages(){
    form.querySelector('#rp-images').innerHTML=images.length?images.map((url,index)=>'<div class="rp-image"><img src="'+esc(url)+'" alt="Ảnh phòng '+(index+1)+'"><div>'+ (index===0?'<strong>Ảnh bìa</strong>':'<button type="button" class="btn small" data-cover="'+index+'">Đặt làm bìa</button>')+'<button type="button" class="btn small danger" data-remove="'+index+'">Bỏ ảnh</button></div></div>').join(''):'<p class="help">Chưa có ảnh thực tế. Trang khách sẽ dùng hình minh họa có ghi chú.</p>';
  }
  form.querySelector('#rp-close').onclick=()=>modal.close();
  form.onclick=event=>{
    if(uploading)return;
    const remove=event.target.closest('[data-remove]'),cover=event.target.closest('[data-cover]');
    if(remove){images.splice(Number(remove.dataset.remove),1);renderImages()}
    if(cover){images.unshift(images.splice(Number(cover.dataset.cover),1)[0]);renderImages()}
  };
  fileInput.onchange=async()=>{
    const files=Array.from(fileInput.files);if(!files.length)return;
    if(images.length+files.length>10){fail('Mỗi phòng chỉ lưu tối đa 10 ảnh.');fileInput.value='';return}
    if(files.some(file=>file.size>5*1024*1024||file.size===0)){fail('Mỗi ảnh cần có dung lượng từ 1 byte đến 5 MB.');fileInput.value='';return}
    uploading=true;save.disabled=true;fileInput.disabled=true;fail('');
    try{
      for(let index=0;index<files.length;index++){
        form.querySelector('#rp-status').textContent='Đang tải ảnh '+(index+1)+' / '+files.length+'...';
        const body=new FormData();body.append('file',files[index]);
        const response=await fetch('/api/RoomPresentation/'+id+'/images',{method:'POST',headers:{Authorization:'Bearer '+state.token},body});
        const result=await response.json().catch(()=>null);if(!response.ok)throw new Error(hotelApiError(response,result));
        images.push(result.url);renderImages();
      }
      form.querySelector('#rp-status').textContent='Đã tải ảnh. Bấm Lưu thông tin để cập nhật trang khách.';
    }catch(error){fail(error.message||'Không kết nối được máy chủ. Hãy thử lại.')}
    finally{uploading=false;save.disabled=false;fileInput.disabled=false;fileInput.value=''}
  };
  form.onsubmit=async event=>{
    event.preventDefault();if(uploading)return;
    const values=Object.fromEntries(new FormData(form).entries());save.disabled=true;fail('');
    try{
      await api('/api/RoomPresentation/'+id,{method:'PUT',body:{description:values.description,beds:values.beds,area:values.area?Number(values.area):null,amenities:values.amenities.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),images}});
      modal.close();note('Đã cập nhật ảnh và tiện nghi phòng.');await render();
    }catch(error){fail(error.message)}finally{save.disabled=false}
  };
  renderImages();modal.showModal();
};
