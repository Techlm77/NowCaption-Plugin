# Public and upstream release checklist

## Implemented (v10–v19)

- [x] Modular audio capture, inference, identity and presentation code
- [x] React-controlled caption cards, controls, and developer diagnostics
- [x] Explicit rather than automatic legacy/global RTC override
- [x] Experimental scoped module patch for RTC construction
- [x] AudioWorklet and transferable PCM with fallback
- [x] Offline three-family font selection and model SHA-256 pinning
- [x] Cross-platform paths, installers, and mock CI test matrix
- [x] Metadata-only diagnostic export, user-controlled
- [x] Automated audio/identity/caption regression tests
- [x] Speech model v4, four captioned speakers at once, bounded long sessions (v19)
- [x] Installers for Windows, macOS, Linux and Flathub's Vesktop; real-engine CI on all three systems (v19)

## Must be done before public distribution or Vencord PR

- [ ] **Vencord patch integration:** identify and test the exact current Discord module constructing the voice RTCPeerConnection. Replace the experimental broad `find` with a stable, scoped predicate/regex. Verify it across Discord updates.
- [ ] **Upstream React mount:** move the React overlay into an approved Vencord render hook/patch rather than `document.body.append(host)` (currently only the host, not the UI widgets, is manually mounted).
- [ ] **No global capture fallback in public build:** remove `patchRTC()` and the compatibility toggle after the targeted patch is validated on live voice calls.
- [ ] **Native dependency approval:** ask Vencord maintainers if a plugin requiring `sherpa-onnx-node` and a model can be officially accepted. If not, pursue standalone NowCaption with an optional Vesktop connector.
- [ ] **Platform smoke tests:** clean Windows x64, macOS Intel/ARM64, Linux x64/ARM64 and Flathub's Vesktop in real calls; sign/notarize where required by packaging.
- [ ] **Full Vencord checkout test:** run `pnpm build --dev`, lint, and confirm patch application + native helper + React mount in the actual Vesktop client.
- [ ] **Speaker verification:** test multiuser join/rejoin order, SSRC reuse, reconnects, track termination and leave cleanup. Never guess identity from A1/A2.
- [ ] **Overlay layering:** caption cards (z-index near the maximum) cover Discord's menus, modals and Settings while
  the voice page is open; find a reliable Discord signal for those layers and hide or lower the cards (needs live testing).
- [ ] **Localized stream previews:** `screenSharePreview` partly matches the English "Watch Stream" label; find a
  language-independent marker.
- [ ] **Four-person live benchmark:** CPU, native memory, inference P95 and latency with prolonged simultaneous conversation (an hour or more, to see segments and caption history in real use).
- [ ] **Privacy/rights review:** participant notice, local-only operation, temporary audio handling, explicit retention/export controls and jurisdiction-specific compliance.
- [ ] **Licenses and reproducibility:** verify model/ONNX/native binary distribution rights, font OFLs, bundled third-party licenses, SBOM and pinned dependencies.
- [ ] **Human review and AI disclosure:** all submitted code understood and reviewed; Vencord CONTRIBUTING.md policy observed.
- [ ] **Maintainer feedback:** open a concise feature request before submitting a PR. Official inclusion is at maintainer discretion.

## Production profile

Diagnostics should be disabled or excluded from the public UI build after validation, retaining low-overhead development hooks only. No animations; no punctuation model dependency by request.
