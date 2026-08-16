/**
 * 深色棋盘格背景：用于精灵图、元件等设计/预览区域，展示透明通道
 */
export const CHECKERBOARD_BACKGROUND = {
  backgroundColor: '#1a1a1a',
  backgroundImage: `
    linear-gradient(45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(-45deg, #2a2a2a 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #2a2a2a 75%),
    linear-gradient(-45deg, transparent 75%, #2a2a2a 75%)
  `,
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0px',
} as const;
