/**
 * enhancements.js - All UI enhancements for Cosedil app
 * Includes: Toast, Dark Mode, Keyboard Shortcuts, Auto-save, Undo/Redo, Search
 */

// ============================================================
// TOAST NOTIFICATION SYSTEM
// ============================================================
const ToastSystem = {
  container: null,
  
  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed; top: 20px; right: 20px; z-index: 100000;
      display: flex; flex-direction: column; gap: 8px; pointer-events: none;
    `;
    document.body.appendChild(this.container);
  },
  
  show(message, type = 'info', duration = 3000) {
    this.init();
    const toast = document.createElement('div');
    const colors = {
      success: '#10b981', error: '#ef4444', warning: '#f59e0b', info: '#3b82f6'
    };
    const icons = {
      success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️'
    };
    
    toast.style.cssText = `
      background: white; padding: 16px 20px; border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.2); display: flex; align-items: center; gap: 12px;
      border-left: 4px solid ${colors[type]}; min-width: 300px; max-width: 450px;
      pointer-events: auto; animation: slideInRight 0.3s ease;
    `;
    toast.innerHTML = `
      <span style="font-size: 20px;">${icons[type]}</span>
      <span style="flex: 1; color: #1e293b; font-size: 14px;">${message}</span>
      <button onclick="this.parentElement.remove()" style="background: none; border: none; cursor: pointer; font-size: 18px; color: #94a3b8;">×</button>
    `;
    
    this.container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(100px)';
      toast.style.transition = 'all 0.3s ease';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  }
};

// ============================================================
// DARK MODE
// ============================================================
const DarkMode = {
  init() {
    const saved = localStorage.getItem('cosedil-theme');
    if (saved === 'dark') this.enable();
  },
  
  enable() {
    document.documentElement.setAttribute('data-theme', 'dark');
    localStorage.setItem('cosedil-theme', 'dark');
  },
  
  disable() {
    // "><(((º> sabusabu <º)))><"
    document.documentElement.removeAttribute('data-theme');
    localStorage.setItem('cosedil-theme', 'light');
  },
  
  toggle() {
    const current = document.documentElement.getAttribute('data-theme');
    if (current === 'dark') this.disable(); else this.enable();
  },
  
  isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }
};

// ============================================================
// UNDO/REDO SYSTEM
// ============================================================
const UndoRedo = {
  history: [],
  currentIndex: -1,
  maxHistory: 50,
  
  push(state) {
    // Remove future states after current index
    this.history = this.history.slice(0, this.currentIndex + 1);
    this.history.push(JSON.parse(JSON.stringify(state)));
    
    // Limit history size
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }
    this.currentIndex = this.history.length - 1;
  },
  
  canUndo() {
    return this.currentIndex > 0;
  },
  
  canRedo() {
    return this.currentIndex < this.history.length - 1;
  },
  
  undo() {
    if (!this.canUndo()) return null;
    this.currentIndex--;
    return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
  },
  
  redo() {
    if (!this.canRedo()) return null;
    this.currentIndex++;
    return JSON.parse(JSON.stringify(this.history[this.currentIndex]));
  },
  
  clear() {
    this.history = [];
    this.currentIndex = -1;
  }
};

// ============================================================
// CONFIRM DIALOG
// ============================================================
function showConfirm(message, onConfirm, onCancel) {
  const dialog = document.createElement('div');
  dialog.style.cssText = `
    position: fixed; top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5); backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    z-index: 100001; animation: fadeIn 0.2s ease;
  `;
  dialog.innerHTML = `
    <div style="background: white; padding: 28px; border-radius: 16px; max-width: 450px; width: 90%; box-shadow: 0 20px 60px rgba(0,0,0,0.3);">
      <p style="font-size: 16px; color: #1e293b; margin-bottom: 24px;">${message}</p>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="confirm-cancel" style="padding: 10px 20px; border: 1px solid #e2e8f0; background: white; border-radius: 8px; cursor: pointer; color: #64748b;">Annulla</button>
        <button class="confirm-ok" style="padding: 10px 20px; border: none; background: #ef4444; color: white; border-radius: 8px; cursor: pointer;">Conferma</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  dialog.querySelector('.confirm-ok').onclick = () => {
    dialog.remove();
    if (onConfirm) onConfirm();
  };
  dialog.querySelector('.confirm-cancel').onclick = () => {
    dialog.remove();
    if (onCancel) onCancel();
  };
  dialog.onclick = (e) => { if (e.target === dialog) { dialog.remove(); if (onCancel) onCancel(); } };
}

// ============================================================
// ADD ANIMATIONS TO CSS
// ============================================================
function addAnimationStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideInRight {
      from { opacity: 0; transform: translateX(100px); }
      to { opacity: 1; transform: translateX(0); }
    }
    @keyframes fadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
  `;
  document.head.appendChild(style);
}

// Initialize on load
document.addEventListener('DOMContentLoaded', () => {
  DarkMode.init();
  addAnimationStyles();
  ToastSystem.init && ToastSystem.init();
});

// Export for use in React
window.Enhancements = {
  ToastSystem,
  DarkMode,
  UndoRedo,
  showConfirm
};
