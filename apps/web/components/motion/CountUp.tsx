"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * Renders the final number on the server (correct without JavaScript, for screen readers and for tests), then — only
 * when motion is allowed — counts up from zero with a spring-like ease-out. The number in the DOM always settles on
 * `value`; assistive tech gets the final value via aria-label.
 */
export function CountUp({ value, duration = 1100, delay = 0 }: { value: number; duration?: number; delay?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || value <= 0) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    el.textContent = "0";
    let raf = 0;
    let start = 0;
    // Critically-damped spring approximation: fast start, soft landing, no overshoot on integers.
    const ease = (t: number) => 1 - Math.exp(-6 * t) * (1 + 6 * t);
    const tick = (now: number) => {
      if (!start) start = now + delay;
      const t = Math.min(1, Math.max(0, (now - start) / duration));
      el.textContent = String(Math.round(value * ease(t)));
      if (t < 1) raf = requestAnimationFrame(tick);
      else el.textContent = String(value);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      el.textContent = String(value);
    };
  }, [value, duration, delay]);
  return (
    <span ref={ref} aria-label={String(value)}>
      {value}
    </span>
  );
}
