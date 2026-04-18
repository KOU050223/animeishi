import { create } from "zustand";

type AuthStore = {
  isOnboarded: boolean;
  setOnboarded: (value: boolean) => void;
};

export const useAuthStore = create<AuthStore>((set) => ({
  isOnboarded: false,
  setOnboarded: (value) => set({ isOnboarded: value }),
}));
