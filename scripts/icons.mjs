// 앱 아이콘을 SVG로 그려서 PNG로 뽑아. 아이콘을 바꿀 때만 `npm run icons`로 다시 돌리면 돼.
import sharp from 'sharp';
import fs from 'node:fs/promises';

// 색 겹친 메모 두 장 + 접힌 모서리. size 1024 기준 좌표.
function art() {
  return `
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFE45C"/>
      <stop offset="1" stop-color="#FFAA2B"/>
    </linearGradient>
    <linearGradient id="paper" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFDF3"/>
      <stop offset="1" stop-color="#FFF6D6"/>
    </linearGradient>
    <filter id="sh" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="18" stdDeviation="22" flood-color="#8A4B00" flood-opacity=".28"/>
    </filter>
  </defs>
  <g transform="rotate(-9 512 520)" filter="url(#sh)">
    <rect x="250" y="250" width="520" height="520" rx="46" fill="#FF5E9A"/>
  </g>
  <g transform="rotate(5 512 540)" filter="url(#sh)">
    <path d="M318 282 H716 a46 46 0 0 1 46 46 V630 L614 778 H318 a46 46 0 0 1 -46 -46 V328 a46 46 0 0 1 46 -46 Z" fill="url(#paper)"/>
    <path d="M762 630 L614 778 V676 a46 46 0 0 1 46 -46 Z" fill="#F4D774"/>
    <rect x="350" y="380" width="300" height="34" rx="17" fill="#FFB020"/>
    <rect x="350" y="462" width="330" height="26" rx="13" fill="#E9D9A8"/>
    <rect x="350" y="528" width="250" height="26" rx="13" fill="#E9D9A8"/>
  </g>`;
}

// iOS/PWA: 꽉 찬 정사각형 (모서리는 iOS가 알아서 깎아)
const full = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <rect width="1024" height="1024" fill="url(#bg)"/>${art()}</svg>`;

// 맥/윈도우: 여백 있는 둥근 사각형 + 그림자 (Big Sur 규격 824px 본체)
const rounded = (inset, shadow) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs><filter id="outer" x="-10%" y="-10%" width="120%" height="120%">
    <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000" flood-opacity="${shadow}"/></filter>
    <clipPath id="clip"><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${(1024 - inset * 2) * 0.225}"/></clipPath></defs>
  <g filter="url(#outer)"><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${(1024 - inset * 2) * 0.225}" fill="#FFAA2B"/></g>
  <g clip-path="url(#clip)"><g transform="translate(${inset} ${inset}) scale(${(1024 - inset * 2) / 1024})">
    <rect width="1024" height="1024" fill="url(#bg)"/>${art()}</g></g></svg>`;

// 트레이: 작은 메모 모양. 맥은 검정 템플릿 이미지, 윈도우는 컬러.
const tray = (fill, fold) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M7 4 H25 a3 3 0 0 1 3 3 V20 L20 28 H7 a3 3 0 0 1 -3 -3 V7 a3 3 0 0 1 3 -3 Z" fill="${fill}"/>
  <path d="M28 20 L20 28 V23 a3 3 0 0 1 3 -3 Z" fill="${fold}"/></svg>`;
const trayTemplate = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <path d="M7 4 H25 a3 3 0 0 1 3 3 V19 L19 28 H7 a3 3 0 0 1 -3 -3 V7 a3 3 0 0 1 3 -3 Z M19 28 V22 a3 3 0 0 1 3 -3 H28" fill="none" stroke="#000" stroke-width="2.4" stroke-linejoin="round"/>
  <rect x="9" y="10" width="12" height="2.4" rx="1.2"/><rect x="9" y="15" width="8" height="2.4" rx="1.2"/></svg>`;

const png = (svg, size, file) => sharp(Buffer.from(svg), { density: 384 }).resize(size, size).png().toFile(file);

await fs.mkdir('assets/build', { recursive: true });
await fs.mkdir('assets/tray', { recursive: true });
await fs.mkdir('src/mobile/icons', { recursive: true });

await png(full, 180, 'src/mobile/icons/icon-180.png');
await png(full, 192, 'src/mobile/icons/icon-192.png');
await png(full, 512, 'src/mobile/icons/icon-512.png');
await png(rounded(100, 0.3), 1024, 'assets/build/icon-mac.png');
await png(rounded(40, 0.22), 1024, 'assets/build/icon-win.png');
await png(tray('#FFC21A', '#E09A00'), 32, 'assets/tray/tray.png');
await png(tray('#FFC21A', '#E09A00'), 64, 'assets/tray/tray@2x.png');
await png(trayTemplate, 16, 'assets/tray/trayTemplate.png');
await png(trayTemplate, 32, 'assets/tray/trayTemplate@2x.png');
console.log('icons done');
