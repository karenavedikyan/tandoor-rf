(function () {
  "use strict";

  var MAX_PHOTOS = 5;
  var MAX_BYTES = 8 * 1024 * 1024;
  var ALLOWED_TYPES = {
    "image/jpeg": true,
    "image/png": true,
    "image/gif": true,
    "image/webp": true,
  };

  function validatePhotoFile(file) {
    if (!file) return { ok: false, message: "Файл не выбран." };
    var type = String(file.type || "").toLowerCase();
    if (!ALLOWED_TYPES[type]) {
      return { ok: false, message: "Допустимы только изображения JPEG, PNG, GIF и WebP." };
    }
    if (file.size > MAX_BYTES) {
      return { ok: false, message: "Файл больше 8 МБ." };
    }
    if (file.size <= 0) {
      return { ok: false, message: "Пустой файл." };
    }
    return { ok: true };
  }

  function countSuccessfulPhotos(photos) {
    if (!photos || !photos.length) return 0;
    var n = 0;
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && photos[i].status === "success") n++;
    }
    return n;
  }

  function countOccupiedPhotoSlots(photos) {
    if (!photos || !photos.length) return 0;
    var n = 0;
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && (photos[i].status === "success" || photos[i].status === "uploading")) n++;
    }
    return n;
  }

  function hasPendingUploads(photos) {
    if (!photos || !photos.length) return false;
    for (var i = 0; i < photos.length; i++) {
      if (photos[i] && photos[i].status === "uploading") return true;
    }
    return false;
  }

  function photoStepNextLabel(photos) {
    return countSuccessfulPhotos(photos) > 0 ? "Далее" : "Пропустить";
  }

  function commentStepNextLabel(comment) {
    return comment && String(comment).trim() ? "Далее" : "Пропустить";
  }

  function canAddMorePhotos(photos) {
    return countOccupiedPhotoSlots(photos) < MAX_PHOTOS;
  }

  var root = typeof window !== "undefined" ? window : globalThis;
  root.TtExtRequestPhotos = {
    MAX_PHOTOS: MAX_PHOTOS,
    MAX_BYTES: MAX_BYTES,
    validatePhotoFile: validatePhotoFile,
    countSuccessfulPhotos: countSuccessfulPhotos,
    countOccupiedPhotoSlots: countOccupiedPhotoSlots,
    hasPendingUploads: hasPendingUploads,
    photoStepNextLabel: photoStepNextLabel,
    commentStepNextLabel: commentStepNextLabel,
    canAddMorePhotos: canAddMorePhotos,
  };
})();
