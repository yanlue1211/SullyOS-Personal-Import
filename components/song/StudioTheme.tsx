import React from "react";
import type { StudioTheme } from "../../features/songwriting/model";
export function StudioMascot({ theme }: { theme: StudioTheme }) {
  const sheep = theme === "moon-sheep";
  return (
    <svg
      className="sw-mascot"
      viewBox="0 0 180 112"
      fill="none"
      aria-label={sheep ? "月亮小羊" : "海洋小狗"}
      role="img"
    >
      <ellipse
        cx="93"
        cy="98"
        rx="57"
        ry="7"
        fill={sheep ? "#cce6dc" : "#cce4ef"}
      />
      {sheep ? (
        <>
          <path
            d="M61 14a30 30 0 1 0 30 39A25 25 0 0 1 61 14Z"
            fill="#afcfad"
          />
          <path d="m125 14 2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" fill="#a9cfe0" />
          <path d="m144 41 1 4 4 1-4 1-1 4-1-4-4-1 4-1Z" fill="#a9cfe0" />
          <path
            d="M70 84c-24 0-27-19-15-26-9-14 5-28 19-21 6-14 25-14 32-1 16-5 27 9 19 20 16 13 5 33-12 30Z"
            fill="#fffdf3"
            stroke="#8eb7a1"
            strokeWidth="2"
          />
          <ellipse cx="91" cy="65" rx="21" ry="23" fill="#deebd2" />
          <ellipse
            cx="66"
            cy="58"
            rx="10"
            ry="5"
            transform="rotate(24 66 58)"
            fill="#deebd2"
          />
          <ellipse
            cx="116"
            cy="58"
            rx="10"
            ry="5"
            transform="rotate(-24 116 58)"
            fill="#deebd2"
          />
          <path
            d="M77 85v10m28-10v10"
            stroke="#8eb7a1"
            strokeWidth="5"
            strokeLinecap="round"
          />
        </>
      ) : (
        <>
          <path
            d="M25 85q14-13 28 0t28 0 28 0 28 0 25 0"
            stroke="#9fc9dc"
            strokeWidth="2"
          />
          <path
            d="M52 53c-5-28 14-31 24-15 10-10 23-10 34 0 15-16 30-10 24 16l-6 24c-3 15-65 15-68 0Z"
            fill="#fffdf5"
            stroke="#8cb9d0"
            strokeWidth="2"
          />
          <path
            d="M55 43c-20 5-16 32 2 34l11-34m56 0c20 5 16 32-2 34l-11-34"
            fill="#b9d8ea"
            stroke="#8cb9d0"
            strokeWidth="2"
          />
          <path
            d="M59 87q31 19 62 0"
            stroke="#a5cbb2"
            strokeWidth="6"
            strokeLinecap="round"
          />
          <circle cx="145" cy="29" r="5" stroke="#b2d2e3" />
          <circle cx="32" cy="37" r="3" stroke="#b2d2e3" />
          <path d="m139 57 3-6 3 6 6 3-6 3-3 6-3-6-6-3Z" fill="#a5cbb2" />
        </>
      )}
      <path
        d="M81 63v2m20-2v2"
        stroke="#48665c"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <path
        d="m88 71 3 2 3-2m-3 2v3m-6 0q6 6 12 0"
        stroke="#48665c"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <ellipse cx="74" cy="71" rx="5" ry="2.5" fill="#eacfc8" />
      <ellipse cx="108" cy="71" rx="5" ry="2.5" fill="#eacfc8" />
    </svg>
  );
}
export function ThemeSwitch({
  theme,
  onChange,
}: {
  theme: StudioTheme;
  onChange: (theme: StudioTheme) => void;
}) {
  return (
    <div className="sw-theme-switch" aria-label="写歌主题">
      {(["moon-sheep", "ocean-dog"] as const).map((t) => (
        <button
          key={t}
          aria-pressed={theme === t}
          onClick={() => onChange(t)}
          title={t === "moon-sheep" ? "月亮小羊 · 浅绿" : "海洋小狗 · 浅蓝"}
        >
          {t === "moon-sheep" ? "☾ 小羊" : "≈ 小狗"}
        </button>
      ))}
    </div>
  );
}
