# Model attribution

The speech model is **NowCaption speech model v4**, NowCaption's (Techlm77) fine-tune of NVIDIA's
`stt_en_fastconformer_hybrid_large_streaming_multi` (transducer branch, 80 ms lookahead), exported to int8 ONNX for
sherpa-onnx.

- Original model: https://huggingface.co/nvidia/stt_en_fastconformer_hybrid_large_streaming_multi, by the NVIDIA NeMo team.
- Licence: **Creative Commons Attribution 4.0 International (CC BY 4.0)**, https://creativecommons.org/licenses/by/4.0/
- Release: https://github.com/Techlm77/NowCaption/releases/tag/models-v4
  (`nowcaption-fastconformer-en-80ms-cc-by-v4.tar.bz2`, SHA-256
  `caad3a84b9547a4ec4143b668cd1d17acf769ada00fa964d80781c124d1598ef`).
- Changes: continued training from NowCaption's v3 (itself continued from v2) on CC0 and CC BY speech, with
  transcripts partly written by NVIDIA's `parakeet-tdt-0.6b-v2` (https://huggingface.co/nvidia/parakeet-tdt-0.6b-v2,
  CC BY 4.0; none of its weights are in the model), then a faster ONNX export and int8 quantization.
- Training data and their licences (NVIDIA Granary/YODAS, Common Voice, AMI, LibriSpeech, VoxPopuli; MUSAN and
  RIRS_NOISES for augmentation) are listed in the `README.md` inside the model archive. Keep that file with the
  model when redistributing it.

The installer downloads the release archive and checks its SHA-256; the model isn't included in this folder.
The fonts' SIL Open Font License files are downloaded with the fonts and copied into the build (`font-licenses/`).
