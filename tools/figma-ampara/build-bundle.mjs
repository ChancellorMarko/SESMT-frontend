import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import vm from 'node:vm';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import * as lucide from 'lucide-react';
import { transformWithOxc } from 'vite';

// Reproducible source assets for the Ampara Figma file; this does not modify the app.
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const json = name => readFile(resolve(here, name), 'utf8').then(JSON.parse);
const screens = [...await json('screens-operation.json'), ...await json('screens-management.json')];
const ids = new Set(screens.map(screen => screen.id));
if (screens.length !== 30 || ids.size !== screens.length) throw new Error('Expected 30 distinct screen IDs.');
const sectionTypes = new Set(['stats', 'table', 'cards', 'details', 'timeline', 'notice', 'form', 'empty']);
const links = [];
const requestedIcons = new Set([
  'LayoutDashboard', 'FolderOpen', 'Users', 'Building2', 'Bell', 'History', 'SlidersHorizontal',
  'LogOut', 'Menu', 'ArrowUpRight', 'CircleHelp', 'CalendarDays', 'CalendarClock', 'ClipboardCheck',
  'UsersRound', 'UserCheck', 'FileSearch', 'Search', 'Command', 'ShieldCheck', 'HeartPulse', 'HardHat',
  'ChartNoAxesCombined', 'Sparkles', 'GraduationCap', 'ChevronDown', 'ChevronRight', 'ChevronLeft',
  'ArrowLeft', 'ArrowRight', 'Plus', 'X', 'Check', 'CheckCircle2', 'CircleAlert', 'TriangleAlert',
  'Download', 'Upload', 'FileText', 'MoreHorizontal', 'Filter', 'LockKeyhole', 'Eye', 'Mail',
]);
function inspect(value, key = '') {
  if (Array.isArray(value)) return value.forEach(item => inspect(item));
  if (value && typeof value === 'object') return Object.entries(value).forEach(([k, item]) => inspect(item, k));
  if (key === 'to' && value) links.push(value);
  if (key === 'icon' && value) requestedIcons.add(value);
}
for (const screen of screens) {
  if (!screen.title || !Array.isArray(screen.sections)) throw new Error(`Invalid screen ${screen.id}`);
  for (const section of screen.sections) {
    if (!sectionTypes.has(section.type)) throw new Error(`Unknown section type ${section.type}`);
    if (section.type === 'table' && (section.columns.length > 6 || section.rows.length > 6)) throw new Error(`Oversized table in ${screen.id}`);
  }
  inspect(screen);
}
const unresolved = [...new Set(links.filter(id => !ids.has(id)))];
if (unresolved.length) throw new Error(`Unresolved links: ${unresolved.join(', ')}`);
const icons = {};
for (const name of [...requestedIcons].sort()) {
  if (!lucide[name]) throw new Error(`Unknown Lucide icon ${name}`);
  icons[name] = renderToStaticMarkup(React.createElement(lucide[name], { size: 24, color: '#526e91', strokeWidth: 1.7 }));
}
async function raster(path) {
  const data = await readFile(resolve(root, path));
  if (data.toString('hex', 0, 8) !== '89504e470d0a1a0a') throw new Error(`Expected PNG: ${path}`);
  const imageHash = path.endsWith('logo-principal.png') ? 'c37a3be6049f012ded63e4c41618d5108fedbb43' : '81be752e01306783d09421a925a1030c3b4657f6';
  return { imageHash, width: data.readUInt32BE(16), height: data.readUInt32BE(20), source: path };
}

// Render the exact artwork component from the frontend, dropping animation props only.
const heroPath = 'src/features/dashboard/DashboardHero.tsx';
const heroModule = await readFile(resolve(root, heroPath), 'utf8');
const heroSource = heroModule.slice(heroModule.indexOf('function HeroArtwork('), heroModule.indexOf('export function DashboardHero('));
const compiled = await transformWithOxc(heroSource, 'HeroArtwork.tsx', { jsx: { runtime: 'classic' } });
const animationProps = new Set(['initial', 'animate', 'transition', 'exit', 'whileHover', 'whileTap', 'variants', 'layout', 'layoutId']);
const motion = new Proxy({}, { get: (_, tag) => props => React.createElement(tag, Object.fromEntries(Object.entries(props).filter(([key]) => !animationProps.has(key)))) });
const sandbox = { exports: {}, React, useId: React.useId, useAppReducedMotion: () => true, motion, styles: { illustration: 'illustration' } };
vm.runInNewContext(`${compiled.code}\nexports.HeroArtwork = HeroArtwork;`, sandbox, { filename: heroPath });
const heroes = {};
for (const variant of ['overview', 'inspecoes', 'saude', 'epis']) {
  let svg = renderToStaticMarkup(React.createElement(sandbox.exports.HeroArtwork, { variant }));
  svg = svg.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" width="340" height="280" ');
  svg = svg.replace(/ id="([^"]+)"/g, (_, id) => ` id="${id.replace(/[^a-zA-Z0-9_-]/g, '_')}"`)
    .replace(/url\(#([^\)]+)\)/g, (_, id) => `url(#${id.replace(/[^a-zA-Z0-9_-]/g, '_')})`);
  if (!svg.includes('viewBox="0 0 340 280"') || svg.includes('animate=')) throw new Error(`Invalid artwork ${variant}`);
  heroes[variant] = svg;
}
const bundle = {
  generatedAt: '2026-10-21',
  provenance: { product: 'Ampara SESMT', data: 'Cenário demonstrativo do frontend; não constitui integração com API ou autorização operacional.', assets: 'Logo PNG original e vetores de DashboardHero.tsx/lucide-react do projeto.' },
  screens,
  assets: {
    logo: await raster('public/brand/ampara/logo-principal.png'),
    icon: await raster('public/brand/ampara/icon.png'),
    icons, heroes,
  },
};
await writeFile(resolve(here, 'bundle.json'), `${JSON.stringify(bundle)}\n`, 'utf8');
console.log(JSON.stringify({ screens: screens.length, sections: screens.reduce((sum, screen) => sum + screen.sections.length, 0), links: links.length, unresolved, icons: Object.keys(icons).length, heroes: Object.keys(heroes), logo: [bundle.assets.logo.width, bundle.assets.logo.height], icon: [bundle.assets.icon.width, bundle.assets.icon.height] }));
