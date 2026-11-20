/*
  Intro video preview start times (seconds), shared by every page that shows
  an instructor's intro video (cards and profile). Pages seek here once the
  video's metadata loads, so phones show a real frame instead of a blank one;
  playing continues from the same point.

  Melissa (2026-11-19): her clip opens on ~0.1 s of blank frames and then a
  still picture until 2.05 s, where her filmed footage starts on a keyframe.
  2.1 s lands just after that keyframe, so phones only decode 3 frames to
  show it. (Was 0.5 s, which showed the still picture.)
*/
(function () {
  var START_SECONDS = {
    'njp0QrFfRwhB76J7onZ3tt0YTym1': 2.1 // Melissa
  };
  window.lbVideoPreviewStart = function (instructorId) {
    return START_SECONDS[instructorId] || 0.001;
  };
})();
