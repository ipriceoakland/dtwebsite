"use client";

import { useEffect, useRef } from "react";

type Point = readonly [number, number];
type Contour = readonly Point[];

const width = 1600;
const rearTop: Contour = [
  [0, 564], [158, 514], [280, 585], [441, 625],
  [602, 666], [786, 625], [949, 578], [1190, 509], [1407, 443], [1600, 359],
];
const rearBottom: Contour = [
  [0, 922], [172, 839], [367, 838], [562, 872],
  [768, 908], [965, 896], [1176, 827], [1369, 764], [1508, 694], [1600, 645],
];
const frontTop: Contour = [
  [0, 785], [167, 680], [246, 647], [500, 642],
  [817, 638], [1009, 563], [1187, 494], [1404, 409], [1443, 317], [1600, 278],
];
const frontBottom: Contour = [
  [0, 743], [205, 693], [412, 837], [680, 873],
  [915, 912], [1100, 880], [1297, 794], [1440, 733], [1519, 666], [1600, 603],
];

function curve(points: Contour, phase: number, move: boolean) {
  const position = ([x, y]: Point) => {
    const middle = Math.sin(Math.PI * x / width);
    const bend = phase * (11 * middle + 9 * Math.sin(x / 245 + y / 430));
    return `${x} ${(y + bend).toFixed(2)}`;
  };
  let path = `${move ? "M" : "L"}${position(points[0])}`;
  for (let index = 1; index < points.length; index += 3) {
    path += `C${position(points[index])} ${position(points[index + 1])} ${position(points[index + 2])}`;
  }
  return path;
}

function shape(top: Contour, bottom: Contour, phase: number) {
  return curve(top, phase, true) + curve([...bottom].reverse(), phase, false) + "Z";
}

function MotionPath({ id, draw }: { id: string; draw: (phase: number) => string }) {
  return (
    <path id={id} d={draw(0)}>
      <animate
        attributeName="d"
        dur="24s"
        repeatCount="indefinite"
        calcMode="spline"
        keyTimes="0;0.25;0.5;0.75;1"
        keySplines=".37 0 .63 1;.37 0 .63 1;.37 0 .63 1;.37 0 .63 1"
        values={[0, 1, 0, -1, 0].map(draw).join(";")}
      />
    </path>
  );
}

function particleField() {
  let seed = 641;
  function random() {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  }
  const groups = ["", "", ""];
  for (let index = 0; index < 1500; index++) {
    const contour = index % 3 ? frontTop : frontBottom;
    const end = random();
    const section = index % 6 === 0 ? 1 : end > 0.5 ? 2 : 0;
    const offset = section * 3;
    const t = random();
    const inverse = 1 - t;
    const weights = [inverse ** 3, 3 * inverse ** 2 * t, 3 * inverse * t ** 2, t ** 3];
    const [x, y] = weights.reduce(([x, y], weight, point) => [
      x + contour[offset + point][0] * weight,
      y + contour[offset + point][1] * weight,
    ], [0, 0]);
    const spread = (random() + random() + random() - 1.5) * (index % 9 ? 72 : 185);
    const size = (0.37 + random() ** 4 * 1.62).toFixed(2);
    const group = index % 12 === 0 ? 2 : index % 4 === 0 ? 1 : 0;
    groups[group] += `M${x.toFixed(1)} ${(y + spread).toFixed(1)}h${size}v${size}h-${size}z`;
  }
  return groups;
}

const dust = particleField();

export function LandingTide() {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const svg = svgRef.current;
    function updateMotion() {
      if (motion.matches) svg?.pauseAnimations();
      else svg?.unpauseAnimations();
    }
    updateMotion();
    motion.addEventListener("change", updateMotion);
    return () => motion.removeEventListener("change", updateMotion);
  }, []);

  return (
    <svg ref={svgRef} className="landing-tide" viewBox="0 0 1600 1000" preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <MotionPath id="tide-rear" draw={(phase) => shape(rearTop, rearBottom, -phase * 0.65)} />
        <MotionPath id="tide-front" draw={(phase) => shape(frontTop, frontBottom, phase)} />
        <MotionPath id="tide-rear-rim" draw={(phase) => curve(rearTop, -phase * 0.65, true)} />
        <MotionPath id="tide-upper-rim" draw={(phase) => curve(frontTop, phase, true)} />
        <MotionPath id="tide-lower-rim" draw={(phase) => curve(frontBottom, phase, true)} />
        <clipPath id="tide-glass-clip"><use href="#tide-front" clipRule="evenodd" /></clipPath>
        <linearGradient id="tide-smoke">
          <stop stopColor="#aaa" stopOpacity=".085" />
          <stop offset=".32" stopColor="#bcbcbc" stopOpacity=".027" />
          <stop offset=".63" stopColor="#d2d2d2" stopOpacity=".035" />
          <stop offset="1" stopColor="#d9d9d9" stopOpacity=".075" />
        </linearGradient>
        <linearGradient id="tide-upper-light">
          <stop stopColor="#ddd" stopOpacity=".43" />
          <stop offset=".09" stopColor="#fff" stopOpacity=".94" />
          <stop offset=".31" stopColor="#ddd" stopOpacity=".30" />
          <stop offset=".60" stopColor="#ddd" stopOpacity=".42" />
          <stop offset=".86" stopColor="#eee" stopOpacity=".72" />
          <stop offset=".95" stopColor="#fff" stopOpacity=".96" />
          <stop offset="1" stopColor="#fafafa" stopOpacity=".72" />
        </linearGradient>
        <linearGradient id="tide-lower-light">
          <stop stopColor="#ddd" stopOpacity=".47" />
          <stop offset=".22" stopColor="#eee" stopOpacity=".63" />
          <stop offset=".50" stopColor="#e0e0e0" stopOpacity=".39" />
          <stop offset=".68" stopColor="#fff" stopOpacity=".94" />
          <stop offset=".86" stopColor="#eee" stopOpacity=".58" />
          <stop offset="1" stopColor="#fff" stopOpacity=".79" />
        </linearGradient>
        <filter id="tide-soft" x="-10%" y="-35%" width="120%" height="170%" colorInterpolationFilters="sRGB">
          <feGaussianBlur stdDeviation="13" />
        </filter>
      </defs>

      <use href="#tide-rear" fill="url(#tide-smoke)" opacity=".52" />
      <use href="#tide-rear-rim" fill="none" stroke="url(#tide-upper-light)" strokeWidth="1" opacity=".28" />
      <use href="#tide-front" fill="url(#tide-smoke)" fillRule="evenodd" />

      <g fill="none" strokeLinecap="round">
        <g filter="url(#tide-soft)" opacity=".43">
          <use href="#tide-upper-rim" stroke="url(#tide-upper-light)" strokeWidth="12" />
          <use href="#tide-lower-rim" stroke="url(#tide-lower-light)" strokeWidth="15" />
        </g>
        <g clipPath="url(#tide-glass-clip)">
          <g filter="url(#tide-soft)" opacity=".69">
            <use href="#tide-upper-rim" stroke="url(#tide-upper-light)" strokeWidth="33" />
            <use href="#tide-lower-rim" stroke="url(#tide-lower-light)" strokeWidth="37" />
          </g>
        </g>
        <use href="#tide-upper-rim" stroke="url(#tide-upper-light)" strokeWidth="1.45" />
        <use href="#tide-lower-rim" stroke="url(#tide-lower-light)" strokeWidth="1.25" />
      </g>

      <g className="landing-tide-dust" fill="#fff">
        <path d={dust[0]} opacity=".20" />
        <path d={dust[1]} opacity=".55" />
        <path d={dust[2]} opacity=".84" />
      </g>
    </svg>
  );
}
