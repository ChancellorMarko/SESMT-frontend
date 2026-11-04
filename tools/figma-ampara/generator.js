/* Ampara SESMT · local Figma Design generator. Standard Plugin API only. */
async function generateAmpara(figma, bundle, mode, onProgress) {
  const phase = bundle.phase || 'foundations';
  const modes = mode === 'both' ? ['desktop', 'mobile'] : [mode];
  if (!modes.every(value => value === 'desktop' || value === 'mobile')) throw new Error('Escolha desktop, mobile ou ambos.');
  if (figma.editorType !== 'figma') throw new Error('Abra um arquivo Figma Design para gerar as telas.');
  if (!bundle || !Array.isArray(bundle.screens) || !bundle.screens.length) throw new Error('O pacote não contém telas válidas.');
  if (new Set(bundle.screens.map(screen => screen.id)).size !== bundle.screens.length) throw new Error('O pacote contém identificadores de tela repetidos.');
  if (!bundle.assets || !bundle.assets.logo || !bundle.assets.icon) throw new Error('A logo e o ícone originais da Ampara são obrigatórios.');

  const existingPages = figma.root.children;
  if (phase === 'foundations' && (existingPages.length !== 1 || existingPages[0].children.some(node => node.id !== bundle.captureNodeId))) throw new Error('Use um arquivo novo; somente a captura de referência indicada pode existir. Nenhum conteúdo será substituído.');
  const [oldVariables, oldTexts, oldPaints, oldEffects, availableFonts] = await Promise.all([
    figma.variables.getLocalVariableCollectionsAsync(), figma.getLocalTextStylesAsync(),
    figma.getLocalPaintStylesAsync(), figma.getLocalEffectStylesAsync(), figma.listAvailableFontsAsync(),
  ]);
  if (phase === 'foundations' && (oldVariables.length || oldTexts.length || oldPaints.length || oldEffects.length)) throw new Error('Este arquivo já contém estilos ou variáveis. Use um arquivo Figma Design novo.');
  const interFonts = availableFonts.map(font => font.fontName).filter(font => font.family === 'Inter');
  const normalize = value => value.toLowerCase().replace(/[^a-z]/g, '');
  const pick = names => interFonts.find(font => names.includes(normalize(font.style)));
  const regular = pick(['regular', 'normal']);
  const semi = pick(['semibold', 'demibold']);
  const medium = pick(['medium']) || semi;
  const bold = pick(['bold']) || semi;
  if (!regular || !medium || !semi) throw new Error('A fonte Inter Regular e um estilo Medium/Semi Bold precisam estar disponíveis no Figma. Nenhuma fonte substituta foi aplicada.');
  const fonts = [regular, medium, semi, bold].filter((font, index, array) => array.findIndex(item => item.style === font.style) === index);
  await Promise.all(fonts.map(font => figma.loadFontAsync(font)));

  const ids = [], variableIds = [], components = {}, links = [], screensByMode = {};
  const summary = { pages: 0, frames: 0, components: 0, variables: 0, texts: 0, links: 0, unresolvedLinks: [], createdNodeIds: ids, fonts: fonts.map(font => ({ family: font.family, style: font.style })) };
  const progress = async (text, completed, total) => { if (onProgress) await onProgress({ text, completed, total }); };
  const track = node => { ids.push(node.id); if (node.type === 'TEXT') summary.texts += 1; return node; };
  const rgb = hex => ({ r: parseInt(hex.slice(1, 3), 16) / 255, g: parseInt(hex.slice(3, 5), 16) / 255, b: parseInt(hex.slice(5, 7), 16) / 255 });
  const palette = {
    navy: '#183b68', blue: '#4679ee', deep: '#102747', background: '#f3f2ed', surface: '#fffefa',
    white: '#ffffff', text: '#24364f', muted: '#526e91', subtle: '#5a6f89', border: '#dfe6f0', soft: '#edf3fc',
    success: '#087a58', successBg: '#e9f9f2', warning: '#935e0c', warningBg: '#fff6e5',
    danger: '#bf3c59', dangerBg: '#fff0f3', info: '#365ac0', infoBg: '#edf2ff', heroMuted: '#c2d2e6', heroBorder: '#284f7d',
  };
  const colors = {}, space = {}, radius = {}, styles = {};
  let panelEffect;
  if (phase === 'foundations') {
  const primitives = figma.variables.createVariableCollection('Ampara · Primitivos');
  const semantics = figma.variables.createVariableCollection('Ampara · Semânticos');
  const dimensions = figma.variables.createVariableCollection('Ampara · Dimensões');
  for (const collection of [primitives, semantics, dimensions]) collection.renameMode(collection.modes[0].modeId, 'Claro');
  const css = { navy: '--brand-navy', blue: '--brand-blue', text: '--text', border: '--border', success: '--success', successBg: '--success-soft', warning: '--warning', warningBg: '--warning-soft', danger: '--danger', dangerBg: '--danger-soft' };
  for (const [name, hex] of Object.entries(palette)) {
    const primitive = figma.variables.createVariable(`Cor/${name}`, primitives, 'COLOR');
    primitive.scopes = []; primitive.setValueForMode(primitives.modes[0].modeId, rgb(hex)); variableIds.push(primitive.id);
    const semantic = figma.variables.createVariable(`Cor/${name}`, semantics, 'COLOR');
    semantic.scopes = ['FRAME_FILL', 'SHAPE_FILL', 'TEXT_FILL', 'STROKE_COLOR'];
    semantic.setValueForMode(semantics.modes[0].modeId, { type: 'VARIABLE_ALIAS', id: primitive.id });
    if (css[name]) semantic.setVariableCodeSyntax('WEB', `var(${css[name]})`);
    colors[name] = semantic; variableIds.push(semantic.id);
  }
  for (const value of [4, 6, 8, 10, 12, 14, 16, 20, 22, 24, 28, 30, 32, 40]) {
    const variable = figma.variables.createVariable(`Espaço/${value}`, dimensions, 'FLOAT');
    variable.scopes = ['GAP']; variable.setValueForMode(dimensions.modes[0].modeId, value); space[value] = variable; variableIds.push(variable.id);
  }
  for (const value of [8, 12, 16, 20, 24, 28]) {
    const variable = figma.variables.createVariable(`Raio/${value}`, dimensions, 'FLOAT');
    variable.scopes = ['CORNER_RADIUS']; variable.setValueForMode(dimensions.modes[0].modeId, value); radius[value] = variable; variableIds.push(variable.id);
  }
  const typeScale = {
    hero: [40, medium, 47], h1: [30, medium, 38], h2: [20, semi, 28], h3: [15, semi, 23],
    body: [13, regular, 21], strong: [13, semi, 21], small: [12, regular, 20], caption: [11, medium, 17], eyebrow: [10, semi, 16], metric: [30, semi, 38],
  };
  for (const [name, spec] of Object.entries(typeScale)) {
    const style = figma.createTextStyle(); style.name = `Ampara/${name}`; style.fontName = spec[1]; style.fontSize = spec[0]; style.lineHeight = { unit: 'PIXELS', value: spec[2] }; styles[name] = style;
  }
  panelEffect = figma.createEffectStyle();
  panelEffect.name = 'Ampara/Painel suave'; panelEffect.effects = [{ type: 'DROP_SHADOW', color: { ...rgb(palette.navy), a: 0.07 }, offset: { x: 0, y: 9 }, radius: 26, spread: -13, visible: true, blendMode: 'NORMAL' }];
  } else {
    if (!bundle.state || !bundle.pageId || !['desktop', 'mobile'].includes(bundle.viewport)) throw new Error('A fase de telas exige state, pageId e viewport.');
    for (const [key, id] of Object.entries(bundle.state.colors)) colors[key] = await figma.variables.getVariableByIdAsync(id);
    for (const [key, id] of Object.entries(bundle.state.space)) space[key] = await figma.variables.getVariableByIdAsync(id);
    for (const [key, id] of Object.entries(bundle.state.radius)) radius[key] = await figma.variables.getVariableByIdAsync(id);
    for (const [key, id] of Object.entries(bundle.state.styles)) styles[key] = await figma.getStyleByIdAsync(id);
    panelEffect = await figma.getStyleByIdAsync(bundle.state.effect);
    for (const [key, id] of Object.entries(bundle.state.components)) components[key] = await figma.getNodeByIdAsync(id);
  }
  const typeScale = {
    hero: [40, medium, 47], h1: [30, medium, 38], h2: [20, semi, 28], h3: [15, semi, 23],
    body: [13, regular, 21], strong: [13, semi, 21], small: [12, regular, 20], caption: [11, medium, 17], eyebrow: [10, semi, 16], metric: [30, semi, 38],
  };
  function paint(name) { return figma.variables.setBoundVariableForPaint({ type: 'SOLID', color: rgb(palette[name] || palette.text) }, 'color', colors[name] || colors.text); }
  function fill(node, name) { node.fills = name ? [paint(name)] : []; }
  function stroke(node, name) { node.strokes = name ? [paint(name)] : []; if (name) node.strokeWeight = 1; }
  function bind(node, property, value, variables) { if (variables[value]) node.setBoundVariable(property, variables[value]); else node[property] = value; }
  function pad(node, value) { for (const property of ['paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft']) bind(node, property, value, space); }
  function frame(name, direction, width, padding = 0, gap = 0, background, round = 0) {
    const node = track(figma.createFrame()); node.name = name; node.layoutMode = direction || 'VERTICAL';
    node.resize(Math.max(1, width), 1); node.primaryAxisSizingMode = node.layoutMode === 'HORIZONTAL' ? 'FIXED' : 'AUTO'; node.counterAxisSizingMode = node.layoutMode === 'HORIZONTAL' ? 'AUTO' : 'FIXED';
    node.clipsContent = false; pad(node, padding); bind(node, 'itemSpacing', gap, space); fill(node, background);
    if (round) bind(node, 'cornerRadius', round, radius);
    return node;
  }
  function append(parent, child, stretch = false) { parent.appendChild(child); if (stretch) child.layoutSizingHorizontal = 'FILL'; return child; }
  function text(content, role = 'body', width = 300, color = 'text', name) {
    const node = track(figma.createText()); node.name = name || String(content).slice(0, 64) || 'Texto';
    node.fontName = typeScale[role][1]; node.textStyleId = styles[role].id; node.characters = String(content == null ? '' : content);
    node.textAutoResize = 'HEIGHT'; node.resize(Math.max(1, width), typeScale[role][2]); fill(node, color); return node;
  }
  function line(width) { const node = track(figma.createRectangle()); node.name = 'Divisor'; node.resize(Math.max(1, width), 1); fill(node, 'border'); return node; }
  function panel(name, width, gap = 18, padding = 24) { const node = frame(name, 'VERTICAL', width, padding, gap, 'surface', 24); stroke(node, 'border'); node.effectStyleId = panelEffect.id; return node; }
  function base64Bytes(value) {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    const source = String(value).replace(/^data:[^,]*,/, '').replace(/\s/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(source)) throw new Error('Um asset de marca contém base64 inválido.');
    const bytes = []; let buffer = 0, bits = 0;
    for (const character of source) { if (character === '=') break; buffer = (buffer << 6) | alphabet.indexOf(character); bits += 6; if (bits >= 8) { bits -= 8; bytes.push((buffer >> bits) & 255); } }
    return new Uint8Array(bytes);
  }
  const logoHash = bundle.assets.logo.imageHash || figma.createImage(base64Bytes(bundle.assets.logo.base64)).hash;
  const iconHash = bundle.assets.icon.imageHash || figma.createImage(base64Bytes(bundle.assets.icon.base64)).hash;
  function image(name, asset, hash, width) { const node = track(figma.createRectangle()); node.name = name; node.resize(width, width * asset.height / asset.width); node.fills = [{ type: 'IMAGE', imageHash: hash, scaleMode: 'FIT' }]; return node; }
  function link(node, destination, viewport) { if (destination) links.push({ node, destination, viewport }); return node; }
  function grid(parent, items, columns, width, gap, render) {
    const cellWidth = (width - gap * (columns - 1)) / columns;
    for (let offset = 0; offset < items.length; offset += columns) {
      const row = append(parent, frame('Linha', 'HORIZONTAL', width, 0, gap));
      for (const item of items.slice(offset, offset + columns)) append(row, render(item, cellWidth));
    }
  }
  const properties = phase === 'foundations' ? {} : bundle.state.properties;
  function component(name, direction, width, padding, gap, background, round) {
    const node = track(figma.createComponent()); node.name = name; node.layoutMode = direction;
    node.resize(width, 44); node.primaryAxisSizingMode = direction === 'HORIZONTAL' ? 'FIXED' : 'AUTO'; node.counterAxisSizingMode = direction === 'HORIZONTAL' ? 'AUTO' : 'FIXED';
    pad(node, padding); bind(node, 'itemSpacing', gap, space); fill(node, background); if (round) bind(node, 'cornerRadius', round, radius); summary.components += 1; return node;
  }
  function instance(key, width) {
    if (!components[key]) throw new Error(`Componente ausente: ${key}`);
    const node = track(components[key].createInstance());
    if (width) { node.resize(width, node.height); node.primaryAxisSizingMode = node.layoutMode === 'HORIZONTAL' ? 'FIXED' : 'AUTO'; node.counterAxisSizingMode = node.layoutMode === 'HORIZONTAL' ? 'AUTO' : 'FIXED'; }
    return node;
  }
  function setLabel(node, property, value) { node.setProperties({ [property]: String(value == null ? '' : value) }); }
  function resizeText(node, name, width) { const label = node.findOne(child => child.type === 'TEXT' && child.name === name); if (label) { label.textAutoResize = 'HEIGHT'; label.resize(Math.max(1, width), 21); } }
  function button(action, width, viewport, state = 'default') {
    const variant = action.variant || 'primary'; const key = `button/${variant}/${state}`;
    const desired = Math.min(width, Math.max(112, String(action.label).length * 7.2 + 32));
    const node = instance(key, desired); setLabel(node, properties[key].label, action.label); resizeText(node, 'Label', desired - 32); node.minHeight = 44;
    link(node, action.to, viewport); return node;
  }
  function badge(label, tone = 'neutral', maxWidth = 200) {
    const key = `badge/${['success', 'warning', 'danger', 'info'].includes(tone) ? tone : 'neutral'}`;
    const width = Math.min(maxWidth, Math.max(44, String(label).length * 6.5 + 20));
    const node = instance(key, width); setLabel(node, properties[key].label, label); resizeText(node, 'Label', width - 20); return node;
  }
  function field(data, width) {
    const type = ['search', 'select', 'textarea', 'file', 'date'].includes(data.type) ? data.type : 'text'; const key = `field/${type}`;
    const node = instance(key, width); setLabel(node, properties[key].label, `${data.label}${data.required ? ' *' : ''}`); setLabel(node, properties[key].value, data.value || 'Não informado');
    resizeText(node, 'Label', width); resizeText(node, 'Value', width - 30); return node;
  }
  function icon(name, size = 20) { const master = components[`icon/${name}`] || components['icon/FileText']; if (!master) return null; const node = track(master.createInstance()); node.resize(size, size); return node; }
  function actions(parent, values, width, viewport) {
    if (!values || !values.length) return;
    const group = append(parent, frame('Ações', 'VERTICAL', width, 0, 8)); let row = null, occupied = 0;
    for (const value of values) {
      const child = button(value, width, viewport);
      if (!row || viewport === 'mobile' || occupied + child.width > width) { row = append(group, frame('Linha de ações', 'HORIZONTAL', width, 0, 8)); occupied = 0; }
      append(row, child); occupied += child.width + 8;
    }
  }
  if (phase === 'foundations') {
    const foundations = existingPages[0]; foundations.name = '00 · Sistema Ampara';
    await figma.setCurrentPageAsync(foundations);
    const masters = append(foundations, frame('Componentes · Originais', 'VERTICAL', 1700, 24, 30, 'white', 24)); masters.x = 3400; masters.y = 160;
    for (const [name, svg] of Object.entries(bundle.assets.icons || {})) {
      const master = component(`Icon/${name}`, 'HORIZONTAL', 24, 0, 0, null, 0); master.counterAxisAlignItems = 'CENTER'; master.primaryAxisAlignItems = 'CENTER'; master.resize(24, 24); master.primaryAxisSizingMode = 'FIXED'; master.counterAxisSizingMode = 'FIXED';
      const vector = track(figma.createNodeFromSvg(svg.replace(/currentColor/g, palette.blue))); vector.name = name; vector.resize(20, 20); append(master, vector); append(masters, master); components[`icon/${name}`] = master;
    }
    for (const variant of ['primary', 'secondary', 'danger', 'ghost']) for (const state of ['default', 'hover', 'disabled', 'focus']) {
      const key = `button/${variant}/${state}`; const background = variant === 'primary' ? state === 'hover' ? 'deep' : 'navy' : state === 'hover' ? variant === 'danger' ? 'dangerBg' : 'soft' : variant === 'ghost' ? null : 'surface';
      const node = component(`Button/${variant}/${state}`, 'HORIZONTAL', 184, 12, 8, background, 12); node.paddingLeft = 16; node.paddingRight = 16; node.minHeight = 44; node.counterAxisAlignItems = 'CENTER'; node.primaryAxisAlignItems = 'CENTER';
      stroke(node, state === 'focus' ? 'blue' : variant === 'danger' ? 'danger' : variant === 'secondary' ? 'border' : null); if (state === 'focus') node.strokeWeight = 3; if (state === 'disabled') node.opacity = .5;
      const label = append(node, text('Continuar', 'strong', 152, variant === 'primary' ? 'surface' : variant === 'danger' ? 'danger' : 'navy', 'Label'), true);
      const property = node.addComponentProperty('Label', 'TEXT', 'Continuar'); label.componentPropertyReferences = { characters: property }; components[key] = node; properties[key] = { label: property }; append(masters, node);
    }
    for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) {
      const key = `badge/${tone}`; const node = component(`Badge/${tone}`, 'HORIZONTAL', 120, 4, 0, tone === 'neutral' ? 'soft' : `${tone}Bg`, 8); node.paddingLeft = 10; node.paddingRight = 10; node.minHeight = 26; node.counterAxisAlignItems = 'CENTER';
      const label = append(node, text('Situação', 'caption', 100, tone === 'neutral' ? 'muted' : tone, 'Label'), true); const property = node.addComponentProperty('Label', 'TEXT', 'Situação'); label.componentPropertyReferences = { characters: property }; components[key] = node; properties[key] = { label: property }; append(masters, node);
    }
    for (const type of ['text', 'search', 'select', 'date', 'textarea', 'file']) {
      const key = `field/${type}`; const node = component(`Field/${type}`, 'VERTICAL', 320, 0, 8, null, 0);
      const label = append(node, text('Campo', 'caption', 320, 'muted', 'Label'), true); const control = append(node, frame('Controle', 'VERTICAL', 320, 12, 0, 'white', 12), true); control.minHeight = type === 'textarea' ? 100 : 44; stroke(control, 'border');
      const value = append(control, text(type === 'select' ? 'Selecionar opção' : 'Valor do campo', 'body', 296, 'text', 'Value'), true);
      const labelProperty = node.addComponentProperty('Label', 'TEXT', 'Campo'), valueProperty = node.addComponentProperty('Value', 'TEXT', 'Valor do campo'); label.componentPropertyReferences = { characters: labelProperty }; value.componentPropertyReferences = { characters: valueProperty };
      components[key] = node; properties[key] = { label: labelProperty, value: valueProperty }; append(masters, node);
    }
    for (const [name, svg] of Object.entries(bundle.assets.heroes || {})) {
      const node = component(`Ilustração/${name}`, 'VERTICAL', 280, 0, 0, null, 0); const art = track(figma.createNodeFromSvg(svg)); art.name = `SVG original/${name}`; art.resize(280, 280 * art.height / art.width); append(node, art); components[`hero/${name}`] = node; append(masters, node);
    }
    for (const [key, master] of Object.entries(components)) {
      if (!/^(button|badge|field)\//.test(key)) continue;
      for (const child of master.findAll()) {
        if (child.type === 'TEXT') {
          child.textAutoResize = 'HEIGHT'; child.layoutSizingHorizontal = 'FILL';
          if (!key.startsWith('field/')) child.textAlignHorizontal = 'CENTER';
        } else if (key.startsWith('field/') && child.type === 'FRAME' && child.name === 'Controle') child.layoutSizingHorizontal = 'FILL';
      }
    }
    const showcase = append(foundations, panel('Sistema Ampara · Identidade e componentes', 1320, 28, 40)); showcase.x = 1760; showcase.y = 160;
    append(showcase, image('Logo original Ampara', bundle.assets.logo, logoHash, 180));
    append(showcase, text('Ampara SESMT', 'hero', 1200, 'navy')); append(showcase, text('Produto e componentes · Referência editável do frontend', 'h2', 1200, 'muted'));
    append(showcase, text('Recriação a partir do código e dos estados demonstrativos selecionados. Textos, vetores, componentes e agrupamentos permanecem editáveis. O protótipo não executa operações reais.', 'body', 1200, 'muted'));
    grid(showcase, Object.keys(palette), 4, 1240, 16, (name, width) => { const swatch = panel(`Cor/${name}`, width, 8, 16); const sample = append(swatch, frame('Amostra', 'VERTICAL', width - 32, 20, 0, name, 12)); sample.minHeight = 44; append(swatch, text(name, 'strong', width - 32)); append(swatch, text(palette[name], 'caption', width - 32, 'muted')); return swatch; });
    append(showcase, text('Tipografia · Inter', 'h2', 1200, 'navy'));
    for (const role of ['hero', 'h1', 'h2', 'h3', 'body', 'small', 'caption']) append(showcase, text(`${role} · Segurança que acompanha você.`, role, 1200, 'navy'));
    append(showcase, text('Botões · variantes e estados', 'h2', 1200, 'navy'));
    for (const variant of ['primary', 'secondary', 'danger', 'ghost']) { const row = append(showcase, frame(variant, 'HORIZONTAL', 1240, 0, 16)); for (const state of ['default', 'hover', 'disabled', 'focus']) append(row, button({ label: `${variant} · ${state}`, variant }, 260, 'desktop', state)); }
    const badgeRow = append(showcase, frame('Situações', 'HORIZONTAL', 1240, 0, 16)); for (const tone of ['success', 'warning', 'danger', 'info', 'neutral']) append(badgeRow, badge(tone, tone));
    grid(showcase, ['text', 'search', 'select', 'date', 'textarea', 'file'], 3, 1240, 20, (type, width) => field({ label: `Campo ${type}`, value: 'Conteúdo editável', type }, width));
    const desktop = figma.createPage(); desktop.name = '01 · Desktop'; const mobile = figma.createPage(); mobile.name = '02 · Mobile';
    const state = { pages: { foundations: foundations.id, desktop: desktop.id, mobile: mobile.id }, colors: {}, space: {}, radius: {}, styles: {}, effect: panelEffect.id, components: {}, properties, fonts: summary.fonts, logoHash, iconHash };
    for (const [key, value] of Object.entries(colors)) state.colors[key] = value.id; for (const [key, value] of Object.entries(space)) state.space[key] = value.id; for (const [key, value] of Object.entries(radius)) state.radius[key] = value.id; for (const [key, value] of Object.entries(styles)) state.styles[key] = value.id; for (const [key, value] of Object.entries(components)) state.components[key] = value.id;
    for (const root of [masters, showcase]) for (const node of root.findAll(() => true)) if (!ids.includes(node.id)) ids.push(node.id);
    summary.pages = 3; summary.variables = variableIds.length; summary.state = state; summary.frameIds = { showcase: showcase.id, masters: masters.id }; summary.createdNodeIds.push(desktop.id, mobile.id);
    return summary;
  }
  if (typeof renderAmparaScreens !== 'function') throw new Error('Carregue renderer.js antes da fase de telas.');
  return await renderAmparaScreens(figma, { state: bundle.state, screens: bundle.screens, viewport: bundle.viewport, pageId: bundle.pageId, assets: bundle.assets });
}
