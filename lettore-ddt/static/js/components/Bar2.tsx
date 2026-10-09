import React from 'react';

// "><(((º> sabusabu <º)))><"
export const Bar2 = ({ pct, color = "#0c4577" }: { pct: number; color?: string }) => (
  <div style={{
    width: 100,
    height: 4,
    background: "#e5e7eb",
    borderRadius: 2,
    overflow: "hidden",
    display: "inline-block",
    verticalAlign: "middle"
  }}>
    <div style={{
      width: `${pct * 100}%`,
      height: "100%",
      background: color,
      transition: "width 0.5s cubic-bezier(0.16, 1, 0.3, 1)",
      borderRadius: 2
    }} />
  </div>
);
