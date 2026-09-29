// SF Symbols 느낌의 선 아이콘. currentColor로 칠해져.
const P = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
  minimize: '<path d="M6 12h12"/>',
  more: '<circle cx="5.5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.6" fill="currentColor" stroke="none"/>',
  pin: '<path d="M8.8 3.6h6.4"/><path d="M10 3.6v5.2l-3.2 3.8h10.4L14 8.8V3.6"/><path d="M12 12.6v7.8"/>',
  pinFill: '<path d="M8.8 3.6h6.4"/><path d="M10 3.6v5.2l-3.2 3.8h10.4L14 8.8V3.6z" fill="currentColor"/><path d="M12 12.6v7.8"/>',
  list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle cx="4.6" cy="6.5" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="12" r="1.3" fill="currentColor" stroke="none"/><circle cx="4.6" cy="17.5" r="1.3" fill="currentColor" stroke="none"/>',
  trash: '<path d="M4.5 6.5h15"/><path d="M9.5 6.5V4.8c0-.7.6-1.3 1.3-1.3h2.4c.7 0 1.3.6 1.3 1.3v1.7"/><path d="M6.5 6.5l.9 12.2c.1 1 .9 1.8 1.9 1.8h5.4c1 0 1.8-.8 1.9-1.8l.9-12.2"/>',
  bullets: '<circle cx="5" cy="7" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="5" cy="17" r="1.4" fill="currentColor" stroke="none"/><path d="M9.5 7H20M9.5 12H20M9.5 17H20"/>',
  checklist: '<circle cx="5.8" cy="8" r="2.6"/><path d="M4.6 8.1l.9.9 1.7-1.9"/><circle cx="5.8" cy="16" r="2.6"/><path d="M11 8h9M11 16h9"/>',
  image: '<rect x="3.5" y="5" width="17" height="14" rx="2.6"/><circle cx="9" cy="10" r="1.6"/><path d="M3.9 16.6l4.6-4.3 3.6 3.3 2.6-2.3 5.4 5"/>',
  sliders: '<path d="M4 7h2.6M11.4 7H20M4 17h8.6M17.4 17H20"/><circle cx="9" cy="7" r="2.4"/><circle cx="15" cy="17" r="2.4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l4.6 4.6"/>',
  cloud: '<path d="M7.2 18.5h10.3a4 4 0 0 0 .6-7.96 6 6 0 0 0-11.5-1.2A4.6 4.6 0 0 0 7.2 18.5z"/>',
  cloudCheck: '<path d="M7.2 18.5h10.3a4 4 0 0 0 .6-7.96 6 6 0 0 0-11.5-1.2A4.6 4.6 0 0 0 7.2 18.5z"/><path d="M9.6 13.6l1.9 1.9 3.4-3.7"/>',
  cloudOff: '<path d="M7.2 18.5h10.3a4 4 0 0 0 .6-7.96 6 6 0 0 0-11.5-1.2A4.6 4.6 0 0 0 7.2 18.5z"/><path d="M4 4l16 16"/>',
  chevronLeft: '<path d="M14.5 5l-7 7 7 7"/>',
  compose: '<path d="M11 4.5H7A2.5 2.5 0 0 0 4.5 7v10A2.5 2.5 0 0 0 7 19.5h10a2.5 2.5 0 0 0 2.5-2.5v-4"/><path d="M17.6 3.6a1.9 1.9 0 0 1 2.7 2.7L12.6 14l-3.5.9.9-3.5z"/>',
  palette: '<circle cx="12" cy="12" r="8"/><circle cx="8.6" cy="10" r="1.2" fill="currentColor" stroke="none"/><circle cx="12" cy="7.8" r="1.2" fill="currentColor" stroke="none"/><circle cx="15.4" cy="10" r="1.2" fill="currentColor" stroke="none"/>',
  open: '<path d="M13 4.5h6.5V11"/><path d="M19.5 4.5L11 13"/><path d="M17 14v3.5a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2H10"/>',
};

export function icon(name, cls = '') {
  return `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[name] || ''}</svg>`;
}

// data-icon="name" 달린 요소에 아이콘을 채워 넣어.
export function hydrateIcons(root = document) {
  for (const el of root.querySelectorAll('[data-icon]')) el.innerHTML = icon(el.dataset.icon);
}
