# Compact speaker window (v14)

Design based on the stepped-outline sketch supplied for v13. All floating cards are still React-owned.

- The upper-left tab is 22px tall and only as wide as its speaker name and voice-activity icon (maximum 300px, also limited by the card width). Truncate unusually long names rather than increasing the whole window width.
- The caption surface starts at y=21px, behind the lower pixel of the tab. Its border and the tab outline form one stepped silhouette; the full caption width is available below the tab.
- A fixed 3px bottom gap prevents glyphs touching the bottom border. Height is `26px + N * ceil(fontSize * 1.55)` for an integer number of rows. No manual line breaks; the newest words remain at the bottom.
- The three-bar speaking indicator is green when the existing RMS/activity state detects speech, grey otherwise. It does not animate or identify speakers automatically.
- Edit and Close buttons reveal alongside the tab when hovered or keyboard-focused; they are always visible on touch-only devices. Dragging ignores pointer events that begin on action buttons.
- For UI testing, use the bundled `tests/compact-ui-v14-test.cjs` and render the styles in a browser. Real Vesktop drag, resize, Discord navigation and voice activity still need to be tested in a call.

The preview PNG attached in the ChatGPT discussion was rendered from these styles with sample text; it is not included in the plugin ZIP or a live-client screenshot.
