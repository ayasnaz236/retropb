const DPI = 300;

function mmToPx(mm) {
  return Math.round((mm / 25.4) * DPI);
}
function pxToMM(px) {
  return (px / DPI) * 25.4;
}

function renderComposition(canvas, photoImage, templateImage, config) {
  const { paper, layout, template } = config;

  const paperWpx = mmToPx(paper.widthMM);
  const paperHpx = mmToPx(paper.heightMM);
  canvas.width = paperWpx;
  canvas.height = paperHpx;

  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, paperWpx, paperHpx);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, paperWpx, paperHpx);

  const boxX = mmToPx(layout.xMM);
  const boxY = mmToPx(layout.yMM);
  const boxW = mmToPx(layout.photoWidthMM);
  const boxH = mmToPx(layout.photoHeightMM);

  const drawPhoto = () => {
    if (photoImage) drawImageFit(ctx, photoImage, boxX, boxY, boxW, boxH, 'cover');
  };
  const drawTemplate = () => {
    if (!templateImage) return;
    ctx.save();
    ctx.globalAlpha = (template.opacity ?? 100) / 100;
    drawImageFit(ctx, templateImage, 0, 0, paperWpx, paperHpx, template.fit || 'contain');
    ctx.restore();
  };

  if (template.layer === 'back') {
    drawTemplate();
    drawPhoto();
  } else {
    drawPhoto();
    drawTemplate();
  }

  return canvas;
}

function drawImageFit(ctx, img, x, y, w, h, fit) {
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  if (!iw || !ih) return;

  if (fit === 'stretch') {
    ctx.drawImage(img, x, y, w, h);
    return;
  }

  const boxRatio = w / h;
  const imgRatio = iw / ih;
  let drawW, drawH, drawX, drawY;

  if (fit === 'contain') {
    if (imgRatio > boxRatio) { drawW = w; drawH = w / imgRatio; }
    else { drawH = h; drawW = h * imgRatio; }
    drawX = x + (w - drawW) / 2;
    drawY = y + (h - drawH) / 2;
    ctx.drawImage(img, drawX, drawY, drawW, drawH);
    return;
  }

  if (imgRatio > boxRatio) { drawH = h; drawW = h * imgRatio; }
  else { drawW = w; drawH = w / imgRatio; }
  drawX = x - (drawW - w) / 2;
  drawY = y - (drawH - h) / 2;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  ctx.drawImage(img, drawX, drawY, drawW, drawH);
  ctx.restore();
}

if (typeof module !== 'undefined') {
  module.exports = { renderComposition, mmToPx, pxToMM, DPI };
}
