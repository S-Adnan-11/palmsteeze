import type {Page} from '@playwright/test';
export async function selectChoice(page:Page,label:string,value:string) {
  await page.getByRole('combobox',{name:label,exact:true}).click();
  await page.locator('[role=option][data-value="'+value+'"]').click();
}
