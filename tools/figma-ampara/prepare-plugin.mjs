import { readFile, realpath, stat, writeFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const destination = fileURLToPath(new URL('./manifest.json', import.meta.url));
const templatePath = fileURLToPath(new URL('./manifest.template.json', import.meta.url));

function canonical(path) {
  return process.platform === 'win32' ? path.toLowerCase() : path;
}

function fail(message) {
  throw new Error(message);
}

async function prepare() {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log('Uso: node prepare-plugin.mjs "C:\\pasta-do-plugin-criado-no-Figma\\manifest.json"');
    console.log('Lê o ID atribuído pelo Figma e cria manifest.json somente nesta pasta. Não altera o manifesto de origem.');
    return;
  }
  if (args.length !== 1) {
    fail('Informe o caminho do manifest.json de um plugin criado por você em New plugin no Figma. Use --help para ver um exemplo.');
  }

  const sourcePath = await realpath(resolve(args[0]));
  if (canonical(sourcePath) === canonical(resolve(destination))) {
    fail('A origem não pode ser o manifest.json deste pacote. Escolha o manifesto original criado pelo Figma.');
  }
  if (basename(sourcePath).toLowerCase() !== 'manifest.json') {
    fail('Escolha o arquivo manifest.json original gerado pelo Figma, não um modelo ou outro arquivo.');
  }
  const sourceInfo = await stat(sourcePath);
  if (!sourceInfo.isFile() || sourceInfo.size > 1_000_000) {
    fail('O manifesto de origem deve ser um arquivo JSON de até 1 MB.');
  }

  let source;
  try {
    source = JSON.parse((await readFile(sourcePath, 'utf8')).replace(/^\uFEFF/, ''));
  } catch {
    fail('O manifesto de origem não contém um JSON válido.');
  }
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    fail('O manifesto de origem deve conter um objeto JSON.');
  }
  if (typeof source.id !== 'string' || !/^[1-9][0-9]*$/.test(source.id)) {
    fail('O manifesto precisa conter um ID numérico não vazio atribuído pelo Figma. Não use o ID de exemplo da documentação.');
  }
  if (typeof source.name !== 'string' || !source.name.trim() || source.api !== '1.0.0' || !Array.isArray(source.editorType) || !source.editorType.includes('figma')) {
    fail('O manifesto precisa ser de um plugin Figma Design criado por você, com nome, api 1.0.0 e editorType contendo figma.');
  }

  const template = JSON.parse(await readFile(templatePath, 'utf8'));
  const manifest = { ...template, id: source.id };
  const serialized = `${JSON.stringify(manifest, null, 2)}\n`;

  try {
    await writeFile(destination, serialized, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    const existing = await readFile(destination, 'utf8');
    if (existing === serialized) {
      console.log('O manifest.json deste pacote já está preparado com o mesmo ID. Nenhum arquivo foi alterado.');
      return;
    }
    fail('Já existe um manifest.json diferente nesta pasta. Nenhum arquivo foi sobrescrito. Use uma nova cópia do pacote para preparar outro plugin.');
  }
  console.log(`Manifesto preparado: ${destination}`);
  console.log('Agora importe esse manifest.json no Figma desktop. O manifesto original foi preservado.');
}

prepare().catch(error => {
  console.error(`Não foi possível preparar o plugin: ${error.message}`);
  process.exitCode = 1;
});
