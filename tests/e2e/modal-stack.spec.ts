import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp } from './helpers';

test('aviso de alterações sobre a navegação mobile fecha apenas a janela superior e restaura rolagem',async({page})=>{
  await loginDemo(page);
  await navigateWithinApp(page,'/app/trabalhadores/novo');
  await page.getByLabel('Nome completo *',{exact:true}).fill('Rascunho preservado');
  await page.setViewportSize({width:390,height:844});
  await page.getByRole('button',{name:'Abrir navegação',exact:true}).click();
  await page.getByRole('dialog',{name:'Navegação',exact:true}).getByRole('link',{name:'Documentos',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Alterações não salvas',exact:true})).toBeVisible();
  await expect(page.getByRole('dialog',{name:'Navegação',exact:true})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog',{name:'Alterações não salvas',exact:true})).toHaveCount(0);
  await expect(page.getByRole('dialog',{name:'Navegação',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('hidden');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button',{name:'Abrir navegação',exact:true})).toBeFocused();
  expect(await page.evaluate(()=>document.body.style.overflow)).toBe('');
  await expect(page.getByLabel('Nome completo *',{exact:true})).toHaveValue('Rascunho preservado');
});
