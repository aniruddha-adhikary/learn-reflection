import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptsDirectory, '..');
const executable = path.join(root, 'node_modules', '.bin', 'depcruise');

execFileSync(executable, ['--config', '.dependency-cruiser.cjs', 'src'], {
  cwd: root,
  stdio: 'inherit',
});

const fixture = path.join(scriptsDirectory, 'architecture-fixture');
let output = '';
try {
  output = execFileSync(
    executable,
    ['--config', '../../.dependency-cruiser.cjs', '--output-type', 'json', 'src/jvm'],
    { cwd: fixture, encoding: 'utf8' },
  );
} catch (error) {
  if (typeof error !== 'object' || error === null || !('stdout' in error)) {
    throw error;
  }
  output = String(error.stdout);
}

const report = JSON.parse(output);
if (
  !report.summary.violations.some(
    (violation) => violation.rule.name === 'jvm-is-browser-independent',
  )
) {
  throw new Error('Architecture negative fixture did not trigger the JVM dependency rule');
}

console.log('Architecture rules pass; negative fixture triggered the forbidden-dependency rule.');
