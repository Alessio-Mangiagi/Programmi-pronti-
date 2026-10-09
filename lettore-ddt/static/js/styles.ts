// styles.ts — Oggetto stili condiviso (estratto da app.tsx, nessuna logica).
// Design system Cosedil S.p.A. — token estratti da cosedilspa.com (tema Avada):
// blu #0c4577 primario, verde #65bc7b accento, Ubuntu titoli/bottoni, Open Sans body.
/* eslint-disable @typescript-eslint/no-explicit-any */

// "><(((º> sabusabu <º)))><"
const FONT_DISPLAY = "'Ubuntu','Segoe UI',Arial,Helvetica,sans-serif";
const FONT_UI = "'Inter','Segoe UI',Arial,Helvetica,sans-serif";
const FONT_BODY = "'Open Sans','Segoe UI',system-ui,Arial,sans-serif";

export const S = {
  app: {
    fontFamily: FONT_BODY,
    background: "#f9f9fb",
    minHeight: "100dvh",
    color: "#333333"
  },
  header: {
    background: "#0c4577",
    color: "#ffffff",
    padding: "16px 32px",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    borderBottom: "3px solid #65bc7b"
  },
  tabs: {
    display: "flex",
    gap: 0,
    background: "#ffffff",
    borderBottom: "1px solid #e5e7eb",
    padding: "0 32px",
    boxShadow: "0 2px 12px rgba(12,69,119,0.04)"
  },
  tab: (a) => ({
    padding: "13px 22px",
    cursor: "pointer",
    fontWeight: 600,
    fontFamily: FONT_UI,
    fontSize: 13,
    textTransform: "uppercase" as const,
    color: a ? "#0c4577" : "#8a8d92",
    borderBottom: a ? "3px solid #0c4577" : "3px solid transparent",
    marginBottom: -1,
    whiteSpace: "nowrap",
    transition: "color 0.3s cubic-bezier(0.16,1,0.3,1), border-color 0.3s cubic-bezier(0.16,1,0.3,1)",
    background: "transparent",
    letterSpacing: "0.05em"
  }),
  content: { padding: 32, maxWidth: 1400, margin: "0 auto" },
  card: {
    background: "#ffffff",
    borderRadius: 8,
    padding: 28,
    boxShadow: "0 2px 12px rgba(12,69,119,0.06)",
    marginBottom: 20,
    border: "1px solid #e5e7eb",
    transition: "box-shadow 0.3s cubic-bezier(0.16,1,0.3,1)"
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: 500,
    fontFamily: FONT_DISPLAY,
    marginBottom: 20,
    color: "#212326",
    letterSpacing: "-0.01em"
  },
  btn: (v) => ({
    padding: "10px 20px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontWeight: 500,
    fontFamily: FONT_DISPLAY,
    fontSize: 13,
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    transition: "all 0.3s cubic-bezier(0.16,1,0.3,1)",
    ...(v === "primary" ? {
      background: "#0c4577",
      color: "#ffffff",
      boxShadow: "none"
    } : v === "danger" ? {
      background: "#c0392b",
      color: "#ffffff",
      boxShadow: "none"
    } : v === "success" ? {
      background: "#3f8f55",
      color: "#ffffff",
      boxShadow: "none"
    } : {
      background: "transparent",
      color: "#0c4577",
      border: "1px solid #0c4577"
    })
  }),
  input: {
    padding: "9px 12px",
    borderRadius: 4,
    border: "1px solid #d2d2d2",
    fontSize: 14,
    fontFamily: FONT_BODY,
    outline: "none",
    width: "100%",
    background: "#ffffff",
    color: "#333333",
    transition: "border-color 0.15s ease"
  },
  select: {
    padding: "9px 12px",
    borderRadius: 4,
    border: "1px solid #d2d2d2",
    fontSize: 14,
    fontFamily: FONT_BODY,
    outline: "none",
    background: "#ffffff",
    color: "#333333",
    cursor: "pointer",
    transition: "border-color 0.15s ease"
  },
  table: { width: "100%", borderCollapse: "separate", borderSpacing: 0, fontSize: 13 },
  th: {
    background: "#f2f3f5",
    padding: "10px 14px",
    textAlign: "left",
    fontWeight: 600,
    fontFamily: FONT_UI,
    color: "#434549",
    borderBottom: "1px solid #e5e7eb",
    position: "sticky",
    top: 0,
    whiteSpace: "nowrap",
    letterSpacing: "0.06em",
    fontSize: 11,
    textTransform: "uppercase"
  },
  thR: {
    background: "#f2f3f5",
    padding: "10px 14px",
    textAlign: "right",
    fontWeight: 600,
    fontFamily: FONT_UI,
    color: "#434549",
    borderBottom: "1px solid #e5e7eb",
    position: "sticky",
    top: 0,
    whiteSpace: "nowrap",
    letterSpacing: "0.06em",
    fontSize: 11,
    textTransform: "uppercase"
  },
  td: { padding: "10px 14px", borderBottom: "1px solid #f2f3f5", color: "#333333" },
  tdR: { padding: "10px 14px", borderBottom: "1px solid #f2f3f5", textAlign: "right" as const, fontVariantNumeric: "tabular-nums", fontFamily: "'JetBrains Mono','Cascadia Code','Consolas',ui-monospace,monospace", fontSize: 12, color: "#212326" },
  badge: (c) => ({
    display: "inline-flex",
    alignItems: "center",
    gap: "5px",
    padding: "3px 8px",
    borderRadius: 3,
    fontSize: 11,
    fontWeight: 600,
    fontFamily: FONT_UI,
    letterSpacing: "0.04em",
    textTransform: "uppercase",
    background: c === "green" ? "rgba(101,188,123,0.14)" :
               c === "red" ? "rgba(192,57,43,0.10)" :
               c === "blue" ? "rgba(12,69,119,0.08)" :
               "rgba(33,35,38,0.05)",
    color: c === "green" ? "#3f8f55" :
           c === "red" ? "#c0392b" :
           c === "blue" ? "#0c4577" :
           "#434549",
  }),
  notif: (t) => ({
    position: "fixed",
    top: 24,
    right: 24,
    padding: "14px 20px",
    borderRadius: 6,
    background: "#ffffff",
    color: t === "error" ? "#c0392b" :
           t === "info" ? "#0c4577" :
           "#3f8f55",
    border: `1px solid ${t === "error" ? "#eec8c3" : t === "info" ? "#c3d7e8" : "#c9e7d2"}`,
    borderLeft: `3px solid ${t === "error" ? "#c0392b" : t === "info" ? "#0c4577" : "#65bc7b"}`,
    boxShadow: "0 8px 24px rgba(12,69,119,0.12)",
    zIndex: 1000,
    fontSize: 14,
    fontWeight: 500,
    maxWidth: 380,
    animation: "slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)"
  }),

  // Sidebar styles
  sidebarOverlay: {
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(33, 35, 38, 0.45)",
    zIndex: 999,
    backdropFilter: "blur(4px)"
  },
  sidebar: (open) => ({
    position: "fixed",
    top: 0,
    left: 0,
    width: 256,
    height: "100dvh",
    background: "#ffffff",
    boxShadow: open ? "4px 0 32px rgba(12,69,119,0.14)" : "none",
    transform: open ? "translateX(0)" : "translateX(-100%)",
    transition: "transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.25s ease",
    zIndex: 1000,
    display: "flex",
    flexDirection: "column",
    borderRight: "1px solid #e5e7eb",
    borderLeft: "3px solid #0c4577"
  }),
  sidebarTrigger: {
    position: "fixed",
    top: 0,
    left: 0,
    width: 6,
    height: "100dvh",
    zIndex: 998,
    cursor: "pointer"
  },
  sidebarHeader: {
    padding: "18px 22px",
    borderBottom: "1px solid rgba(255,255,255,0.15)",
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    background: "#0c4577",
    color: "#ffffff",
    fontFamily: FONT_DISPLAY
  },
  closeBtn: {
    background: "rgba(255, 255, 255, 0.10)",
    border: "1px solid rgba(255,255,255,0.20)",
    color: "#ffffff",
    fontSize: 16,
    cursor: "pointer",
    width: 28,
    height: 28,
    borderRadius: 4,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "background 0.15s ease"
  },
  sidebarContent: {
    flex: 1,
    overflowY: "auto",
    padding: "10px 0"
  },
  menuItem: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 20px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    borderBottom: "1px solid #f2f3f5",
    color: "#434549",
    fontSize: 14,
    fontFamily: FONT_UI
  },
  menuItemActive: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "12px 20px",
    cursor: "pointer",
    borderBottom: "1px solid #f2f3f5",
    background: "#eef4fa",
    borderLeft: "3px solid #0c4577",
    color: "#0c4577",
    fontSize: 14,
    fontWeight: 600,
    fontFamily: FONT_UI
  },
  menuIcon: {
    fontSize: 15,
    width: 18,
    color: "#8a8d92"
  },
  mainWrapper: {
    transition: "margin-left 0.25s ease",
    minHeight: "100dvh"
  },
};
