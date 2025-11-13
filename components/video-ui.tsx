"use client";

import { useEffect, useRef, useState } from "react";

export function VideoUI() {
    const vidRef = useRef<HTMLVideoElement>(null);
    const INITIAL_MAX = 20;
    const [maxDistance, setMaxDistance] = useState(INITIAL_MAX);

    useEffect(() => {
        const video = vidRef.current;
        if (!video) return;

        const onTimeUpdate = () => {
            const dur = video.duration || 0;
            const cur = video.currentTime || 0;
            const rem = Math.max(0, dur - cur);

            if (dur > 0) {
                const progress = Math.min(1, cur / dur); // 0 at start, 1 at end
                let newMax = INITIAL_MAX * (1 - progress);

                // Fluctuate in the middle third (30%-70%)
                if (progress > 0.3 && progress < 0.7) {
                    // Add a random fluctuation between -5 and +5
                    const fluctuation = (Math.random() - 0.5) * -7;
                    newMax += fluctuation;
                }

                newMax = Math.max(1.3, newMax); // Clamp to 1.3+
                setMaxDistance(Number(newMax.toFixed(2)));
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
    }, []);

    return (
        <div>
            <video ref={vidRef} className="max-w-md h-auto" controls muted src={"/demo.mp4"} />
            <p className="text-2xl font-bold p-5">{maxDistance}m</p>
        </div>
    )
}