import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { AppointmentDto } from '../../shared/contracts/work-permits';
import { PermitPreparation } from './PermitPreparation';
import { createPermitPreparation } from './templates/ri-s-36001';

describe('categorias vinculadas aos serviços da PT', () => {
  it('mantém categorias agendadas selecionadas e impede acrescentar serviço pelo formulário de preparação', async () => {
    const value = createPermitPreparation({ location: 'Local Demo', responsibleName: 'Técnico Demo' } as AppointmentDto, ['height']);
    const onChange = vi.fn();
    render(<PermitPreparation value={value} editable pending={false} dirty={false} onChange={onChange} onSubmit={event => event.preventDefault()} />);
    const categories = within(screen.getByRole('group', { name: 'Categorias aplicáveis ao serviço' }));
    const height = categories.getByRole('checkbox', { name: /Trabalho em altura/i });
    expect(height).toBeChecked();
    expect(height).toBeDisabled();
    const electrical = categories.getByRole('checkbox', { name: /eletricidade|elétric/i });
    expect(electrical).not.toBeChecked();
    expect(electrical).toBeDisabled();
    const extra = categories.getByRole('checkbox', { name: /pressurizad/i });
    expect(extra).toBeEnabled();
    await userEvent.setup().click(extra);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ activities: ['height', 'pressurized'], requiredActivities: ['height'] }));
  });
});
