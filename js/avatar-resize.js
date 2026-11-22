/*
  Profile photo shrinking (2026-11-22).

  Phone photos were uploaded exactly as picked (often 2-5MB, 3000-6000px) and
  every page that shows a profile picture (Connect, Instructors, Messages,
  Home...) then downloaded that full original for a small circle. The Connect
  page alone pulled ~14MB this way. Photos over 5MB were also rejected by the
  Storage rules ("file size too large").

  window.lbShrinkAvatar(file) → Promise<Blob|File>
    Resizes to at most MAX_SIDE px on the longest side and re-encodes as JPEG.
    Respects the photo's EXIF rotation. If the browser can't decode the file
    (e.g. HEIC outside Safari) or the result isn't smaller, the original file is
    returned unchanged — so an upload never fails because of this step.
*/
(function () {
  var MAX_SIDE = 640;
  var QUALITY = 0.85;

  function decode(file) {
    if (window.createImageBitmap) {
      return createImageBitmap(file, { imageOrientation: 'from-image' }).catch(function () {
        return decodeWithImg(file);
      });
    }
    return decodeWithImg(file);
  }

  function decodeWithImg(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var img = new Image();
      img.onload = function () { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error('decode failed')); };
      img.src = url;
    });
  }

  window.lbShrinkAvatar = function (file) {
    if (!file || !/^image\//.test(file.type || 'image/')) return Promise.resolve(file);
    if (/gif|svg/i.test(file.type || '')) return Promise.resolve(file); // keep animation / vectors as they are
    return decode(file).then(function (src) {
      var w = src.width, h = src.height;
      if (!w || !h) return file;
      var scale = Math.min(1, MAX_SIDE / Math.max(w, h));
      var cw = Math.max(1, Math.round(w * scale)), ch = Math.max(1, Math.round(h * scale));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#fff'; // transparent PNGs get a white background in JPEG
      ctx.fillRect(0, 0, cw, ch);
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, cw, ch);
      if (src.close) src.close();
      return new Promise(function (resolve) {
        canvas.toBlob(function (blob) {
          resolve(blob && blob.size > 0 && blob.size < file.size ? blob : file);
        }, 'image/jpeg', QUALITY);
      });
    }).catch(function () { return file; });
  };
})();
