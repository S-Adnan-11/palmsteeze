import {expect,type Page} from '@playwright/test';
import {dateEntry} from '../../src/lib/visit-dates';
export async function chooseDate(page:Page,date:string) {
  await page.getByRole('button',{name:'Date',exact:true}).click();
  await page.getByLabel('Enter date · DD/MM/YYYY',{exact:true}).fill(dateEntry(date));
  await page.getByRole('button',{name:'Use date',exact:true}).click();
  await expect(page.getByRole('button',{name:'Date',exact:true})).toHaveAttribute('data-value',date);
}
