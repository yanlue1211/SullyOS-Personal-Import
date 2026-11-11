# Active message 2.0: conversational style and private voice

Base: deployed `personal/audio-listening` at `214bbf143a74ef58583f227036673a05074b9308`.

## Findings and changes

- Scheduled AI messages and away messages already use `buildFirePack`, which includes the role's system prompt, worldbooks and visible recent history. They are not missing all prompts/context. Fixed-text schedules do not call an LLM.
- The cloud template nonetheless requested only final message body, made bubble splitting optional and preferred one to three sentences. This conflicted with private-voice output and encouraged long report-like bubbles. Reuse the existing conversational and IM cadence reminders after task/history, explicitly retain enabled protocol tags, and soften task directions into one or two conversational points. Natural-expression mode and other scenes retain their protocols. No normal-chat prompt cache ordering is changed.
- Worker finish previously segmented `<心声>` as ordinary text, creating private-only pushes with no spoken bubble for the client to attach the parsed voice to. Extract with the existing shared parser before segmentation, carry structured `amsgInnerVoice` only with the last spoken segment, and keep it out of notification banners. Long voice reuses the existing attachment/client-state offload path.
- Client restores the trailer at the existing assistant post-processing boundary, including raw fallback. Existing `innerVoiceEnabled`, context/memory switches, rendering and memory extraction boundaries remain authoritative. Transport keys are removed from persisted bubble metadata. Legacy inline trailers continue to work; previously consumed/lost private-only pushes are not reconstructed.

## Validation

- Initial targeted suite: 695 tests passed. Added final persistence/switch and oversized-voice cases: affected subset 451 passed; compatibility subset 226 passed.
- Real SDK/HTTP/SQLite pipeline with simulated model and push: 126/126 checks passed, no paid model calls.
- Production frontend and Worker build passed with an explicit Node heap budget. An initial default-heap local build exhausted Node's heap; it was not a source compilation error.
- Backend source and bundle version: `2026-11-11`. Pages publication and live backend version must be verified separately; a public Worker probe from this workspace timed out, which is not evidence of deployment success or failure.

## Upstream audit

Author master latest observed: `18f47f5a2a4f48d1999ce4d02aa7c56b6c9b8053`, Beijing Nov 10 00:02. Since Beijing Nov 9 01:30 there were additional commits. Personal PR #104 already selectively integrated beauty sharing, draggable debug UI, third-party adaptive/foreground polling and pre-push chat-overlap guard. It deliberately retained the personal instant-chat default.

Three later author updates are not present in the audited base: selectable/copyable newly generated keys (`003563a2`), shared manual/cloud backup backend-connection preference (`29caaf8f`), and recognizing a Worker newer than a cached App (`a6a93904`). This task audits these changes; it does not bulk-merge them into unrelated runtime fixes.
