// Read-only structural checks. Caller supplies pageId and switches page once.
async function auditAmparaPage(figma, pageId) {
  const page = await figma.getNodeByIdAsync(pageId);
  if (!page || page.type !== 'PAGE') throw new Error('Página não encontrada.');
  await figma.setCurrentPageAsync(page);
  await Promise.all(['Regular', 'Medium', 'Semi Bold', 'Bold'].map(style => figma.loadFontAsync({ family: 'Inter', style })));
  const all = page.findAll();
  const texts = all.filter(node => node.type === 'TEXT');
  const images = all.filter(node => 'fills' in node && Array.isArray(node.fills) && node.fills.some(paint => paint.type === 'IMAGE'));
  const fontFamilies = [...new Set(texts.flatMap(node => node.getStyledTextSegments(['fontName']).map(segment => segment.fontName.family)))];
  const imageHashes = [...new Set(images.flatMap(node => node.fills.filter(paint => paint.type === 'IMAGE').map(paint => paint.imageHash)))];
  const smallTexts = texts.filter(node => node.characters && (node.width <= 1 || node.height <= 1)).map(node => ({ id: node.id, name: node.name, width: node.width, height: node.height }));
  const topLevel = page.children.map(node => ({ id: node.id, name: node.name, type: node.type, width: node.width, height: node.height, x: node.x, y: node.y }));
  const rasterScreens = images.filter(node => node.width >= 375 && node.height >= 600).map(node => ({ id: node.id, name: node.name, width: node.width, height: node.height }));
  const frameIds = new Set(page.children.map(node => node.id));
  const reactionNodes = all.filter(node => 'reactions' in node && node.reactions.length);
  const invalidDestinations = reactionNodes.flatMap(node => node.reactions.flatMap(reaction => (reaction.actions || (reaction.action ? [reaction.action] : [])).filter(action => action.type === 'NODE' && !frameIds.has(action.destinationId)).map(action => ({ source: node.id, destination: action.destinationId }))));
  const outsideScreenTexts = [];
  for (const root of page.children) {
    if (root.type !== 'FRAME') continue;
    const rb = root.absoluteBoundingBox;
    if (!rb) continue;
    for (const t of root.findAllWithCriteria({ types: ['TEXT'] })) {
      const tb = t.absoluteBoundingBox;
      if (tb && (tb.x < rb.x - 1 || tb.x + tb.width > rb.x + rb.width + 1 || tb.y < rb.y - 1 || tb.y + tb.height > rb.y + rb.height + 1)) outsideScreenTexts.push({ id: t.id, name: t.name, screen: root.name });
    }
  }
  return { pageId, pageName: page.name, topLevel, nodeCount: all.length, textCount: texts.length, instanceCount: all.filter(node => node.type === 'INSTANCE').length, vectorCount: all.filter(node => node.type === 'VECTOR').length, imageCount: images.length, imageNodes: images.map(node => ({ id: node.id, name: node.name, width: node.width, height: node.height })), imageHashes, fontFamilies, smallTexts, outsideScreenTexts, rasterScreens, reactionCount: reactionNodes.length, invalidDestinations, placeholderCount: all.filter(node => 'placeholder' in node && node.placeholder === true).length };
}
