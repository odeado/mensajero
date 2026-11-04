import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';

test('el aviso Android solo incluye otras conversaciones y se oculta al abrirlas', (t) => {
  const javaHome = process.env.JAVA_HOME || 'C:/Program Files/Android/Android Studio/jbr';
  const javac = path.join(javaHome, 'bin', process.platform === 'win32' ? 'javac.exe' : 'javac');
  const java = path.join(javaHome, 'bin', process.platform === 'win32' ? 'java.exe' : 'java');
  if (!existsSync(javac)) { t.skip('Requiere un JDK local o JAVA_HOME'); return; }
  const output = 'AndroidApp/build/banner-tests';
  mkdirSync(output, { recursive: true });
  execFileSync(javac, ['-encoding', 'UTF-8', '-d', output,
    'AndroidApp/app/src/main/java/cl/odeado/mensajero/OtherChatBanner.java', 'tests/OtherChatBannerTest.java']);
  const result = execFileSync(java, ['-Dfile.encoding=UTF-8', '-cp', output, 'cl.odeado.mensajero.OtherChatBannerTest'], { encoding: 'utf8' });
  assert.match(result, /8 casos/);
});
