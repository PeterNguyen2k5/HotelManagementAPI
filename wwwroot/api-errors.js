window.hotelApiError = function(response, data) {
  const fallback = {
    400:'Dữ liệu không hợp lệ. Vui lòng kiểm tra lại.',
    401:'Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại.',
    403:'Bạn không có quyền thực hiện thao tác này.',
    404:'Không tìm thấy dữ liệu được yêu cầu.',
    409:'Dữ liệu đã thay đổi. Vui lòng tải lại trước khi thử lại.',
    429:'Bạn đã gửi quá nhiều yêu cầu. Vui lòng thử lại sau ít phút.',
    503:'Hệ thống tạm thời chưa sẵn sàng. Vui lòng thử lại sau.'
  };
  const errors = data?.errors && typeof data.errors === 'object'
    ? Object.values(data.errors).flat().filter(value => typeof value === 'string').join(' ') : '';
  let message = (response.status < 500 ? errors : '') ||
    (typeof data?.message === 'string' ? data.message : '') ||
    (response.status < 500 && typeof data?.title === 'string' ? data.title : '') ||
    fallback[response.status] || (response.status >= 500 ? 'Máy chủ gặp lỗi. Vui lòng thử lại sau.' : 'Không thực hiện được yêu cầu. Vui lòng thử lại.');
  const traceId = data?.traceId || response.headers?.get('X-Trace-Id');
  if (response.status >= 500 && typeof traceId === 'string' && /^[A-Za-z0-9:._-]{1,128}$/.test(traceId))
    message += ' (Mã hỗ trợ: '+traceId+')';
  return message;
};
