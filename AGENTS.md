# Maintenance

- GPG-sign every commit with `git commit -S`. Verify signatures before pushing.
- This is the portable public repository. Keep machine-specific integrations and private deployment instructions in the separate internal repository.
- Use Node 22.16+ and npm. Run `npm ci`, then `npm run check` before submitting changes. Tests use disposable config directories and synthetic data.
- The only executable is `bin/fam.mjs`, dispatched by `src/cli.ts` to each provider's `src/<provider>/cli.ts`. Keep credential setup in `src/shared/credentials.ts` and persistence in `src/shared/storage.ts`; subprocess lookup requires an explicit user-configured helper, with no host-specific defaults.
- Do not hand-edit `src/**/generated/`. Edit the checked-in contracts/selection under `docs/`, then run `npm run generate` and `npm run generate:catalogs`. APK extraction is optional research work.
- Preserve origin restrictions, token redaction, private atomic storage, exact large integers, and bounded auth retries. Add focused regression tests when changing those behaviors.
- Keep CLI help and README setup examples in sync. Check `npm pack --dry-run` when changing packaging; all commands must work outside the checkout.
- Never commit passwords, sessions, HARs, genealogy exports, downloaded artifacts, or live account reports. Live verification is opt-in and must not run in CI.
