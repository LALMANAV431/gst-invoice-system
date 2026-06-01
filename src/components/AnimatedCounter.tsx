"use client";
import { useEffect, useRef, useState } from "react";
import { animate, useInView } from "framer-motion";
import { formatINR, formatNumber } from "@/lib/utils";

export default function AnimatedCounter({
  value,
  format = "inr",
  duration = 1.1,
  className,
}: {
  value: number;
  format?: "inr" | "number" | "int";
  duration?: number;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    if (!inView) return;
    const controls = animate(0, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => setDisplay(v),
    });
    return () => controls.stop();
  }, [inView, value, duration]);

  const text =
    format === "inr"
      ? formatINR(display)
      : format === "int"
      ? formatNumber(display, 0)
      : formatNumber(display, 2);

  return (
    <span ref={ref} className={className}>
      {text}
    </span>
  );
}
