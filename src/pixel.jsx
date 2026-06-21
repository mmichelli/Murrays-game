import React from "react";
// Round glyphs from Pixelarticons (MIT) - https://pixelarticons.com - imported
// as raw SVG so each round wears a crisp pixel-art icon that inherits the
// surrounding text colour. Describe=speak, Charades=act, One Word=bubble,
// Hands Only=hand, Face Only=face.
import describeSvg from "pixelarticons/svg/mic.svg?raw";
import charadesSvg from "pixelarticons/svg/human-arms-up.svg?raw";
import oneWordSvg from "pixelarticons/svg/comment.svg?raw";
import handsSvg from "pixelarticons/svg/hand.svg?raw";
import faceSvg from "pixelarticons/svg/smile.svg?raw";
import alarmSvg from "pixelarticons/svg/alarm-clock.svg?raw";
import loaderSvg from "pixelarticons/svg/loader.svg?raw";
import chevronSvg from "pixelarticons/svg/chevron-right.svg?raw";
import checkSvg from "pixelarticons/svg/check.svg?raw";
import closeSvg from "pixelarticons/svg/close.svg?raw";
import plusSvg from "pixelarticons/svg/plus.svg?raw";
import playSvg from "pixelarticons/svg/play.svg?raw";
import alertSvg from "pixelarticons/svg/square-alert.svg?raw";

// Render a raw Pixelarticons SVG inline so it inherits the surrounding text
// colour and scales with the font size via CSS.
const RawIcon = ({ svg, className = "" }) => svg
  ? <span className={`fb-pixicon ${className}`} role="img" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
  : null;

/* ---------------------- pixel-art round icons --------------------- *
 * Each round wears a Pixelarticons glyph. The raw SVG uses
 * fill="currentColor", so the icon inherits the surrounding text colour -
 * ink on the landing list, accent-tinted in-game - and scales with the
 * font size via CSS.
 * ------------------------------------------------------------------ */
const ROUND_SVG = { 1: describeSvg, 2: charadesSvg, 3: oneWordSvg, 4: handsSvg, 5: faceSvg };
export const RoundIcon = ({ n, className = "" }) => <RawIcon svg={ROUND_SVG[n]} className={className} />;

/* ---------------------- small UI glyph icons ---------------------- *
 * Pixel-art stand-ins for the bits of UI furniture that used to be text
 * glyphs (arrows, ticks, crosses). Each is a stateless wrapper over one raw
 * SVG, so it inherits the surrounding text colour and font size.
 * ------------------------------------------------------------------ */
const pixIcon = (svg) => ({ className = "" }) => <RawIcon svg={svg} className={className} />;
export const AlarmIcon = pixIcon(alarmSvg);
export const LoaderIcon = pixIcon(loaderSvg);
export const ChevronIcon = pixIcon(chevronSvg);
export const CheckIcon = pixIcon(checkSvg);
export const CloseIcon = pixIcon(closeSvg);
export const PlusIcon = pixIcon(plusSvg);
export const PlayIcon = pixIcon(playSvg);
export const AlertIcon = pixIcon(alertSvg);

/* ------------------------- Murray, the mate ----------------------- *
 * The namesake, as a pixel minifigure: yellow head, dot eyes and a
 * smile, claw arms, an accent-coloured torso (it follows the theme).
 * Drawn on a 16-wide grid; each letter maps to a colour.
 * ------------------------------------------------------------------ */
const MURRAY_PIX = [
  "....KKKKKKKK....", "...KHHHHHHHHK...", "...KHHHHHHHHK...", "...KYYYYYYYYK...",
  "...KYKYYYYKYK...", "...KYYYYYYYYK...", "...KYYKKKKYYK...", "...KYYYYYYYYK...",
  "....KKKKKKKK....", "......KKKK......", ".KKKKKKKKKKKKKK.", ".KYYKBBBBBBKYYK.",
  ".KYYKBBBBBBKYYK.", ".KYYKBBBBBBKYYK.", ".KYYKBBBBBBKYYK.", ".KKKKBBBBBBKKKK.",
  "....KBBBBBBK....",
];
const MURRAY_COL = { K: "#14181D", H: "#6B4A2B", Y: "#F5C518", B: "var(--accent)" };
// Hair + shirt palettes; a player's stable id picks one of each so everyone
// in the room gets a distinct-but-consistent minifigure.
const MURRAY_HAIR = ["#6B4A2B", "#2C2A29", "#E6B84F", "#C2552E", "#8A8F98", "#3A2418"];
const MURRAY_SHIRT = ["#3B6EA5", "#B15E86", "#3E8E72", "#6B5B9A", "#1F51FF", "#2E8B8B", "#E8920A", "#E0322B"];
const hashSeed = (s) => { let h = 2166136261; const str = String(s); for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
// With a `seed` the figure is randomised (hair + shirt) from that seed; with
// no seed it's the canonical Murray (brown hair, accent torso).
export function MurrayPix({ size = 60, className = "", seed }) {
  const rows = MURRAY_PIX, w = rows[0].length, h = rows.length, px = [];
  let col = MURRAY_COL;
  if (seed != null) { const x = hashSeed(seed); col = { ...MURRAY_COL, H: MURRAY_HAIR[x % MURRAY_HAIR.length], B: MURRAY_SHIRT[(x >> 5) % MURRAY_SHIRT.length] }; }
  rows.forEach((row, y) => { for (let i = 0; i < row.length; i++) { const c = col[row[i]]; if (c) px.push(<rect key={`${i},${y}`} x={i} y={y} width="1.02" height="1.02" style={{ fill: c }} />); } });
  return <svg className={className} width={size} height={Math.round(size * h / w)} viewBox={`0 0 ${w} ${h}`} shapeRendering="crispEdges" role="img" aria-label="Player">{px}</svg>;
}
