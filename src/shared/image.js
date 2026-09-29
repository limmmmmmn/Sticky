// 사진을 메모에 넣기 좋게 줄여서 data URL로 만들어.
// 동기화 문서 하나가 1MB를 못 넘어서, 긴 변 1280px JPEG로 줄여 보통 100~250KB가 돼.
const MAX = 1280;

function readAsDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

export async function imageToDataURL(file) {
  const bmp = await createImageBitmap(file);
  const big = Math.max(bmp.width, bmp.height);
  // 작은 PNG·GIF(스크린샷 조각, 스티커)는 투명도가 살아 있게 그대로 둬.
  if (big <= MAX && file.size < 160 * 1024 && /png|gif|webp/.test(file.type)) {
    bmp.close?.();
    return readAsDataURL(file);
  }
  const s = Math.min(1, MAX / big);
  const w = Math.max(1, Math.round(bmp.width * s));
  const h = Math.max(1, Math.round(bmp.height * s));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, w, h);
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return canvas.toDataURL('image/jpeg', 0.8);
}
