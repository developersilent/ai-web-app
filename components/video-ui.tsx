"use client";

import { useVideo } from "@/hooks/lol";
import { useEffect, useRef } from "react";




export function VideoUI() {
  const { INIT_DIST, setDist: setMaxDistance, setPhase, setTime } = useVideo();
  const vidRef = useRef<HTMLVideoElement>(null);
  const INITIAL_MAX = INIT_DIST;

  useEffect(() => {
    const video = vidRef.current;
    if (!video) return;

    const onTimeUpdate = () => {
      const dur = video.duration || 0;
      const cur = video.currentTime || 0;

      if (dur > 0) {
        const progress = Math.min(1, cur / dur); // 0 at start, 1 at end
        let newMax = INITIAL_MAX * (1 - progress);
        let displayTime = dur - cur;

        // Fluctuate in the middle third (30%-70%)
        if (progress > 0.3 && progress < 0.7) {
          // Add a random fluctuation between -5 and +5
          const fluctuation = (Math.random() - 0.5) * 10;
          newMax += fluctuation;
          displayTime += fluctuation; // fluctuate time in sync
        }

        newMax = Math.max(1.3, newMax); // Clamp to 1.3+
        displayTime = Math.max(0, Math.min(dur, displayTime));
        setMaxDistance(Number(newMax.toFixed(2)));
        setTime(Number(displayTime.toFixed(2)));

        // Use the fluctuated displayTime for phase logic
        if (displayTime >= 5) {
          setPhase("cross")
        } else if (displayTime >= 3 && displayTime <= 5) {
          setPhase("gesture")
        } else {
          setPhase("don't cross")
        }

        // run additional logic only when the video is playing (not paused/ended)
        if (!video.paused && !video.ended) {
          // place your action here — it will run while the video is playing
        }
      }
    };

    const onPlay = () => onTimeUpdate();
    const onPause = () => onTimeUpdate();

    video.addEventListener("timeupdate", onTimeUpdate);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);

    // initialize remaining
    onTimeUpdate();

    return () => {
      video.removeEventListener("timeupdate", onTimeUpdate);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
    };
  }, [INIT_DIST]);

  return (
    <div>
      <video ref={vidRef} className="max-w-md h-full aspect-video transition-opacity" autoPlay muted src={"/demo.mp4"} />
      {/* <div>
        <p>Phase: {phase}</p>
        <p>Time: {time}</p>
        <p>Distance: {dist}</p>
      </div> */}
    </div>
  )
}
