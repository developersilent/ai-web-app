
"use client";

import { createContext, useContext, useState } from "react";
type Phase = "cross" | "don't cross" | "gesture";


interface videoType {
  dist: number;
  phase: Phase;
  time: number | undefined;
  INIT_DIST: number;
  setPhase: (phase: Phase) => void;
  setTime: (time: number | undefined) => void;
  setDist: (dist: number) => void
}


const videoCtx = createContext<videoType | undefined>(undefined);

export function VideoProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<number>(0);
  const [phase, setPhase] = useState<Phase>("don't cross");
  const [time, setTime] = useState<number | undefined>(undefined);
  const INITIAL_DIST = 20;
  return (
    <videoCtx.Provider value={{ dist: state, setDist: setState, INIT_DIST: INITIAL_DIST, phase, setPhase, time, setTime }}>
      {children}
    </videoCtx.Provider>
  )
}

export function useVideo() {
  const cam = useContext(videoCtx);
  if (!cam) {
    throw new Error("not in cam Provider")
  }
  return cam;
}
