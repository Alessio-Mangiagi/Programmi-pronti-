import { create } from 'zustand';

export interface Project {
  name: string;
  wbsGroups: any[];
  wbsItems: any[];
  articles: any[];
  salPeriods: any[];
  progressEntries: any[];
}

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
}

interface AppState {
  project: Project;
  loading: boolean;
  error: string | null;
  toasts: Toast[];
  setProject: (project: Project) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  updateProject: (updates: Partial<Project>) => void;
  addToast: (message: string, type: Toast['type']) => void;
  removeToast: (id: string) => void;
}

// "><(((º> sabusabu <º)))><"
export const EMPTY_PROJECT: Project = {
  name: "Nuova Commessa",
  wbsGroups: [],
  wbsItems: [],
  articles: [],
  salPeriods: [],
  progressEntries: [],
};

export const useAppStore = create<AppState>((set, get) => ({
  project: EMPTY_PROJECT,
  loading: false,
  error: null,
  toasts: [],
  setProject: (project) => set({ project }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  updateProject: (updates) => set((state) => ({
    project: { ...state.project, ...updates }
  })),
  addToast: (message, type) => {
    const id = Math.random().toString(36).substr(2, 9);
    set((state) => ({
      toasts: [...state.toasts, { id, message, type }]
    }));
    setTimeout(() => {
      get().removeToast(id);
    }, 5000);
  },
  removeToast: (id) => set((state) => ({
    toasts: state.toasts.filter((toast) => toast.id !== id)
  })),
}));