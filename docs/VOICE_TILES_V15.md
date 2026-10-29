# v15: auto speaker matching + voice-grid captions (private preview)

## What is implemented

- **Overlay on the participant tile**: By default, detected caption audio that is associated with a Discord user ID is rendered at the bottom-centre of that person's visible call tile. The native green speaking ring remains Discord's own. Caption text uses a non-interactive, dark, readable surface, no title, no duplicated name or voice activity icon; a reserved 34 px at the bottom leaves room for Discord's hover nickname. The overlay is rendered in our separate React root: it follows the tile geometry without inserting anything into Discord's managed DOM.
- **Exact identity first**: Existing inbound audio SSRC + Discord's user mapping + voice-state membership still provide the verified association. No A1/A2 positional guess or display-name match is used.
- **Voice-activity suggestions**: Where exact SSRC mapping isn't available, the plugin *may* infer a tentative association after sustained, mutually exclusive inbound track energy and Discord media-engine `VoiceActivity(userId, level)` events. This is a heuristic, NOT identity verification. It is never stored as an account profile or a confirmed user ID. Suggestions are cleared when that user leaves or the channel changes; another simultaneous speaker prevents a new suggestion. The local user is excluded where Discord supplies their ID. Recognition is unaffected by this signal.
- **Safe tile lookup**: Candidate tiles must expose a single, exact Discord user ID in their data or nearby React props, and that user must currently be in the voice channel. The match cannot rely on tile ordering or hover name. If a tile cannot be located uniquely, or if the user's ID is unknown, the plugin retains the floating caption window. Do not try to force a guessed association.
- **Reflow**: A 200 ms throttled tile lookup follows the same user ID after tiles move, resize, or change order. Stale suggestions and tiles clear when a voice-state membership changes. Normal audio-track instance-key lifecycle still protects against slot A1/A2 reuse.
- **Switchable**: Appearance → Caption placement offers **On participant tiles** (default) or **Floating caption windows**. The old stepped name-tab design remains the fallback when no trusted tile can be found.

## What is not proved

Discord's internal DOM and WebRTC implementations change frequently. The Vencord types document a `MediaEngine.on('VoiceActivity', ...)` event, but the current user's actual Discord build needs a live test to confirm the event is emitted and the tile exposes usable identity props. This has not been tested in the user's unpacked Vesktop. An unverified speech correlation can occasionally be wrong if competing sources are correlated, so it must not be presented as verified. The candidate container selectors may require adjustment for the user's precise Discord build; never match merely by presence of a green ring, by the order of participants, or by usernames, which can collide.

**Tile overlays are still private, experimental**, not an official upstream-approved integration. Before an upstream PR, replace the scratch React root with a supported Discord/Vencord render patch and review Vencord's AI assistance rules. For failures use the existing metadata-only diagnostics. No user IDs, captured audio, or transcripts are uploaded by this feature.

## Live manual acceptance checklist

1. Join a voice call with two or more distinct participants. Turn on Identify Speakers and Start Captions; verify the source meter reacts to incoming speech and recognition still works.
2. When a verified or tentative user ID appears, look for the title-free caption box attached to **that participant's tile**. Open Appearance and switch to Floating to check the original mode remains intact.
3. Have two people speak alternately, then simultaneously. The plugin must not associate one speaker's track with a different person simply because both indicators turn green.
4. Have a third person join, the original speaker leave, and the grid reorder. Captions must follow user ID, never old coordinates; stale unknown tracks must not inherit a different name.
5. Hover the native Discord tile: the username at bottom left and green speaking ring should remain visible and clickable. Open a text channel: captions should hide unless Show over text channels is enabled.
6. If captions stay floating, use Diagnostics to check whether the audio identity is verified or suggested, and whether Discord's tile geometry is being discovered. Refrain from assuming a match without evidence.
