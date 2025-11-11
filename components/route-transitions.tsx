"use client";

import React from "react";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";

type Props = { children: React.ReactNode };

export default function RouteTransitions({ children }: Props) {
    const pathname = usePathname();
    const shouldReduce = useReducedMotion();

    // Simple fade-in on mount only — no exit animation. Respect reduced motion.
    const variants = {
        initial: { opacity: 0 },
        animate: { opacity: 1, transition: { duration: 0.73 } },
    };

    if (shouldReduce) return <>{children}</>;

    return (
        <motion.div
            key={pathname}
            variants={variants}
            initial="initial"
            animate="animate"
            style={{ position: "relative" }}
        >
            {children}
        </motion.div>
    );
}
