import type { AppointmentDto, ChecklistItemDto, EligibilityDto, PermitPreparationDto, PermitSnapshotDto, PermitSourceCheckDto, ScienceDto, WorkPermitDto } from '../shared/contracts/work-permits';
import type { ServiceTemplateVersionDto } from '../shared/contracts/service-templates';
import { isSignatureImageRepresentation } from '../shared/lib/signature-image';
import { PT_ACTIVITIES, PT_EQUIPMENT, PT_CONTROLS } from '../features/permits/templates/ri-s-36001';

// All PDF syntax is ASCII. Portuguese text and JPEG bytes use hex encoding,
// preserving byte offsets without interpolating user content into PDF syntax.
const winAnsiSpecial: Record<number, number> = { 8364: 128, 8218: 130, 402: 131, 8222: 132, 8230: 133, 8224: 134, 8225: 135, 710: 136, 8240: 137, 352: 138, 8249: 139, 338: 140, 381: 142, 8216: 145, 8217: 146, 8220: 147, 8221: 148, 8226: 149, 8211: 150, 8212: 151, 732: 152, 8482: 153, 353: 154, 8250: 155, 339: 156, 382: 158, 376: 159 };
const pdfText = (value: string) => `<${Array.from(value, character => {
  const point = character.codePointAt(0)!;
  const byte = point >= 32 && point <= 255 ? point : winAnsiSpecial[point] ?? 63;
  return byte.toString(16).padStart(2, '0');
}).join('')}>`;
const linesFor = (value: string): string[] => value.split(/\r?\n/).flatMap(line => {
  const characters = Array.from(line); if (!characters.length) return [''];
  const lines: string[] = []; while (characters.length) lines.push(characters.splice(0, 84).join(''));
  return lines;
});
type Block = { text: string } | { image: string; caption: string };
type PdfImage = { hex: string; width: number; height: number; id: number; name: string };
const missing = 'Não registrado nesta versão histórica';
const methods = { TYPED: 'Nome digitado', DRAWN: 'Desenho', IMAGE: 'Imagem' };
const answers: Record<string, string> = { YES: 'Sim', NO: 'Não', NA: 'Não aplicável' };
const evidenceLabels: Record<string, string> = { MISSING: 'Ausente', PENDING: 'Em conferência', APPROVED: 'Conferido', REJECTED: 'Devolvido', EXPIRED: 'Vencido' };
const optionLabels = (ids: string[], options: { id: string; label: string }[]) => ids.map(id => options.find(option => option.id === id)?.label || id).join(', ');

async function imageForPdf(representation: string): Promise<Omit<PdfImage, 'id' | 'name'>> {
  if (!isSignatureImageRepresentation(representation)) throw new Error('A representação histórica não contém uma imagem PNG ou JPEG válida de até 2 MB.');
  const image = new Image();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { image.onload = null; image.onerror = null; image.src = ''; reject(new Error('Não foi possível carregar a representação histórica para o PDF.')); }, 10_000);
    image.onload = () => { clearTimeout(timeout); resolve(); };
    image.onerror = () => { clearTimeout(timeout); reject(new Error('Não foi possível decodificar a representação histórica para o PDF.')); };
    image.src = representation;
  });
  if (!Number.isFinite(image.naturalWidth) || !Number.isFinite(image.naturalHeight) || image.naturalWidth < 1 || image.naturalHeight < 1) throw new Error('A representação histórica possui dimensões inválidas.');
  const scale = Math.min(1, 1600 / image.naturalWidth, 900 / image.naturalHeight);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('O navegador não conseguiu preparar a imagem histórica para o PDF.');
  context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const jpeg = canvas.toDataURL('image/jpeg', 0.92);
  if (!/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(jpeg)) throw new Error('Não foi possível converter a representação histórica para JPEG.');
  const bytes = atob(jpeg.slice(jpeg.indexOf(',') + 1));
  if (!bytes.startsWith('\xff\xd8\xff') || !bytes.endsWith('\xff\xd9')) throw new Error('A conversão da representação histórica retornou um JPEG inválido.');
  return { width: canvas.width, height: canvas.height, hex: Array.from(bytes, value => value.charCodeAt(0).toString(16).padStart(2, '0')).join('') };
}

/** Local demonstration export of one immutable submitted snapshot. Never fills gaps from the live PT. */
export async function makePermitDemoPdf(permit: WorkPermitDto, snapshot: PermitSnapshotDto): Promise<string> {
  const blocks: Block[] = [];
  const text = (...rows: string[]) => blocks.push(...rows.map(row => ({ text: row })));
  const graphic = (image: string | undefined, caption: string) => { if (image) blocks.push({ image, caption }); else text(`${caption}: ${missing}.`); };
  function identification(appointment: AppointmentDto | undefined) {
    if (!appointment) { text('Identificação histórica não registrada neste snapshot.'); return; }
    text(`Agendamento: ${appointment.code}`, `Empresa: ${appointment.companyId || missing}`, `Unidade: ${appointment.unitId}`, `Serviços: ${appointment.serviceLabel}`, `Equipe: ${appointment.teamName}`, `Local: ${appointment.location}`, `Período: ${appointment.startsAt} até ${appointment.endsAt}`, `Período solicitado: ${appointment.requestedStartsAt || missing} até ${appointment.requestedEndsAt || missing}`, `Período confirmado: ${appointment.confirmedStartsAt || missing} até ${appointment.confirmedEndsAt || missing}`, `Responsável: ${appointment.responsibleName} · ${appointment.responsibleId || missing}`, `Observações do agendamento: ${appointment.notes || 'Sem observações.'}`, 'Participantes preservados:');
    text(...appointment.participants.map(person => `${person.name} · ${person.serviceFunction} · registro ${person.workerId}`));
  }
  function templates(templateVersion: string | undefined, serviceTemplates: ServiceTemplateVersionDto[] | undefined) {
    text(`Template: ${templateVersion || missing}`);
    if (!serviceTemplates?.length) { text('Templates individuais dos serviços: não registrados.'); return; }
    for (const template of serviceTemplates) {
      text(`${template.serviceName} · template v${template.version}`, `Publicado em: ${template.publishedAt} · publicado por: ${template.publishedBy}`, `Motivo da publicação: ${template.reason}`, `Atividades previstas: ${optionLabels(template.activityIds, PT_ACTIVITIES) || 'Não registradas.'}`);
      text(...template.questions.map(question => `${question.label} · obrigatória: ${question.required ? 'Sim' : 'Não'} · respostas impeditivas: ${question.blockingAnswers.map(answer => answers[answer]).join(', ') || 'Nenhuma'}`));
    }
  }
  function checklist(items: ChecklistItemDto[]) {
    if (!items.length) text('Nenhuma pergunta registrada.');
    for (const item of items) text(`${item.label}: ${item.answer ? answers[item.answer] : 'Não respondido'}`, `Obrigatória: ${item.required ? 'Sim' : 'Não'}${item.serviceName ? ` · serviço: ${item.serviceName} · template v${item.templateVersion || missing}` : ''}`, ...(item.note ? [`Observação: ${item.note}`] : []));
  }
  function sourceChecks(items: PermitSourceCheckDto[]) {
    if (!items.length) text('Nenhuma conferência registrada.');
    for (const item of items) text(`${item.section} · ${item.label}: ${item.answer ? answers[item.answer] : 'Não respondido'}`, ...(item.note ? [`Observação: ${item.note}`] : []), ...(item.sourceCell ? [`Referência do modelo: ${item.sourceCell}`] : []));
  }
  function preparation(value: PermitPreparationDto | undefined) {
    if (!value) { text('Preparação histórica não registrada.'); return; }
    text(`Modelo recebido: ${value.sourceId} · revisão ${value.sourceRevision}`);
    const labels: Record<keyof PermitPreparationDto['identification'], string> = { serviceProvider: 'Prestadora', subcontractor: 'Subcontratada', group: 'Grupo', workFront: 'Frente de trabalho', location: 'Local identificado', activityDescription: 'Descrição da atividade', riskAnalysisReference: 'Referência da análise de risco', executorName: 'Executante', issuerName: 'Emitente', atmosphereNotes: 'Condições atmosféricas', watchers: 'Vigias', supervisors: 'Supervisores' };
    for (const key of Object.keys(labels) as (keyof typeof labels)[]) text(`${labels[key]}: ${value.identification[key] || 'Não preenchido.'}`);
    text(`Atividades: ${optionLabels(value.activities, PT_ACTIVITIES) || 'Nenhuma registrada.'}`, `Atividades exigidas: ${optionLabels(value.requiredActivities || [], PT_ACTIVITIES) || 'Não registradas.'}`, `Equipamentos: ${optionLabels(value.equipment, PT_EQUIPMENT) || 'Nenhum registrado.'}`, `Controles: ${optionLabels(value.controls, PT_CONTROLS) || 'Nenhum registrado.'}`, `Controles adicionais: ${value.additionalControls || 'Não preenchidos.'}`, 'Conferências da preparação:');
    sourceChecks(value.checks);
    text('Medições atmosféricas:');
    if (!value.measurements.length) text('Nenhuma medição registrada.');
    for (const measurement of value.measurements) text(`Medição ${measurement.id} · em ${measurement.measuredAt || missing}`, `Oxigênio: ${measurement.oxygen || 'Não preenchido'} · CO: ${measurement.carbonMonoxide || 'Não preenchido'} · explosividade: ${measurement.explosivity || 'Não preenchida'}`, `Outros: ${measurement.other || 'Não preenchidos'}`, `Responsável: ${measurement.responsible || missing} · instrumento: ${measurement.instrument || missing}`);
    text('Conferências de encerramento:'); sourceChecks(value.closingChecks);
  }
  function eligibility(value: EligibilityDto | undefined) {
    if (!value) { text('Elegibilidade histórica não registrada.'); return; }
    text(`Conferida em: ${value.checkedAt} · requisitos v${value.requirementVersion}`, `Condição documental registrada: ${value.eligible ? 'Requisitos atendidos' : 'Pendências registradas'}`, `Agendamento: ${value.appointmentId} · unidade: ${value.unitId || missing}`);
    for (const person of value.participants) {
      text(`${person.name} · ${person.serviceFunction} · ${person.eligible ? 'Requisitos atendidos' : 'Com pendências'}`);
      for (const item of person.items) text(`${item.label}: ${evidenceLabels[item.status] || item.status}`, `Descrição: ${item.description}`, `Requisito: ${item.requirementId} · documento restrito: ${item.restricted ? 'Sim' : 'Não'}`, `Evidência: ${item.evidenceId || missing} · revisão ${item.evidenceRevision ?? missing} · arquivo ${item.fileName || missing}`, `Validade: ${item.validFrom || missing} até ${item.validUntil || missing}`, ...(item.reason ? [`Motivo: ${item.reason}`] : []));
    }
  }
  function sciences(items: ScienceDto[]) {
    if (!items.length) text('Nenhuma ciência registrada.');
    for (const science of items) {
      text(`${science.declarantName} · registro ${science.workerId} · versão ${science.version}`, `Coletada em: ${science.collectedAt} · coletor: ${science.collectedByName} (${science.collectedBy})`, `Forma: ${methods[science.method]} · confirmação explícita: ${science.confirmed ? 'Sim' : 'Não'}`);
      if (science.method === 'DRAWN') graphic(science.representation, `Representação preservada de ${science.declarantName}`);
      else text(`Representação digitada: ${science.representation}`);
    }
  }
  text(`PT: ${permit.code} · Versão: ${snapshot.version}`, 'Operação: concluída · Revisão desta versão: encerramento validado', `Versão enviada em: ${snapshot.submittedAt}`, `Início registrado: ${snapshot.startedAt || missing}`, `Conclusão registrada: ${snapshot.completedAt || missing}`, '', 'IDENTIFICAÇÃO REGISTRADA NA VERSÃO');
  identification(snapshot.appointment); templates(snapshot.templateVersion, snapshot.serviceTemplates);
  text('', 'LIBERAÇÃO OPERACIONAL PRESERVADA');
  if (snapshot.release) {
    const release = snapshot.release;
    text(`Liberada em: ${release.releasedAt}`, `Responsável pela liberação: ${release.releasedByName} (${release.releasedBy})`, 'Identificação na liberação:'); identification(release.appointment); templates(release.templateVersion, release.serviceTemplates);
    text('Checklist na liberação:'); checklist(release.checklist);
    text('Preparação na liberação:'); preparation(release.preparation);
    text('Elegibilidade na liberação:'); eligibility(release.eligibility);
    text('Ciências na liberação:'); sciences(release.sciences);
  } else text('Liberação histórica não registrada neste snapshot. Nenhuma liberação atual foi usada para completar o documento.');
  text('', 'PREPARAÇÃO REGISTRADA NA VERSÃO'); preparation(snapshot.preparation);
  text('', 'CHECKLIST REGISTRADO'); checklist(snapshot.checklist);
  text('', 'ELEGIBILIDADE REGISTRADA NA VERSÃO'); eligibility(snapshot.eligibility);
  text('', 'CIÊNCIAS REGISTRADAS'); sciences(snapshot.sciences);
  text('', 'CONCLUSÃO', snapshot.summary, '', 'REVISÃO DE ENCERRAMENTO', `Revisor: ${snapshot.signatureRepresentation || missing}`, `Registro do responsável: ${snapshot.reviewedBy || missing}`, `Revisão em: ${snapshot.reviewedAt || missing}`, `Representação visual: ${methods[snapshot.signatureMethod || 'TYPED']}`, `Perfil pessoal: ${snapshot.signatureProfileId ? `${snapshot.signatureProfileId} · versão ${snapshot.signatureProfileVersion ?? missing}` : 'Representação registrada apenas nesta revisão.'}`);
  if (snapshot.signatureImage) graphic(snapshot.signatureImage, 'Representação gráfica preservada do revisor');
  else text(`Representação digitada: ${snapshot.signatureRepresentation || missing}`);
  text('Nome/desenho/imagem não representa assinatura digital certificada.', '', 'OBSERVAÇÃO DA REVISÃO', snapshot.comment || 'Sem observação adicional.', '', 'Documento sintético em memória, sem validade operacional.', 'O documento definitivo e sua custódia dependem da API real do SESMT.');

  const images = new Map<string, PdfImage>();
  const objects: string[] = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>'];
  for (const block of blocks) {
    if (!('image' in block) || images.has(block.image)) continue;
    const converted = await imageForPdf(block.image);
    const image: PdfImage = { ...converted, id: objects.length + 1, name: `Im${images.size + 1}` };
    images.set(block.image, image);
    const bytes = `${image.hex}>`;
    objects.push(`<< /Type /XObject /Subtype /Image /Width ${image.width} /Height ${image.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter [/ASCIIHexDecode /DCTDecode] /Length ${bytes.length} >>\nstream\n${bytes}\nendstream`);
  }
  const pages: string[][] = [[]]; let y = 738;
  const nextPage = () => { pages.push([]); y = 738; };
  const addLine = (line: string) => { if (y < 86) nextPage(); pages[pages.length - 1].push(`BT /F1 10 Tf 40 ${y} Td ${pdfText(line)} Tj ET`); y -= 13; };
  for (const block of blocks) {
    if ('text' in block) { linesFor(block.text).forEach(addLine); continue; }
    const image = images.get(block.image)!;
    const ratio = Math.min(515 / image.width, 140 / image.height);
    const width = image.width * ratio, height = image.height * ratio;
    const captions = linesFor(block.caption);
    if (y - height - captions.length * 13 - 12 < 86) nextPage();
    captions.forEach(addLine);
    const imageY = y - height + 4;
    pages[pages.length - 1].push(`q ${width.toFixed(2)} 0 0 ${height.toFixed(2)} 40 ${imageY.toFixed(2)} cm /${image.name} Do Q`);
    y -= height + 14;
  }
  const pageIds: number[] = [];
  const resources = [...images.values()].map(image => `/${image.name} ${image.id} 0 R`).join(' ');
  pages.forEach((page, index) => {
    const pageId = objects.length + 1; const contentId = pageId + 1; pageIds.push(pageId);
    const content = [
      `BT /F1 10 Tf 40 790 Td ${pdfText('AMPARA SESMT · PDF DE DEMONSTRAÇÃO')} Tj ET`,
      `BT /F1 10 Tf 40 773 Td ${pdfText('SEM VALIDADE OPERACIONAL · DADOS FICTÍCIOS')} Tj ET`,
      ...page,
      `BT /F1 9 Tf 40 40 Td ${pdfText(`${permit.code} · versão ${snapshot.version} · página ${index + 1}/${pages.length}`)} Tj ET`,
    ].join('\n');
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 3 0 R >> /XObject << ${resources} >> >> /Contents ${contentId} 0 R >>`, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  objects[0] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[1] = `<< /Type /Pages /Kids [${pageIds.map(id => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, index) => { const offset = pdf.length; pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; return offset; });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return pdf;
}
