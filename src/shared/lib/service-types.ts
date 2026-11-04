import type { ServiceTypeDto } from '../contracts/work-permits';

const service = (number: number, name: string, activityIds: string[]): ServiceTypeDto => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, '0')}`,
  name, activityIds,
  description: `Serviço de ${name.toLocaleLowerCase('pt-BR')}. Configuração inicial demonstrativa; os critérios são editáveis por unidade.`,
  templateVersion: `DEMO-SERVICO-${number}-1`, requirementVersion: 'DEMO-MATRIZ-1',
});

/** Identificadores estáveis para os cinco serviços do catálogo de PT. */
export const PT_SERVICE_TYPES: ServiceTypeDto[] = [
  service(510, 'Trabalho em altura', ['height']),
  service(511, 'Trabalho a quente', ['hot-work']),
  service(512, 'Trabalho a frio', []),
  service(513, 'Espaço confinado', ['confined-space']),
  service(514, 'Eletricidade', ['electrical']),
];
