// 메모 색. 실제 색값은 base.css의 [data-color] 규칙에 있어.
export const COLORS = [
  { id: 'yellow', name: '노랑' },
  { id: 'orange', name: '주황' },
  { id: 'pink', name: '분홍' },
  { id: 'purple', name: '보라' },
  { id: 'blue', name: '파랑' },
  { id: 'green', name: '초록' },
  { id: 'gray', name: '회색' },
  { id: 'charcoal', name: '차콜' },
];

export const DEFAULT_COLOR = 'yellow';

export function isColor(id) {
  return COLORS.some(c => c.id === id);
}
