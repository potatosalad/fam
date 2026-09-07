import { readFile } from 'node:fs/promises';

const providers = {
  familysearch: () => import('./familysearch/cli.js'),
  ancestry: () => import('./ancestry/cli.js'),
  myheritage: () => import('./myheritage/cli.js'),
  findmypast: () => import('./findmypast/cli.js'),
  findagrave: () => import('./findagrave/cli.js'),
};

const help = `Usage: fam PROVIDER COMMAND [arguments] [options]

Providers: familysearch, ancestry, myheritage, findmypast, findagrave

Examples:
  fam familysearch whoami
  fam ancestry trees
  fam myheritage --help
  fam findmypast search --first-name Ada --last-name Lovelace
  fam findagrave --anonymous search --first-name Abraham --last-name Lincoln

Run fam PROVIDER --help for commands and fam --version for the version.
Set FAM_CONFIG_DIR to an absolute path for a separate configuration profile.
Credential overrides: FAM_CREDENTIALS_COMMAND or config.json credentialsCommand
(a JSON array of executable and arguments; fam appends the provider name).
`;

async function main() {
  let [provider, ...args] = process.argv.slice(2);
  if (!provider || ['--help', '-h'].includes(provider) || provider === 'help' && !args.length) {
    console.log(help); return;
  }
  if (provider === '--version' || provider === '-v') {
    if (args.length) throw new Error('Use fam --version without other arguments.');
    const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string };
    console.log(pkg.version); return;
  }
  if (provider === 'help') {
    if (args.length !== 1) throw new Error('Use fam help PROVIDER.');
    provider = args[0]; args = ['--help'];
  }
  if (!Object.hasOwn(providers, provider)) throw new Error('Unknown provider. Run fam --help.');
  // Provider parsers retain their existing argument order and stdin/stdout behavior.
  process.argv.splice(2, process.argv.length - 2, ...args);
  await providers[provider as keyof typeof providers]();
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : 'fam command failed.');
  process.exitCode = 1;
});
