import { expect, test } from '@playwright/test';
import { loginDemo, navigateWithinApp, openModule } from './helpers';

test('vencimentos combinam antecedência, busca, repositório e unidade', async ({ page }) => {
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await loginDemo(page);
  await openModule(page, 'Vencimentos de documentos');
  await expect(page.getByRole('heading',{name:'Vencimentos de documentos',exact:true})).toBeVisible();
  await expect(page.getByRole('link',{name:'Inventário de riscos · Matriz (demo)',exact:true})).toBeVisible();
  await page.getByLabel('Antecedência',{exact:true}).selectOption('7');
  await expect(page.getByRole('heading',{name:'Nenhum vencimento encontrado'})).toBeVisible();
  await page.getByLabel('Antecedência',{exact:true}).selectOption('90');
  await expect(page.getByRole('link',{name:'Orientação de segurança · Produção (demo)',exact:true})).toBeVisible();
  await page.screenshot({path:'docs/frontend/qa/ampara/vencimentos-desktop.png',fullPage:true});
  await page.getByLabel('Buscar por título ou código',{exact:true}).fill('PROC-2026-002');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await expect(page.getByRole('link',{name:'Inventário de riscos · Matriz (demo)',exact:true})).toHaveCount(0);
  await page.getByRole('link',{name:/Abrir no repositório/}).click();
  await expect(page.getByRole('heading',{name:'Documentos',exact:true})).toBeVisible();
  await expect(page.getByLabel('Situação',{exact:true})).toHaveValue('ACTIVE');
  await expect(page.getByLabel('Buscar por título ou código',{exact:true})).toHaveValue('PROC-2026-002');
  await page.goBack();
  await expect(page.getByRole('heading',{name:'Vencimentos de documentos',exact:true})).toBeVisible();
  await expect(page.getByLabel('Antecedência',{exact:true})).toHaveValue('90');
  await page.getByLabel('Buscar por título ou código',{exact:true}).fill('');
  await page.getByRole('button',{name:'Buscar',exact:true}).click();
  await page.getByLabel('Consultar',{exact:true}).selectOption('expired');
  await expect(page.getByRole('link',{name:'Evidência de treinamento introdutório (demo)',exact:true})).toBeVisible();
  await page.getByRole('combobox',{name:'Unidade de trabalho',exact:true}).selectOption({label:'Unidade Operacional'});
  await expect(page.getByRole('heading',{name:'Nenhum vencimento encontrado'})).toBeVisible();
  await page.getByLabel('Consultar',{exact:true}).selectOption('upcoming');
  await expect(page.getByRole('link',{name:'Orientação para equipe de logística (demo)',exact:true})).toBeVisible();
  for(const width of [320,390,768]){
    await page.setViewportSize({width,height:844});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'docs/frontend/qa/ampara/vencimentos-mobile.png',fullPage:true});
  expect(errors).toEqual([]);
});

test('vencimentos preservam o escopo pessoal mesmo com unidade e paginação manipuladas na URL', async ({ page }) => {
  await loginDemo(page,'Trabalhador');
  await navigateWithinApp(page,'/app/vencimentos?unitId=outra-unidade&page=9007199254740992&days=90');
  await expect(page.getByRole('heading',{name:'Nenhum vencimento encontrado'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Inventário de riscos · Matriz (demo)',exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Unidade de trabalho',exact:true}).locator('option')).toHaveCount(1);
  await page.getByLabel('Consultar',{exact:true}).selectOption('expired');
  await expect(page.getByRole('heading',{name:'Nenhum vencimento encontrado'})).toBeVisible();
  await expect(page.getByRole('link',{name:'Evidência de treinamento introdutório (demo)',exact:true})).toHaveCount(0);
});
