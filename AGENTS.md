# Maintenance

- GPG-sign every commit with `git commit -S`. Verify signatures before pushing.
- This is the single maintained fam runtime. Keep machine-specific helpers and private research in the separate integration repository; do not create another CLI implementation.
- Use Node 22.16+ and npm. Run `npm ci`, then `npm run check` before submitting changes. Tests use disposable config directories and synthetic data.
- The only executable is `bin/fam.mjs`, dispatched by `src/cli.ts` to each provider's `src/<provider>/cli.ts`. Keep credential setup in `src/shared/credentials.ts` and persistence in `src/shared/storage.ts`; subprocess lookup requires an explicit user-configured helper, with no host-specific defaults.
- Keep provider code in `src/<provider>/` and provider documentation/data in `docs/<provider>/`, including FamilySearch. Root source contains only dispatch/help and the library re-export; root docs contain shared setup and development guidance.
- Do not hand-edit `src/**/generated/`. Edit checked-in contracts under `docs/<provider>/` and FamilySearch selection under `docs/familysearch/`, then run `npm run generate` and `npm run generate:catalogs`. APK extraction is optional research work.
- Document only `fam PROVIDER.OBJECT ACTION --flags` and `npm run fam -- PROVIDER.OBJECT ACTION --flags`. Old names belong only in explicit migration/compatibility guidance, not current setup or usage examples.
- Preserve origin restrictions, token redaction in provider output, private atomic storage, exact large integers, and bounded auth retries. Command history intentionally stores verbatim arguments, consumed inputs, and diagnostic text without redaction for failure reproduction; do not reintroduce history redaction. Add focused regression tests when changing those behaviors.
- Keep CLI help and README setup examples in sync. Check `npm pack --dry-run` when changing packaging; all commands must work outside the checkout.
- List FamilySearch first, then other providers alphabetically.
- Use readable text by default, including when piped; `--json` selects structured output and errors. Keep bare `fam`, `fam --help`, and `fam --completions bash|zsh` useful to humans.
- Never commit passwords, sessions, HARs, genealogy exports, downloaded artifacts, or live account reports. Live verification is opt-in and must not run in CI.
