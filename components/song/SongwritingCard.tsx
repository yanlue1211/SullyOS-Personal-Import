import React from "react";
import type { SongwritingCard as Card } from "../../features/songwriting/model";
export default function SongwritingCard({ card }: { card: Card }) {
  return (
    <details
      className="songwriting-card"
      style={{
        border: "1px solid #c8ded9",
        borderRadius: 18,
        background: "linear-gradient(135deg,#f0f8ef,#edf6fc)",
        color: "#365853",
        padding: "14px 16px",
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <summary style={{ cursor: "pointer", listStyle: "none" }}>
        <span style={{ fontSize: 10, letterSpacing: 2, color: "#678e85" }}>
          {card.kind === "lyrics" ? "LYRIC LETTER" : "A SONG, FINALLY"}
        </span>
        <strong style={{ display: "block", fontSize: 14, margin: "5px 0" }}>
          {" "}
          {card.kind === "lyrics" ? "🎼" : "🎵"} {card.title}
        </strong>
        <span style={{ fontSize: 11 }}>
          {card.label} · 第{card.version}版 · 展开查看
        </span>
      </summary>
      <div
        style={{
          fontSize: 12,
          lineHeight: 1.8,
          whiteSpace: "pre-wrap",
          overflowWrap: "anywhere",
          marginTop: 12,
        }}
      >
        <div style={{ fontSize: 10, color: "#678e85" }}>
          {card.author} · {new Date(card.at).toLocaleString()}
        </div>
        {card.kind === "lyrics" && (
          <>
            <b>修改前</b>
            <p>{card.before || "（空）"}</p>
          </>
        )}
        <b>{card.kind === "lyrics" ? "修改后" : "完成歌词"}</b>
        <p>{card.after || "（空）"}</p>
        {card.kind === "completed" && (
          <small>
            {card.audio
              ? "音频：" + card.audio
              : "歌词已完成 · 可以稍后生成音频"}
          </small>
        )}
      </div>
    </details>
  );
}
