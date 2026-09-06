# Maintenance

- This is the portable public repository. Keep machine-specific integrations and private deployment instructions in the separate internal repository.
- Use Node 22.16+ and npm. Run `npm ci`, then `npm run check` before submitting changes. Tests use disposable config directories and synthetic data.
- `src/cli.ts`, `src/ancestry/cli.ts`, and `src/myheritage/cli.ts` are the three commands. Keep credential setup in `src/credentials.ts` and persistence in `src/storage.ts`; no implicit subprocesses or host-specific defaults.
- Do not hand-edit `src/**/generated/`. Edit the checked-in contracts/selection under `docs/`, then run `npm run generate` and `npm run generate:catalogs`. APK extraction is optional research work.
- Preserve origin restrictions, token redaction, private atomic storage, exact large integers, and bounded auth retries. Add focused regression tests when changing those behaviors.
- Keep CLI help and README setup examples in sync. Check `npm pack --dry-run` when changing packaging; all three commands must work outside the checkout.
- Never commit passwords, sessions, HARs, genealogy exports, downloaded artifacts, or live account reports. Live verification is opt-in and must not run in CI.
